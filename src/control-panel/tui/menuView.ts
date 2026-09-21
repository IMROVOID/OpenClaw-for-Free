import { ansi, badges, padRight } from './ansi.js';
import { Box } from './box.js';
import { ControlPanelConfig, ServiceStatus, StatusState } from '../core/types.js';

export interface MenuItemHitbox {
  index: number;
  row: number;
  colStart: number;
  colEnd: number;
  key: string;
  disabled?: boolean;
}

export class MenuView {
  static itemHitboxes: MenuItemHitbox[] = [];

  static render(
    config: ControlPanelConfig,
    status: ServiceStatus,
    selectedIndex: number,
    width: number,
    startRow = 1
  ): { lines: string[]; hitboxes: MenuItemHitbox[] } {
    this.itemHitboxes = [];
    const lines: string[] = [];
    const boxWidth = Math.min(width, 92);

    // 1. Header Banner
    const isFreestyle = config.provider === 'freestyle';
    const headerTitle = isFreestyle
      ? 'OPENCLAW & FREESTYLE CLOUD CONTROL PANEL'
      : 'OPENCLAW & DAYTONA CLOUD CONTROL PANEL';
    lines.push(Box.header(headerTitle, boxWidth, ansi.cyan, ansi.brightCyan + ansi.bold));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    const primaryLabel = isFreestyle ? 'Primary Freestyle Target :' : 'Primary Daytona Target :';
    lines.push(Box.row(`${ansi.bold}${primaryLabel}${ansi.reset} ${ansi.brightYellow}${config.primarySshTarget || 'Not Configured (Run Setup Assistant)'}${ansi.reset}`, boxWidth, ansi.cyan));
    if (config.llama.enabled) {
      if (config.llama.isSeparateVps) {
        const secProvider = config.secondaryProvider || config.provider;
        const llamaLabel = secProvider === 'freestyle' ? 'Llama Freestyle Target   :' : 'Llama Daytona Target   :';
        const targetDesc = config.llama.sshTarget || config.secondarySshTarget || config.llama.activeEndpointUrl || 'Cloud / Remote Relay';
        lines.push(Box.row(`${ansi.bold}${llamaLabel}${ansi.reset} ${ansi.brightYellow}${targetDesc}${ansi.reset}`, boxWidth, ansi.cyan));
      } else {
        lines.push(Box.row(`${ansi.bold}Llama Topology           :${ansi.reset} ${ansi.brightYellow}Co-located (Port ${config.llamaPort})${ansi.reset}`, boxWidth, ansi.cyan));
      }
    }
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.divider(boxWidth, ansi.cyan, 'SYSTEM STATUS'));

    // 2. Status Indicators (Invisible 2-column table with aligned colons)
    const getBadge = (val: StatusState, activeBadge: string, inactiveBadge: string): string => {
      if (val === 'detecting') return badges.detecting;
      return val ? activeBadge : inactiveBadge;
    };

    const ocBadge = getBadge(status.openclaw, badges.online, badges.inactive);
    const orBadge = getBadge(status.omniroute, badges.online, badges.inactive);
    const lmBadge = !config.llama.enabled
      ? `${ansi.dim}[DISABLED]${ansi.reset}`
      : getBadge(status.llama, badges.online, badges.inactive);
    const relayBadge = getBadge(status.egressRelay, badges.online, badges.offline);

    const targetInner = Math.max(0, boxWidth - 4);
    const col1Width = Math.max(42, Math.floor(targetInner / 2));

    const directEgressBadge = status.primarySsh === 'detecting'
      ? badges.detecting
      : (status.primarySsh ? `${ansi.brightGreen}[ONLINE DIRECT]${ansi.reset}` : badges.offline);
    const col2Label = isFreestyle ? 'Network Egress' : 'Railway Relay (Egress)';
    const col2Badge = isFreestyle ? directEgressBadge : relayBadge;

    const col1Row1 = `${padRight(`OpenClaw (Port ${config.openclawPort})`, 23)} : ${ocBadge}`;
    const col2Row1 = `${padRight(`OmniRoute (Port ${config.omniroutePort})`, 23)} : ${orBadge}`;
    const col1Row2 = `${padRight(`Llama AI (Port ${config.llamaPort})`, 23)} : ${lmBadge}`;
    const col2Row2 = `${padRight(col2Label, 23)} : ${col2Badge}`;

    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`${padRight(col1Row1, col1Width)}${col2Row1}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`${padRight(col1Row2, col1Width)}${col2Row2}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.divider(boxWidth, ansi.cyan, 'ACTIONS'));

    // 3. Menu Options
    lines.push(Box.row('', boxWidth, ansi.cyan));
    const options = [
      { key: '1', title: 'Open OpenClaw (Browser)', desc: 'Open configured public URL or SSH forwarding; copy token' },
      { key: '2', title: 'Open OmniRoute (Browser)', desc: 'Open configured public URL or SSH forwarding; copy password' },
      ...(config.llama.enabled ? [{ key: '3', title: 'Open Llama WebUI (Browser)', desc: 'Open configured public URL or SSH forwarding; copy URL' }] : []),
      { key: '4', title: 'Service Manager (Start/Stop/Restart)', desc: 'Control remote daemons & reconnect local tunnels' },
      { key: '5', title: 'VPS Diagnostics & Telemetry', desc: 'Real-time supervisor daemons, ports & network check' },
      { key: '6', title: 'VPS & Service Logs', desc: 'Inspect live tail logs for OpenClaw, OmniRoute, Llama & Relay' },
      { key: '7', title: 'Remote Terminal (SSH Shell)', desc: 'Open interactive shell in a dedicated terminal window' },
      { key: '8', title: 'Setup Assistant (Onboarding)', desc: 'Configure VPS specs, AI providers, Llama & WebUI access' },
      { key: '9', title: 'Quick Model / API Ping', desc: 'Send a live test completion through OmniRoute or local Llama' },
      { key: 'L', title: 'Logout', desc: 'Clear local saved credentials and reset session' },
      { key: 'Q', title: 'Exit Control Panel', desc: 'Close local window; all remote VPS services keep running' }
    ];

    options.forEach((opt, idx) => {
      const isSelected = idx === selectedIndex;
      const isBrowserAction = opt.key === '1' || opt.key === '2' || opt.key === '3';
      const serviceState = opt.key === '1' ? status.openclaw : opt.key === '2' ? status.omniroute : status.llama;
      const isDisabled = isBrowserAction && serviceState !== true;
      const isDetecting = isBrowserAction && serviceState === 'detecting';

      let stateTag = '';
      if (isDisabled) {
        stateTag = isDetecting
          ? ` ${ansi.yellow}[Detecting...]${ansi.reset}`
          : ` ${ansi.red}[Disabled - Inactive]${ansi.reset}`;
      }

      let keyBadge: string;
      let titleStr: string;
      let descStr: string;

      if (isSelected) {
        keyBadge = `${ansi.brightCyan}[${opt.key}]${ansi.reset}`;
        titleStr = `${ansi.bold}${ansi.brightWhite}${opt.title}${ansi.reset}${stateTag}`;
        descStr = isDisabled ? `${ansi.dim}— ${opt.desc}${ansi.reset}` : `${ansi.brightWhite}— ${opt.desc}${ansi.reset}`;
      } else if (isDisabled) {
        keyBadge = `${ansi.dim}[${opt.key}]${ansi.reset}`;
        titleStr = `${ansi.dim}${opt.title}${ansi.reset}${stateTag}`;
        descStr = `${ansi.dim}— ${opt.desc}${ansi.reset}`;
      } else {
        keyBadge = `${ansi.brightYellow}[${opt.key}]${ansi.reset}`;
        titleStr = `${ansi.brightWhite}${opt.title}${ansi.reset}`;
        descStr = `${ansi.dim}— ${opt.desc}${ansi.reset}`;
      }

      const currentRow = startRow + lines.length;
      this.itemHitboxes.push({
        index: idx,
        row: currentRow,
        colStart: 3,
        colEnd: boxWidth - 3,
        key: opt.key,
        disabled: isDisabled
      });

      const bg = isSelected ? ansi.bgSelect : '';
      lines.push(Box.row(` ${keyBadge} ${titleStr} ${descStr}`, boxWidth, ansi.cyan, bg));
    });

    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[↑/↓/Wheel] Navigate  [ENTER/Click] Select  [1-9] Quick Action  [Q/ESC] Exit', boxWidth, ansi.cyan));

    return { lines, hitboxes: this.itemHitboxes };
  }
}
