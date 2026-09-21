/**
 * ANSI Styling, Colors, Badges, and String Utilities.
 */

export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgDarkGray: '\x1b[100m',
  bgSelect: '\x1b[48;5;24m',
  bgHighlight: '\x1b[48;5;31m'
};

export const badges = {
  ok: `${ansi.bgGreen}${ansi.brightWhite} OK ${ansi.reset}`,
  warn: `${ansi.bgYellow}${ansi.black} WARN ${ansi.reset}`,
  error: `${ansi.bgRed}${ansi.brightWhite} FAIL ${ansi.reset}`,
  connecting: `${ansi.bgCyan}${ansi.black} CONNECTING ${ansi.reset}`,
  online: `${ansi.brightGreen}[ONLINE]${ansi.reset}`,
  offline: `${ansi.brightRed}[OFFLINE]${ansi.reset}`,
  tunnel: `${ansi.brightCyan}[TUNNEL ACTIVE]${ansi.reset}`,
  inactive: `${ansi.dim}[INACTIVE]${ansi.reset}`,
  detecting: `${ansi.brightYellow}[DETECTING...]${ansi.reset}`
};

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

export function padRight(str: string, length: number, char = ' '): string {
  const vis = visibleWidth(str);
  if (vis >= length) return str;
  return str + char.repeat(length - vis);
}

export function padLeft(str: string, length: number, char = ' '): string {
  const vis = visibleWidth(str);
  if (vis >= length) return str;
  return char.repeat(length - vis) + str;
}

export function truncateAnsi(str: string, maxLength: number): string {
  if (visibleWidth(str) <= maxLength) return str;

  let visCount = 0;
  let result = '';
  let inEscape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '\x1b' && str[i + 1] === '[') {
      inEscape = true;
    }
    if (inEscape) {
      result += char;
      if (char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z') {
        inEscape = false;
      }
      continue;
    }

    visCount++;
    if (visCount <= maxLength) {
      result += char;
    } else {
      break;
    }
  }

  return result + ansi.reset;
}
