import { ansi } from '../tui/ansi.js';

export interface VpsLiveHardware {
  target: string;
  label: string;
  load1: number;
  cpuPercent: number;
  cores: number;
  ramUsedMb: number;
  ramTotalMb: number;
  ramPercent: number;
  diskUsedMb: number;
  diskTotalMb: number;
  diskPercent: number;
}

export class HardwareTelemetry {
  static getTelemetryCommand(): string {
    return 'echo "---HARDWARE---"; cat /proc/loadavg 2>/dev/null; free -m 2>/dev/null | grep -i mem; df -m / 2>/dev/null | tail -n 1; nproc 2>/dev/null || echo 4';
  }

  static parseHardware(text: string, target: string, label: string): VpsLiveHardware | null {
    if (!text || !text.includes('---HARDWARE---')) return null;

    const part = text.split('---HARDWARE---')[1];
    if (!part) return null;

    const lines = part.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) return null;

    // Line 0: /proc/loadavg
    const loadTokens = lines[0].split(/\s+/);
    const load1 = parseFloat(loadTokens[0]) || 0;

    // Line 1: free -m (Mem: total used free ...)
    const memTokens = lines[1].split(/\s+/);
    const ramTotalMb = parseInt(memTokens[1], 10) || 1;
    const ramUsedMb = parseInt(memTokens[2], 10) || 0;
    const ramPercent = Math.min(100, Math.max(0, Math.round((ramUsedMb / ramTotalMb) * 100)));

    // Line 2: df -m /
    const diskTokens = lines[2].split(/\s+/);
    const diskTotalMb = parseInt(diskTokens[1], 10) || 1;
    const diskUsedMb = parseInt(diskTokens[2], 10) || 0;
    const diskPercentToken = diskTokens[4] ? parseInt(diskTokens[4].replace('%', ''), 10) : NaN;
    const diskPercent = !isNaN(diskPercentToken)
      ? diskPercentToken
      : Math.min(100, Math.max(0, Math.round((diskUsedMb / diskTotalMb) * 100)));

    // Line 3: nproc
    const cores = lines[3] ? parseInt(lines[3], 10) || 4 : 4;
    const cpuPercent = Math.min(100, Math.max(0, Math.round((load1 / cores) * 100)));

    return {
      target,
      label,
      load1,
      cpuPercent,
      cores,
      ramUsedMb,
      ramTotalMb,
      ramPercent,
      diskUsedMb,
      diskTotalMb,
      diskPercent
    };
  }

  static renderBar(percent: number, barLength = 10): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const filledCount = Math.round((clamped / 100) * barLength);
    const emptyCount = barLength - filledCount;

    let color = ansi.green;
    if (clamped > 80) color = ansi.red;
    else if (clamped > 50) color = ansi.yellow;

    const filledStr = `${color}${'■'.repeat(filledCount)}${ansi.reset}`;
    const emptyStr = `${ansi.dim}${'□'.repeat(emptyCount)}${ansi.reset}`;
    const pctStr = `${clamped}%`.padStart(4);

    return `[${filledStr}${emptyStr}] ${pctStr}`;
  }

  static formatMb(mb: number): string {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  }
}
