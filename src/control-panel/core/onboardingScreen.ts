import readline from 'readline';
import { stripAnsi } from '../tui/ansi.js';
import { isBackInput, BackStepSignal } from './backSignal.js';

export interface StepSection {
  step: number;
  lines: string[];
}

/**
 * Manages the onboarding terminal screen buffer.
 * Automatically captures logged output and dims previous onboarding step texts
 * into dark gray (\x1b[2m\x1b[90m) so that the current active step is cleanly
 * separated and highlighted.
 */
export class OnboardingScreen {
  private rl: readline.Interface;
  private sections: StepSection[] = [];
  private currentLines: string[] = [];
  private activeStep = 1;
  private origWrite = process.stdout.write.bind(process.stdout);
  private partial = '';
  private attached = false;
  private rendering = false;
  private inAsk = false;

  constructor(rl: readline.Interface) {
    this.rl = rl;
  }

  setStep(step: number): void {
    if (step !== this.activeStep) {
      if (this.currentLines.length > 0 || this.partial) {
        this.commitSection();
      }
      this.activeStep = step;
    }
  }

  getStep(): number {
    return this.activeStep;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;

    process.stdout.write = (chunk: any, encoding?: any, cb?: any) => {
      if (this.rendering || this.inAsk) {
        return this.origWrite(chunk, encoding, cb);
      }
      const str = String(chunk);
      if (str.includes('\n')) {
        const parts = str.split('\n');
        this.currentLines.push(this.partial + parts[0]);
        for (let i = 1; i < parts.length - 1; i++) {
          this.currentLines.push(parts[i]);
        }
        this.partial = parts[parts.length - 1];
      } else {
        this.partial += str;
      }
      return this.origWrite(chunk, encoding, cb);
    };
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    process.stdout.write = this.origWrite;
  }

  commitSection(): void {
    if (this.partial) {
      this.currentLines.push(this.partial);
      this.partial = '';
    }
    if (this.currentLines.length > 0) {
      this.sections.push({
        step: this.activeStep,
        lines: [...this.currentLines]
      });
      this.currentLines = [];
      this.render();
    }
  }

  rollbackStep(targetStep: number): void {
    this.activeStep = targetStep;
    this.partial = '';
    this.currentLines = [];
    this.sections = this.sections.filter((s) => s.step < targetStep);
    this.render();
  }

  static formatDimmedLine(rawLine: string): string {
    const plain = stripAnsi(rawLine).replace(/\r/g, '').trimEnd();
    if (!plain.trim()) return '';
    return `\x1b[2m\x1b[90m${plain}\x1b[0m`;
  }

  render(): void {
    this.rendering = true;
    try {
      if (process.stdout.isTTY) {
        this.origWrite('\x1b[2J\x1b[0f');
      }
      const dimmedLines: string[] = [];
      let prevWasEmpty = false;
      for (const sec of this.sections) {
        for (const rawLine of sec.lines) {
          const plain = stripAnsi(rawLine).replace(/\r/g, '').trimEnd();
          const isEmpty = !plain.trim();
          if (isEmpty) {
            if (!prevWasEmpty && dimmedLines.length > 0) {
              dimmedLines.push('');
              prevWasEmpty = true;
            }
          } else {
            prevWasEmpty = false;
            dimmedLines.push(OnboardingScreen.formatDimmedLine(rawLine));
          }
        }
      }

      // Vertical centering: keep active step in middle of terminal, not pushed to bottom
      const termRows = process.stdout.rows || 25;
      const targetMiddle = Math.max(3, Math.floor(termRows * 0.38));

      if (dimmedLines.length < targetMiddle) {
        const topPadding = targetMiddle - dimmedLines.length;
        for (let i = 0; i < topPadding; i++) {
          this.origWrite('\n');
        }
        for (const line of dimmedLines) {
          this.origWrite(line + '\n');
        }
      } else {
        const keepCount = Math.max(2, targetMiddle - 2);
        const sliced = dimmedLines.slice(-keepCount);
        this.origWrite(`\x1b[2m\x1b[90m... [earlier steps dimmed above]\x1b[0m\n`);
        for (const line of sliced) {
          this.origWrite(line + '\n');
        }
      }

      if (dimmedLines.length > 0) {
        this.origWrite('\n');
      }
    } finally {
      this.rendering = false;
    }
  }

  ask(question: string, defaultValue = '', allowBack = true): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.partial) {
        this.currentLines.push(this.partial);
        this.partial = '';
      }
      this.inAsk = true;
      const promptText = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      this.rl.question(promptText, (ans) => {
        this.inAsk = false;
        const clean = ans.trim();
        const finalVal = clean || defaultValue;
        if (allowBack && isBackInput(clean)) {
          this.partial = '';
          return reject(new BackStepSignal());
        }
        this.currentLines.push(`${promptText}${finalVal}`);
        this.commitSection();
        resolve(finalVal);
      });
    });
  }
}
