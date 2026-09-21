import { ansi, badges } from './ansi.js';
import { Box } from './box.js';
import { ControlPanelConfig } from '../core/types.js';
import { RemoteServiceHealth } from '../core/vpsProbe.js';
import { ManagedService } from '../core/serviceController.js';

export interface ServiceItem {
  id: ManagedService;
  name: string;
  port: number | string;
  description: string;
}

export class ServiceManagerView {
  static readonly services: ServiceItem[] = [
    { id: 'openclaw', name: 'OpenClaw Gateway', port: 18789, description: 'Telegram/Discord Agent Gateway' },
    { id: 'omniroute', name: 'OmniRoute Router', port: 20128, description: 'AI Model Proxy & Dashboard' },
    { id: 'xray', name: 'Railway Relay (Xray)', port: 10808, description: 'Outbound Egress & Discord Tunnel' },
    { id: 'llama', name: 'Llama AI Server', port: 8080, description: 'Self-hosted LLM Inference Daemon' }
  ];

  static render(
    config: ControlPanelConfig,
    remoteServices: RemoteServiceHealth[],
    selectedIndex: number,
    width: number
  ): string[] {
    const lines: string[] = [];
    const boxWidth = Math.min(width, 92);

    lines.push(Box.header('REMOTE SERVICE MANAGER [START / STOP / RESTART]', boxWidth, ansi.cyan, ansi.brightCyan + ansi.bold));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    const hasSec = config.llama.enabled && config.llama.isSeparateVps && (config.llama.sshTarget || config.secondarySshTarget);
    const secTarget = config.llama.sshTarget || config.secondarySshTarget;
    lines.push(Box.row(`${ansi.bold}Primary Target :${ansi.reset} ${ansi.brightYellow}${config.primarySshTarget}${ansi.reset}`, boxWidth, ansi.cyan));
    if (hasSec) {
      lines.push(Box.row(`${ansi.bold}Llama Target   :${ansi.reset} ${ansi.brightYellow}${secTarget}${ansi.reset}`, boxWidth, ansi.cyan));
    }
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.divider(boxWidth, ansi.cyan, 'SELECT SERVICE'));

    lines.push(Box.row('', boxWidth, ansi.cyan));
    this.services.forEach((s, idx) => {
      const isSelected = idx === selectedIndex;
      const remote = remoteServices.find((r) => r.name.toLowerCase().includes(s.id));
      let statusBadge = badges.offline;

      if (s.id === 'llama' && !config.llama.enabled) {
        statusBadge = `${ansi.dim}[DISABLED]${ansi.reset}`;
      } else if (remote) {
        if (remote.status === 'RUNNING') statusBadge = badges.online;
        else if (remote.status === 'STOPPED') statusBadge = `${ansi.dim}[STOPPED]${ansi.reset}`;
        else statusBadge = badges.error;
      }

      const numBadge = isSelected
        ? `${ansi.brightCyan}[${idx + 1}]${ansi.reset}`
        : `${ansi.brightYellow}[${idx + 1}]${ansi.reset}`;
      const titleStr = isSelected
        ? `${ansi.bold}${ansi.brightWhite}${s.name.padEnd(22)}${ansi.reset}`
        : `${ansi.brightWhite}${s.name.padEnd(22)}${ansi.reset}`;
      const portStr = `${ansi.dim}(Port ${s.port})${ansi.reset}`.padEnd(14);
      const bg = isSelected ? ansi.bgSelect : '';

      lines.push(Box.row(` ${numBadge} ${titleStr} ${portStr} ${statusBadge}  ${ansi.dim}${s.description}${ansi.reset}`, boxWidth, ansi.cyan, bg));
    });
    lines.push(Box.row('', boxWidth, ansi.cyan));

    lines.push(Box.divider(boxWidth, ansi.cyan, 'ACTIONS FOR SELECTED SERVICE'));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`  ${ansi.brightGreen}[S] Start Service${ansi.reset}   ${ansi.brightYellow}[R] Restart Service${ansi.reset}   ${ansi.brightRed}[X] Stop Service${ansi.reset}   ${ansi.brightCyan}[U] Update Service${ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`  ${ansi.brightBlue}[A] Restart ALL Daemons${ansi.reset}                 ${ansi.brightMagenta}[T] Reconnect SSH Tunnels${ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));

    lines.push(Box.footer('[↑/↓/1-4] Select  ·  [S] Start  ·  [R] Restart  ·  [X] Stop  ·  [U] Update  ·  [ESC/B] Back', boxWidth, ansi.cyan));

    return lines;
  }
}
