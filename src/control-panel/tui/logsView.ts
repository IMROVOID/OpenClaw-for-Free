import { ansi } from './ansi.js';
import { Box } from './box.js';
import { LogServiceType } from '../core/vpsLogFetcher.js';
import { CloudProviderType } from '../core/types.js';

export interface LogTabHitbox {
  id: LogServiceType;
  row: number;
  colStart: number;
  colEnd: number;
}

export interface LogsRenderResult {
  lines: string[];
  hitboxes: LogTabHitbox[];
}

export class LogsView {
  static getTabs(provider: CloudProviderType = 'daytona'): Array<{ id: LogServiceType; label: string; num: string }> {
    const allTabs: Array<{ id: LogServiceType; label: string; num: string }> = [
      { id: 'openclaw', label: 'OpenClaw Gateway', num: '1' },
      { id: 'omniroute', label: 'OmniRoute Router', num: '2' },
      { id: 'llama', label: 'Llama Server', num: '3' },
      { id: 'xray', label: 'Railway Relay', num: '4' }
    ];
    return provider === 'freestyle' ? allTabs.filter((t) => t.id !== 'xray') : allTabs;
  }

  static render(
    service: LogServiceType,
    target: string,
    logLines: string[],
    width: number,
    provider: CloudProviderType = 'daytona'
  ): LogsRenderResult {
    const lines: string[] = [];
    const hitboxes: LogTabHitbox[] = [];
    const boxWidth = Math.min(width, 92);

    const title = provider === 'freestyle'
      ? 'FREESTYLE.SH VPS LIVE SERVICE LOGS'
      : 'DAYTONA VPS LIVE SERVICE LOGS';
    lines.push(Box.header(title, boxWidth, ansi.cyan, ansi.brightCyan + ansi.bold));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`${ansi.bold}Target Server :${ansi.reset} ${ansi.brightYellow}${target}${ansi.reset}`, boxWidth, ansi.cyan));

    const tabs = this.getTabs(provider);
    const tabRowIndex = lines.length + 1; // 1-indexed terminal row for the tabs

    let currentOffset = 0;
    const tabSegments: string[] = [];

    tabs.forEach((t) => {
      const isCur = t.id === service;
      const rawBadge = `[${t.num}] ${t.label}`;
      const rawText = ` ${rawBadge} `;
      const startCol = 3 + currentOffset;
      const endCol = startCol + rawText.length - 1;

      hitboxes.push({
        id: t.id,
        row: tabRowIndex,
        colStart: startCol,
        colEnd: endCol
      });

      currentOffset += rawText.length + 1; // +1 for the separator space

      if (isCur) {
        tabSegments.push(`${ansi.bgSelect}${ansi.brightWhite}${ansi.bold}${rawText}${ansi.reset}`);
      } else {
        tabSegments.push(`${ansi.dim}${rawText}${ansi.reset}`);
      }
    });

    lines.push(Box.row(tabSegments.join(' '), boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.divider(boxWidth, ansi.cyan, `${service.toUpperCase()} LOG STREAM`));
    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Show last 16 lines
    const displayLines = logLines.slice(-16);
    if (displayLines.length === 0 || (displayLines.length === 1 && !displayLines[0].trim())) {
      lines.push(Box.row(`${ansi.dim}Waiting for remote log events...${ansi.reset}`, boxWidth, ansi.cyan));
    } else {
      displayLines.forEach((l) => {
        let clean = l.replace(/\r/g, '').trimEnd();
        if (clean.includes('ERROR') || clean.includes('FATAL') || clean.includes('failed')) {
          clean = `${ansi.red}${clean}${ansi.reset}`;
        } else if (clean.includes('WARN') || clean.includes('warning')) {
          clean = `${ansi.yellow}${clean}${ansi.reset}`;
        } else if (clean.includes('INFO') || clean.includes('listening')) {
          clean = `${ansi.green}${clean}${ansi.reset}`;
        } else {
          clean = `${ansi.dim}${clean}${ansi.reset}`;
        }
        lines.push(Box.row(` ${clean}`, boxWidth, ansi.cyan));
      });
    }

    // Pad if fewer than 10 lines
    for (let i = displayLines.length; i < 10; i++) {
      lines.push(Box.row('', boxWidth, ansi.cyan));
    }

    lines.push(Box.row('', boxWidth, ansi.cyan));
    const switchPrompt = provider === 'freestyle' ? '[1-3 / ← →] Switch Tab' : '[1-4 / ← →] Switch Tab';
    lines.push(Box.footer(`${switchPrompt}  ·  [Click Tab] Select  ·  [R] Refresh  ·  [ESC / B / Right-Click] Return`, boxWidth, ansi.cyan));

    return { lines, hitboxes };
  }
}
