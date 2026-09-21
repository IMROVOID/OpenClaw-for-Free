import { spawn, ChildProcess, exec, execSync } from 'child_process';
import { ControlPanelConfig } from './types.js';
import { VpsProbe } from './vpsProbe.js';
import { EndpointResolver } from './endpointResolver.js';
import { DomainedUrlResolver } from './domainedUrlResolver.js';
import { VmSshAutoRenewer } from './vmSshAutoRenewer.js';

export interface TunnelState {
  openclawActive: boolean;
  omnirouteActive: boolean;
  llamaActive: boolean;
}

export class SshTunnelManager {
  private primaryProcess: ChildProcess | null = null;
  private secondaryProcess: ChildProcess | null = null;
  private config: ControlPanelConfig;

  constructor(config: ControlPanelConfig) {
    this.config = config;
  }

  updateConfig(config: ControlPanelConfig): void {
    this.config = config;
  }

  async checkTunnels(): Promise<TunnelState> {
    const ocPath = this.config.openclawToken
      ? `/?token=${encodeURIComponent(this.config.openclawToken)}`
      : '/';
    let [openclawActive, omnirouteActive, llamaActive] = await Promise.all([
      VpsProbe.checkHttp(this.config.openclawPort, ocPath, 3500)
        .then((ok) => ok || (ocPath !== '/' ? VpsProbe.checkHttp(this.config.openclawPort, '/', 2000) : false)),
      VpsProbe.checkHttp(this.config.omniroutePort, '/', 3500),
      this.config.llama.enabled
        ? VpsProbe.checkHttp(this.config.llamaPort, '/health', 3500)
        : Promise.resolve(false)
    ]);

    if (this.config.llama.enabled && !llamaActive) {
      const endpoint = this.config.llama.activeEndpointUrl || EndpointResolver.resolveBaseUrl(this.config);
      if (endpoint) {
        try {
          const probe = await EndpointResolver.probeEndpoint(endpoint, 2500);
          if (probe.ok) {
            llamaActive = true;
          }
        } catch (_) {}
      }
    }

    if ((!openclawActive || !omnirouteActive) && this.config.domainedUrlsEnabled && this.config.publicBaseDomain) {
      const domain = this.config.publicBaseDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      if (domain) {
        try {
          const probe = await EndpointResolver.probeEndpoint(`https://${domain}`, 2500);
          if (probe.ok) {
            openclawActive = true;
            omnirouteActive = true;
          }
        } catch (_) {}
      }
    }

    return { openclawActive, omnirouteActive, llamaActive };
  }

  private needsPrimaryForwarding(): boolean {
    return !DomainedUrlResolver.resolveOpenclawUrl(this.config).isDomained
      || !DomainedUrlResolver.resolveOmnirouteUrl(this.config).isDomained;
  }

  private needsSecondaryForwarding(): boolean {
    return this.config.llama.enabled && !DomainedUrlResolver.resolveLlamaUrl(this.config).isDomained;
  }

  async startAllTunnels(): Promise<TunnelState> {
    await Promise.all([
      this.needsPrimaryForwarding() ? this.startPrimaryTunnel() : Promise.resolve(false),
      this.needsSecondaryForwarding() ? this.startSecondaryTunnel() : Promise.resolve(false)
    ]);
    return this.checkTunnels();
  }

  async ensureTunnelsRunning(): Promise<TunnelState> {
    const tunnels = await this.checkTunnels();
    const tasks: Promise<boolean>[] = [];
    if (this.needsPrimaryForwarding() && (!tunnels.openclawActive || !tunnels.omnirouteActive) && !this.primaryProcess) {
      tasks.push(this.startPrimaryTunnel());
    }
    if (this.needsSecondaryForwarding() && !tunnels.llamaActive && !this.secondaryProcess) {
      tasks.push(this.startSecondaryTunnel());
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
      return this.checkTunnels();
    }
    return tunnels;
  }

  async restartAllTunnels(): Promise<TunnelState> {
    this.stopAll();
    await new Promise((r) => setTimeout(r, 500));
    return this.startAllTunnels();
  }

  static freePortIfStale(port: number): void {
    if (process.platform === 'win32') {
      try {
        const out = execSync(`netstat -ano | findstr ":${port} "`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        for (const line of out.split('\n')) {
          if (line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== '0' && pid !== `${process.pid}`) {
              execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            }
          }
        }
      } catch (_) {}
    }
  }

  async startPrimaryTunnel(): Promise<boolean> {
    if (this.primaryProcess) {
      const live = await this.checkTunnels();
      if (live.openclawActive && live.omnirouteActive) return true;
      try { this.primaryProcess.kill('SIGTERM'); } catch (_) {}
      this.primaryProcess = null;
    }

    SshTunnelManager.freePortIfStale(this.config.openclawPort);
    SshTunnelManager.freePortIfStale(this.config.omniroutePort);

    const args = [
      '-N',
      '-L', `127.0.0.1:${this.config.openclawPort}:127.0.0.1:${this.config.openclawPort}`,
      '-L', `127.0.0.1:${this.config.omniroutePort}:127.0.0.1:${this.config.omniroutePort}`,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'TCPKeepAlive=yes',
      this.config.primarySshTarget
    ];

    try {
      this.primaryProcess = spawn('ssh', args, { stdio: 'ignore' });
      this.primaryProcess.on('exit', () => {
        this.primaryProcess = null;
      });
      this.primaryProcess.on('error', () => {
        this.primaryProcess = null;
      });
    } catch (_) {
      this.primaryProcess = null;
      return false;
    }

    // Wait up to 10s for local ports to respond
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const status = await this.checkTunnels();
      if (status.openclawActive || status.omnirouteActive) return true;
    }

    return false;
  }

  private async _spawnSecondaryTunnel(target: string): Promise<boolean> {
    const args = [
      '-N',
      '-L', `127.0.0.1:${this.config.llamaPort}:127.0.0.1:${this.config.llamaPort}`,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'TCPKeepAlive=yes',
      target
    ];

    try {
      this.secondaryProcess = spawn('ssh', args, { stdio: 'ignore' });
      this.secondaryProcess.on('exit', () => { this.secondaryProcess = null; });
      this.secondaryProcess.on('error', () => { this.secondaryProcess = null; });
    } catch (_) {
      this.secondaryProcess = null;
      return false;
    }

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const localActive = await VpsProbe.checkHttp(this.config.llamaPort, '/health', 1500);
      if (localActive) return true;
      if (!this.secondaryProcess) break;
    }

    return false;
  }

  async startSecondaryTunnel(): Promise<boolean> {
    if (!this.config.llama.enabled) return false;
    if (this.config.llama.isSeparateVps && !this.config.llama.sshTarget && !this.config.secondarySshTarget) {
      return false;
    }

    const localLive = await VpsProbe.checkHttp(this.config.llamaPort, '/health', 1500);
    if (localLive) return true;

    if (this.secondaryProcess) {
      try { this.secondaryProcess.kill('SIGTERM'); } catch (_) {}
      this.secondaryProcess = null;
    }

    SshTunnelManager.freePortIfStale(this.config.llamaPort);

    let target = this.config.llama.isSeparateVps
      ? (this.config.llama.sshTarget || this.config.secondarySshTarget || '')
      : this.config.primarySshTarget;

    if (!target) return false;

    let ok = await this._spawnSecondaryTunnel(target);
    if (!ok && this.config.llama.isSeparateVps) {
      const renewed = await VmSshAutoRenewer.refreshSecondaryVmSsh(this.config);
      if (renewed.renewed) {
        target = this.config.llama.sshTarget || this.config.secondarySshTarget || '';
        if (target) {
          ok = await this._spawnSecondaryTunnel(target);
        }
      }
    }

    return ok;
  }

  stopAll(): void {
    if (this.primaryProcess) {
      try { this.primaryProcess.kill('SIGTERM'); } catch (_) {}
      this.primaryProcess = null;
    }
    if (this.secondaryProcess) {
      try { this.secondaryProcess.kill('SIGTERM'); } catch (_) {}
      this.secondaryProcess = null;
    }
    SshTunnelManager.freePortIfStale(this.config.openclawPort);
    SshTunnelManager.freePortIfStale(this.config.omniroutePort);
    if (this.config.llama.enabled) {
      SshTunnelManager.freePortIfStale(this.config.llamaPort);
    }
  }

  static copyToClipboard(text: string): void {
    try {
      let proc: ReturnType<typeof spawn> | null = null;
      if (process.platform === 'win32') {
        proc = spawn('clip');
      } else if (process.platform === 'darwin') {
        proc = spawn('pbcopy');
      } else {
        proc = spawn('xclip', ['-selection', 'clipboard']);
      }
      if (proc) {
        proc.on('error', () => {});
        if (proc.stdin) {
          proc.stdin.on('error', () => {});
          proc.stdin.write(text);
          proc.stdin.end();
        }
      }
    } catch (_) {}
  }

  static openBrowser(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      const targetUrl = parsed.href;
      let child: ReturnType<typeof spawn> | null = null;
      if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', '""', targetUrl], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'darwin') {
        child = spawn('open', [targetUrl], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' });
      }
      if (child) {
        child.on('error', () => {});
        child.unref();
      }
    } catch (_) {}
  }
}

