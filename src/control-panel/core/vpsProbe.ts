import { exec, spawn } from 'child_process';
import http from 'http';
import { HardwareTelemetry, VpsLiveHardware } from './hardwareTelemetry.js';

export interface RemoteServiceHealth {
  name: string;
  status: 'RUNNING' | 'STOPPED' | 'FAILED' | 'UNKNOWN';
  pid?: number;
  uptime?: string;
}

export interface DetectedVpsSpecs {
  success: boolean;
  cpuCores: number;
  ramGb: number;
  storageGb: number;
  rawCpu?: number;
  error?: string;
}

export class VpsProbe {
  static getSshArgs(target: string, extraArgs: string[] = []): string[] {
    const cleanTarget = target.startsWith('-') ? target.replace(/^-+/, '') : target;
    return [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'TCPKeepAlive=yes',
      '--',
      cleanTarget,
      ...extraArgs
    ];
  }

  static async checkHttp(port: number, path = '/', timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: timeoutMs }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  static async testSshReachability(target: string, timeoutSec = 15, retries = 1): Promise<{ success: boolean; error?: string }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await this._testSshReachabilityOnce(target, timeoutSec);
      if (res.success || attempt === retries) return res;
      await new Promise((r) => setTimeout(r, 600));
    }
    return { success: false, error: 'Connection failed after retries' };
  }

  private static _testSshReachabilityOnce(target: string, timeoutSec: number): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = this.getSshArgs(target, ['echo PONG']);
      const child = spawn('ssh', args);
      try { child.stdin?.end(); } catch (_) {}
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch (_) {}
        resolve({ success: false, error: 'Connection timed out' });
      }, (timeoutSec + 2) * 1000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.includes('PONG')) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr.trim() || `SSH exit code: ${code}` });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });
    });
  }

  static async execRemote(target: string, command: string, timeoutSec = 15, retries = 1): Promise<{ stdout: string; stderr: string; code: number }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await this._execRemoteOnce(target, command, timeoutSec);
      if (res.code === 0 || attempt === retries) return res;
      if (res.code === -1 || res.stderr.includes('timed out') || res.stderr.includes('closed by remote host')) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      return res;
    }
    return { stdout: '', stderr: 'SSH execution timed out after retry', code: -1 };
  }

  private static _execRemoteOnce(target: string, command: string, timeoutSec: number): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const args = this.getSshArgs(target, [command]);
      const child = spawn('ssh', args);
      try { child.stdin?.end(); } catch (_) {}
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', code: -1 });
      }, timeoutSec * 1000);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? -1 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err.message, code: -1 });
      });
    });
  }

  static async execRemoteWithStdin(
    target: string,
    command: string,
    stdinData: string,
    timeoutSec = 180
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const args = this.getSshArgs(target, [command]);
      const child = spawn('ssh', args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', code: -1 });
      }, timeoutSec * 1000);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? -1 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err.message, code: -1 });
      });

      child.stdin.write(stdinData);
      child.stdin.end();
    });
  }

  static async detectVpsSpecs(target: string): Promise<DetectedVpsSpecs> {
    const probeCmd = [
      'python3 -c "',
      'import os',
      'c=0',
      'try:',
      ' p=open(\'/sys/fs/cgroup/cpu.max\').read().split()',
      ' if p[0]!=\'max\' and int(p[1])>0: c=int(int(p[0])/int(p[1]))',
      'except: pass',
      'if c<=0:',
      ' try:',
      '  q=int(open(\'/sys/fs/cgroup/cpu/cpu.cfs_quota_us\').read())',
      '  p=int(open(\'/sys/fs/cgroup/cpu/cpu.cfs_period_us\').read())',
      '  if q>0 and p>0: c=int(q/p)',
      ' except: pass',
      'if c<=0: c=os.cpu_count() or 4',
      'print(\'CPUS:\'+str(c))',
      '" 2>/dev/null || echo "CPUS:$(nproc 2>/dev/null || echo 4)";',
      'echo "RAM:$(free -m 2>/dev/null | awk \'/^Mem:/{print int($2/1024)}\' || echo 8)";',
      'echo "DISK:$(df -BG / 2>/dev/null | awk \'NR==2{sub(/G/,""); print $2}\' || echo 10)"'
    ].join(' ');

    const res = await this.execRemote(target, probeCmd, 12);
    if (res.code !== 0 || !res.stdout) {
      return {
        success: false,
        cpuCores: 4,
        ramGb: 8,
        storageGb: 10,
        error: res.stderr || 'Execution failed'
      };
    }

    const cpusMatch = res.stdout.match(/CPUS:(\d+)/);
    const ramMatch = res.stdout.match(/RAM:(\d+)/);
    const diskMatch = res.stdout.match(/DISK:(\d+)/);

    const rawCpu = cpusMatch ? parseInt(cpusMatch[1], 10) : 4;
    const rawRam = ramMatch ? parseInt(ramMatch[1], 10) : 8;
    const rawDisk = diskMatch ? parseInt(diskMatch[1], 10) : 10;

    const cpuCores = rawCpu > 4 ? 4 : Math.max(1, rawCpu);
    const ramGb = rawRam > 8 ? 8 : Math.max(2, rawRam);
    const storageGb = rawDisk > 10 ? 10 : Math.max(5, rawDisk);

    return { success: true, cpuCores, ramGb, storageGb, rawCpu };
  }

  static async querySupervisorServices(target: string, isPrimary = true): Promise<RemoteServiceHealth[]> {
    const res = await this.queryVpsTelemetry(target, isPrimary);
    return res.services;
  }

  static async queryVpsTelemetry(
    target: string,
    isPrimary = true,
    label = 'VPS'
  ): Promise<{ services: RemoteServiceHealth[]; hardware: VpsLiveHardware | null }> {
    const sysCmd = isPrimary
      ? '; echo "---SYSTEMD---"; systemctl --user show openclaw-gateway.service --property=MainPID,ActiveState 2>/dev/null || true; echo "---PROC---"; pgrep -f "openclaw" >/dev/null && echo "openclaw:RUNNING" || true; pgrep -f "omniroute" >/dev/null && echo "omniroute:RUNNING" || true'
      : '; echo "---PROC---"; pgrep -f "llama-server" >/dev/null && echo "llama:RUNNING" || true';
    const probeCmd = `sudo supervisorctl status 2>/dev/null${sysCmd}; ${HardwareTelemetry.getTelemetryCommand()}`;
    const res = await this.execRemote(target, probeCmd, 8);
    const services: RemoteServiceHealth[] = [];

    if (res.code === 0 && res.stdout.trim()) {
      const parts = res.stdout.split('---HARDWARE---');
      const servicePart = parts[0] || '';

      const [mainPart, procPart] = servicePart.split('---PROC---');
      const [supPart, sysPart] = isPrimary ? mainPart.split('---SYSTEMD---') : [mainPart, ''];
      if (supPart && supPart.trim()) {
        const lines = supPart.trim().split('\n');
        for (const line of lines) {
          const p = line.trim().split(/\s+/);
          if (p.length >= 2) {
            const name = p[0];
            const state = p[1].toUpperCase();
            let status: RemoteServiceHealth['status'] = 'UNKNOWN';
            if (state === 'RUNNING') status = 'RUNNING';
            else if (state === 'STOPPED') status = 'STOPPED';
            else if (state === 'FATAL' || state === 'BACKOFF' || state === 'EXITED') status = 'FAILED';

            let pid: number | undefined;
            let uptime: string | undefined;
            const pidMatch = line.match(/pid\s+(\d+)/i);
            if (pidMatch) pid = parseInt(pidMatch[1], 10);
            const uptimeMatch = line.match(/uptime\s+([^\,]+)/i);
            if (uptimeMatch) uptime = uptimeMatch[1];

            services.push({ name, status, pid, uptime });
          }
        }
      }

      if (isPrimary && sysPart && sysPart.trim() && !services.some((s) => s.name === 'openclaw')) {
        const activeMatch = sysPart.match(/ActiveState=([a-zA-Z]+)/);
        const pidMatch = sysPart.match(/MainPID=(\d+)/);
        if (activeMatch) {
          const state = activeMatch[1].toLowerCase();
          const pid = pidMatch && pidMatch[1] !== '0' ? parseInt(pidMatch[1], 10) : undefined;
          let status: RemoteServiceHealth['status'] = 'UNKNOWN';
          if (state === 'active') status = 'RUNNING';
          else if (state === 'inactive') status = 'STOPPED';
          else if (state === 'failed') status = 'FAILED';
          services.push({ name: 'openclaw', status, pid });
        }
      }

      if (procPart && procPart.trim()) {
        if (!services.some((s) => s.name === 'openclaw') && procPart.includes('openclaw:RUNNING')) {
          services.push({ name: 'openclaw', status: 'RUNNING' });
        }
        if (!services.some((s) => s.name === 'omniroute') && procPart.includes('omniroute:RUNNING')) {
          services.push({ name: 'omniroute', status: 'RUNNING' });
        }
        if (!services.some((s) => s.name === 'llama') && procPart.includes('llama:RUNNING')) {
          services.push({ name: 'llama', status: 'RUNNING' });
        }
      }

      const hardware = HardwareTelemetry.parseHardware(res.stdout, target, label);
      return { services, hardware };
    }

    return { services, hardware: null };
  }
}
