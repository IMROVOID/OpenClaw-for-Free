import { ansi, badges } from './ansi.js';
import { Box } from './box.js';
import { ControlPanelConfig } from '../core/types.js';
import { RemoteServiceHealth } from '../core/vpsProbe.js';
import { HardwareTelemetry, VpsLiveHardware } from '../core/hardwareTelemetry.js';

export class DiagnosticsView {
  static render(
    config: ControlPanelConfig,
    services: RemoteServiceHealth[],
    ports: { openclaw: boolean; omniroute: boolean; llama: boolean; proxy: boolean },
    egressInfo: { active: boolean; response?: string },
    specs: { cpuCores: number; ramGb: number; storageGb: number },
    width: number,
    hardware?: {
      primary: VpsLiveHardware | null;
      secondary: VpsLiveHardware | null;
    }
  ): string[] {
    const lines: string[] = [];
    const boxWidth = Math.min(width, 92);

    const title = config.provider === 'freestyle'
      ? 'FREESTYLE.SH VPS LIVE TELEMETRY & DIAGNOSTICS'
      : 'DAYTONA VPS LIVE TELEMETRY & DIAGNOSTICS';
    lines.push(Box.header(title, boxWidth, ansi.cyan, ansi.brightCyan + ansi.bold));
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Target servers
    const primaryName = config.primarySshTarget.split('@')[0] || 'primary';
    lines.push(Box.row(`${ansi.bold}Primary Target   :${ansi.reset} ${config.primarySshTarget}`, boxWidth, ansi.cyan));
    const secTarget = config.secondarySshTarget || (config.llama.enabled && config.llama.isSeparateVps ? config.llama.sshTarget : undefined);
    if (secTarget) {
      lines.push(Box.row(`${ansi.bold}Secondary Target :${ansi.reset} ${secTarget}`, boxWidth, ansi.cyan));
    }
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Hardware Telemetry Section
    lines.push(Box.divider(boxWidth, ansi.cyan, 'HARDWARE & RESOURCE USAGE'));
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Primary VPS Hardware
    const primHw = hardware?.primary;
    if (primHw) {
      const primHeader = `${ansi.bold}${ansi.brightWhite}Primary VPS (${primaryName})${ansi.reset} ${ansi.dim}[${primHw.cores} vCPUs · ${HardwareTelemetry.formatMb(primHw.ramTotalMb)} RAM · ${HardwareTelemetry.formatMb(primHw.diskTotalMb)} Disk]${ansi.reset}`;
      lines.push(Box.row(` ${primHeader}`, boxWidth, ansi.cyan));

      const cpuBar = HardwareTelemetry.renderBar(primHw.cpuPercent);
      const ramBar = HardwareTelemetry.renderBar(primHw.ramPercent);
      const diskBar = HardwareTelemetry.renderBar(primHw.diskPercent);

      lines.push(Box.row(`   CPU Usage : ${cpuBar}  ${ansi.dim}(Load: ${primHw.load1.toFixed(2)})${ansi.reset}`, boxWidth, ansi.cyan));
      lines.push(Box.row(`   RAM Usage : ${ramBar}  ${ansi.dim}(${HardwareTelemetry.formatMb(primHw.ramUsedMb)} / ${HardwareTelemetry.formatMb(primHw.ramTotalMb)})${ansi.reset}`, boxWidth, ansi.cyan));
      lines.push(Box.row(`   Disk Space: ${diskBar}  ${ansi.dim}(${HardwareTelemetry.formatMb(primHw.diskUsedMb)} / ${HardwareTelemetry.formatMb(primHw.diskTotalMb)})${ansi.reset}`, boxWidth, ansi.cyan));
    } else {
      lines.push(Box.row(` ${ansi.bold}Primary VPS${ansi.reset}: ${specs.cpuCores} vCPUs, ${specs.ramGb} GB RAM, ${specs.storageGb} GB Storage ${ansi.dim}(querying dynamic metrics...)${ansi.reset}`, boxWidth, ansi.cyan));
    }

    // Secondary VPS Hardware (if configured)
    if (secTarget) {
      lines.push(Box.row('', boxWidth, ansi.cyan));
      const secHw = hardware?.secondary;
      const secName = secTarget.split('@')[0] || 'secondary';
      if (secHw) {
        const secHeader = `${ansi.bold}${ansi.brightWhite}Secondary VPS (${secName})${ansi.reset} ${ansi.dim}[${secHw.cores} vCPUs · ${HardwareTelemetry.formatMb(secHw.ramTotalMb)} RAM · ${HardwareTelemetry.formatMb(secHw.diskTotalMb)} Disk]${ansi.reset}`;
        lines.push(Box.row(` ${secHeader}`, boxWidth, ansi.cyan));

        const cpuBar = HardwareTelemetry.renderBar(secHw.cpuPercent);
        const ramBar = HardwareTelemetry.renderBar(secHw.ramPercent);
        const diskBar = HardwareTelemetry.renderBar(secHw.diskPercent);

        lines.push(Box.row(`   CPU Usage : ${cpuBar}  ${ansi.dim}(Load: ${secHw.load1.toFixed(2)})${ansi.reset}`, boxWidth, ansi.cyan));
        lines.push(Box.row(`   RAM Usage : ${ramBar}  ${ansi.dim}(${HardwareTelemetry.formatMb(secHw.ramUsedMb)} / ${HardwareTelemetry.formatMb(secHw.ramTotalMb)})${ansi.reset}`, boxWidth, ansi.cyan));
        lines.push(Box.row(`   Disk Space: ${diskBar}  ${ansi.dim}(${HardwareTelemetry.formatMb(secHw.diskUsedMb)} / ${HardwareTelemetry.formatMb(secHw.diskTotalMb)})${ansi.reset}`, boxWidth, ansi.cyan));
      } else {
        lines.push(Box.row(` ${ansi.bold}Secondary VPS (${secName})${ansi.reset}: ${ansi.dim}Querying dynamic metrics or offline...${ansi.reset}`, boxWidth, ansi.cyan));
      }
    }
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Supervisor Daemons Section
    lines.push(Box.divider(boxWidth, ansi.cyan, 'SUPERVISOR DAEMONS'));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    if (services.length === 0) {
      lines.push(Box.row(`${ansi.dim}No supervisor services detected or connection pending...${ansi.reset}`, boxWidth, ansi.cyan));
    } else {
      services.forEach((s) => {
        let badge = badges.error;
        if (s.status === 'RUNNING') badge = badges.ok;
        else if (s.status === 'STOPPED') badge = badges.warn;

        const pidStr = s.pid ? `(PID ${s.pid})` : '';
        const uptimeStr = s.uptime ? `uptime: ${s.uptime}` : '';
        lines.push(Box.row(` ${badge} ${ansi.bold}${s.name.padEnd(16)}${ansi.reset} ${pidStr.padEnd(12)} ${ansi.dim}${uptimeStr}${ansi.reset}`, boxWidth, ansi.cyan));
      });
    }
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Port Forwarding Section
    lines.push(Box.divider(boxWidth, ansi.cyan, 'PORT FORWARDING'));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`OpenClaw Gateway  (:${config.openclawPort}) : ${ports.openclaw ? badges.ok : badges.error}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`OmniRoute Router  (:${config.omniroutePort}) : ${ports.omniroute ? badges.ok : badges.error}`, boxWidth, ansi.cyan));
    if (config.llama.enabled) {
      lines.push(Box.row(`Llama Server      (:${config.llamaPort}) : ${ports.llama ? badges.ok : badges.error}`, boxWidth, ansi.cyan));
    }
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Network Egress
    if (config.provider === 'freestyle') {
      lines.push(Box.divider(boxWidth, ansi.cyan, 'NETWORK EGRESS'));
      lines.push(Box.row('', boxWidth, ansi.cyan));
      lines.push(Box.row(`Public Egress      : ${badges.ok} Direct Public Internet Egress (No Relay Required)`, boxWidth, ansi.cyan));
      lines.push(Box.row('', boxWidth, ansi.cyan));
    } else {
      lines.push(Box.divider(boxWidth, ansi.cyan, 'RAILWAY EGRESS TUNNEL'));
      lines.push(Box.row('', boxWidth, ansi.cyan));
      const egBadge = egressInfo.active ? badges.ok : badges.warn;
      const egText = egressInfo.response ? egressInfo.response.slice(0, 40) : 'Inactive';
      lines.push(Box.row(`Egress Reachability: ${egBadge} ${ansi.dim}${egText}${ansi.reset}`, boxWidth, ansi.cyan));
      lines.push(Box.row('', boxWidth, ansi.cyan));
    }

    lines.push(Box.footer('[ESC / B / Right-Click] Return to Menu  ·  [R] Refresh Telemetry', boxWidth, ansi.cyan));

    return lines;
  }
}
