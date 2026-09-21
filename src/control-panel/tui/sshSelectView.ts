import { ansi } from './ansi.js';
import { Box } from './box.js';
import { ControlPanelConfig } from '../core/types.js';

export interface SshSelectHitbox {
  targetType: 'primary' | 'secondary';
  row: number;
  colStart: number;
  colEnd: number;
}

export interface SshSelectResult {
  lines: string[];
  hitboxes: SshSelectHitbox[];
}

export class SshSelectView {
  static render(config: ControlPanelConfig, width: number): SshSelectResult {
    const lines: string[] = [];
    const hitboxes: SshSelectHitbox[] = [];
    const boxWidth = Math.min(width, 92);

    lines.push(Box.header('CONNECT TO REMOTE VPS VIA SSH', boxWidth, ansi.cyan, ansi.brightCyan + ansi.bold));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`${ansi.bold}Select which Virtual Machine to open in a new interactive terminal window:${ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));

    const primaryTarget = config.primarySshTarget;
    const secondaryTarget = config.secondarySshTarget ||
      (config.llama.enabled && config.llama.isSeparateVps ? config.llama.sshTarget : '') || '';

    // Primary VM Option [1]
    const row1 = lines.length + 1;
    const primBadge = `  ${ansi.bgSelect}${ansi.brightWhite}${ansi.bold} [1] Primary VM ${ansi.reset}  ${ansi.bold}${ansi.brightCyan}OpenClaw Gateway & OmniRoute${ansi.reset}`;
    lines.push(Box.row(primBadge, boxWidth, ansi.cyan));
    lines.push(Box.row(`      ${ansi.dim}Target : ${primaryTarget}${ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`      ${ansi.dim}Ports  : OpenClaw (:18789), OmniRoute (:20128)${ansi.reset}`, boxWidth, ansi.cyan));
    hitboxes.push({ targetType: 'primary', row: row1, colStart: 3, colEnd: boxWidth - 3 });

    lines.push(Box.row('', boxWidth, ansi.cyan));

    // Secondary VM Option [2]
    const row2 = lines.length + 1;
    const secBadge = `  ${ansi.bgSelect}${ansi.brightWhite}${ansi.bold} [2] Secondary VM ${ansi.reset}  ${ansi.bold}${ansi.brightMagenta}Llama.cpp Inference Server${ansi.reset}`;
    lines.push(Box.row(secBadge, boxWidth, ansi.cyan));
    lines.push(Box.row(`      ${ansi.dim}Target : ${secondaryTarget || 'Not configured'}${ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`      ${ansi.dim}Ports  : Llama Server (:8080) [Qwen 2.5 7B]${ansi.reset}`, boxWidth, ansi.cyan));
    hitboxes.push({ targetType: 'secondary', row: row2, colStart: 3, colEnd: boxWidth - 3 });

    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[1] Primary VM  ·  [2] Secondary VM  ·  [ESC / B / Right-Click] Return', boxWidth, ansi.cyan));

    return { lines, hitboxes };
  }
}
