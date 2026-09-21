import { ansi, visibleWidth, padRight, truncateAnsi } from './ansi.js';

export class Box {
  static header(title: string, width: number, borderAnsi = ansi.cyan, titleAnsi = ansi.brightWhite + ansi.bold): string {
    const titleVis = visibleWidth(title);
    const prefix = `${borderAnsi}┌─[ ${titleAnsi}${title}${ansi.reset}${borderAnsi} ]`;
    const prefixVis = titleVis + 6;
    const fillerLen = Math.max(0, width - prefixVis - 1);
    return `${prefix}${'─'.repeat(fillerLen)}┐${ansi.reset}`;
  }

  static row(content: string, width: number, borderAnsi = ansi.cyan, bgAnsi = ''): string {
    const targetInner = Math.max(0, width - 4);
    let safeContent = truncateAnsi(content, targetInner);
    if (bgAnsi) {
      safeContent = safeContent.split(ansi.reset).join(ansi.reset + bgAnsi);
    }
    const padded = padRight(safeContent, targetInner, ' ');
    if (bgAnsi) {
      return `${borderAnsi}│${ansi.reset}${bgAnsi} ${padded} ${ansi.reset}${borderAnsi}│${ansi.reset}`;
    }
    return `${borderAnsi}│${ansi.reset} ${padded} ${borderAnsi}│${ansi.reset}`;
  }

  static divider(width: number, borderAnsi = ansi.cyan, title = ''): string {
    if (!title) {
      return `${borderAnsi}├${'─'.repeat(Math.max(0, width - 2))}┤${ansi.reset}`;
    }
    const titleVis = visibleWidth(title);
    const prefix = `${borderAnsi}├─[ ${ansi.brightWhite}${title}${ansi.reset}${borderAnsi} ]`;
    const prefixVis = titleVis + 6;
    const fillerLen = Math.max(0, width - prefixVis - 1);
    return `${prefix}${'─'.repeat(fillerLen)}┤${ansi.reset}`;
  }

  static footer(helpText: string, width: number, borderAnsi = ansi.cyan): string {
    if (!helpText) {
      return `${borderAnsi}└──${'─'.repeat(Math.max(0, width - 6))}──┘${ansi.reset}`;
    }
    const textVis = visibleWidth(helpText);
    const prefix = `${borderAnsi}└─[ ${ansi.dim}${helpText}${ansi.reset}${borderAnsi} ]`;
    const prefixVis = textVis + 6;
    const fillerLen = Math.max(0, width - prefixVis - 1);
    return `${prefix}${'─'.repeat(fillerLen)}┘${ansi.reset}`;
  }
}
