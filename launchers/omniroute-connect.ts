import { spawn, exec } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

export interface OmniRouteConnectConfig {
  sshTarget: string;
  remotePort: number;
  localPort: number;
  password: string;
}

const CONFIG_PATH = path.join(os.homedir(), '.omniroute-connect.json');

const DEFAULT_CONFIG: OmniRouteConnectConfig = {
  sshTarget: '',
  remotePort: 20128,
  localPort: 20128,
  password: ''
};

export function loadConfig(): OmniRouteConnectConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(cfg: OmniRouteConnectConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (_) {}
}

export function parseSshTarget(input: string, fallback: string): string {
  if (!input || !input.trim()) return fallback;
  let clean = input.trim();
  clean = clean.replace(/^["']|["']$/g, '');
  clean = clean.replace(/^ssh\s+/i, '');

  const match = clean.match(/([a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+)/);
  if (match) return match[1];

  if (/^[a-zA-Z0-9_\-]+$/.test(clean)) {
    return `${clean}@ssh.app.daytona.io`;
  }
  return clean;
}

export function checkHttp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, { timeout: 1500 }, (res) => {
      resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function copyToClipboard(text: string): void {
  try {
    const proc = spawn('clip');
    proc.stdin.write(text);
    proc.stdin.end();
  } catch (_) {}
}

export function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      const cleanUrl = url.replace(/"/g, '%22');
      exec(`cmd.exe /c start "" "${cleanUrl}"`, (err) => {
        if (err) {
          exec(`powershell.exe -Command "Start-Process '${cleanUrl.replace(/'/g, "''")}'"`, () => {});
        }
      });
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`, () => {});
    } else {
      exec(`xdg-open "${url}"`, () => {});
    }
  } catch (_) {}
}

export async function promptSshTarget(defaultTarget: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let countdown = 5;
    let timer: NodeJS.Timeout | null = null;
    let answered = false;

    const renderPrompt = () => {
      process.stdout.write(`\r[?] Press [ENTER] to connect (${countdown}s auto-connect) or paste new SSH target: `);
    };

    renderPrompt();

    timer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        if (timer) clearInterval(timer);
        if (!answered) {
          answered = true;
          process.stdout.write('\n');
          rl.close();
          resolve(defaultTarget);
        }
      } else {
        renderPrompt();
      }
    }, 1000);

    process.stdin.once('data', () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });

    rl.on('line', (line) => {
      if (timer) clearInterval(timer);
      if (!answered) {
        answered = true;
        rl.close();
        const target = parseSshTarget(line, defaultTarget);
        resolve(target);
      }
    });
  });
}

async function main(): Promise<void> {
  console.clear();
  console.log('====================================================');
  console.log('         OmniRoute Daytona Tunnel Connector         ');
  console.log('====================================================\n');

  const config = loadConfig();
  console.log(`Current default SSH target:\n  ${config.sshTarget}\n`);

  const chosenTarget = await promptSshTarget(config.sshTarget);
  console.log(`\nConnecting to target: ${chosenTarget}`);

  config.sshTarget = chosenTarget;
  saveConfig(config);

  const DASHBOARD_URL = `http://localhost:${config.localPort}/dashboard`;

  console.log('\n[1/3] Checking if port is already forwarded locally...');
  const isUp = await checkHttp(config.localPort);

  if (isUp) {
    console.log('[OK] Tunnel already active!\n');
    console.log(`> Dashboard: ${DASHBOARD_URL}`);
    console.log(`> Password:  ${config.password}\n`);
    copyToClipboard(config.password);
    console.log('[*] Master password copied to clipboard!');
    console.log('[2/3] Opening browser to OmniRoute Dashboard...');
    openBrowser(DASHBOARD_URL);
    console.log('\n[3/3] Ready! Press Enter or Ctrl+C to exit.');
    process.stdin.resume();
    process.stdin.on('data', () => process.exit(0));
    return;
  }

  console.log(`[2/3] Establishing secure SSH tunnel (${config.localPort} -> ${config.remotePort})...`);
  const sshArgs = [
    '-N',
    '-L', `${config.localPort}:127.0.0.1:${config.remotePort}`,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    chosenTarget
  ];

  const sshProcess = spawn('ssh', sshArgs, { stdio: 'ignore' });

  sshProcess.on('error', (err: Error) => {
    console.error('\n[ERROR] Failed to start SSH:', err.message);
    console.log('Please ensure ssh is installed and available in Windows PATH.');
    process.exit(1);
  });

  sshProcess.on('exit', (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.log(`\n[INFO] SSH tunnel closed (exit code: ${code}).`);
    }
  });

  let connected = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkHttp(config.localPort)) {
      connected = true;
      break;
    }
  }

  if (connected) {
    copyToClipboard(config.password);
    console.log('\n====================================================');
    console.log('             CONNECTED SUCCESSFULLY                 ');
    console.log('====================================================');
    console.log(`\n  Dashboard:  ${DASHBOARD_URL}`);
    console.log(`  Password:   ${config.password}`);
    console.log('\n  [*] Master password copied to clipboard!');
    console.log('  [*] Opening web browser to OmniRoute Dashboard...');
    console.log('  --------------------------------------------------');
    console.log('  Keep this window OPEN to stay connected.');
    console.log('  Press Ctrl+C to disconnect anytime.');
    console.log('====================================================\n');
    openBrowser(DASHBOARD_URL);
  } else {
    console.log('\n[WARNING] Tunnel started, but endpoint did not respond within 20s.');
    console.log(`You can still try opening ${DASHBOARD_URL} in your browser.`);
  }

  const cleanup = () => {
    console.log('\nDisconnecting SSH tunnel...');
    try {
      sshProcess.kill('SIGTERM');
    } catch (_) {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch(console.error);
}
