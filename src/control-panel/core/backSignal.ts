/**
 * Sentinel error signal thrown when user inputs back/exit signal during interactive onboarding.
 */
export class BackStepSignal extends Error {
  constructor(message = 'User requested back navigation') {
    super(message);
    this.name = 'BackStepSignal';
  }
}

/**
 * Checks if user input represents a back or exit navigation intent (0, ESC, b, back, exit).
 */
export function isBackInput(val?: string | null): boolean {
  if (!val) return false;
  const clean = val.trim().toLowerCase();
  return clean === '0' || clean === 'esc' || clean === '\u001b' || clean === 'exit' || clean === 'b' || clean === 'back';
}
