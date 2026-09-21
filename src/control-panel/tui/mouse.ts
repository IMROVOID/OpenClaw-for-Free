export interface MouseEvent {
  button: number;   // 0: left, 1: middle, 2: right, 32: mouseMove, 64: scrollUp, 65: scrollDown
  col: number;      // 1-indexed X
  row: number;      // 1-indexed Y
  type: 'press' | 'release' | 'move';
}

export function extractMouseEvents(str: string): { events: MouseEvent[]; remainingText: string } {
  const events: MouseEvent[] = [];
  let remaining = str;

  const matches = str.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g);
  for (const m of matches) {
    const btn = parseInt(m[1], 10);
    const col = parseInt(m[2], 10);
    const row = parseInt(m[3], 10);
    const isPress = m[4] === 'M';

    let evType: 'press' | 'release' | 'move' = isPress ? 'press' : 'release';
    if ((btn & 32) === 32) {
      evType = 'move';
    }

    events.push({
      button: btn,
      col,
      row,
      type: evType
    });
  }

  remaining = remaining.replace(/\x1b\[<\d+;\d+;\d+[Mm]?/g, '');
  remaining = remaining.replace(/\x1b\[M.{3}/g, '');
  remaining = remaining.replace(/<\d+;\d+;\d+[Mm]?/g, '');
  remaining = remaining.replace(/\b\d+;\d+;\d+[Mm]/g, '');

  // Guard: only discard leftover mouse sequences that contain semicolons or mouse markers
  const trimmed = remaining.trim();
  if (trimmed && (trimmed.includes(';') || trimmed.startsWith('<')) && /^[\d;Mm\s<]+$/.test(trimmed)) {
    remaining = '';
  }

  return { events, remainingText: remaining };
}
