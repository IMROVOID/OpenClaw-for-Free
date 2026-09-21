import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../../control-panel/core/configManager.js';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class BotLogger {
  private static logDir = path.join(ConfigManager.getTelegramDataDir(), 'logs');
  private static currentDate = '';
  private static currentFilePath = '';
  private static isHooked = false;

  private static origLog = console.log;
  private static origInfo = console.info;
  private static origWarn = console.warn;
  private static origError = console.error;

  static setLogDir(customDir: string): void {
    this.logDir = customDir;
    this.currentDate = '';
    this.currentFilePath = '';
  }

  static getLogDir(): string {
    return this.logDir;
  }

  static sanitize(text: string): string {
    if (!text) return '';
    return text
      // Redact Telegram bot tokens (e.g. 123456789:ABCdef...)
      .replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '<TELEGRAM_TOKEN_REDACTED>')
      // Redact Railway tokens
      .replace(/\brlw_[A-Za-z0-9_-]{10,}\b/g, '<RAILWAY_TOKEN_REDACTED>')
      // Redact private keys
      .replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, '<PRIVATE_KEY_REDACTED>')
      // Redact common secret key-value assignments
      .replace(/(password|token|secret|apiKey|api_key)\s*[:=]\s*["']?([^\s"']+)["']?/gi, '$1=<REDACTED>');
  }

  private static getLogFilePath(): string {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (today !== this.currentDate || !this.currentFilePath) {
      this.currentDate = today;
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.currentFilePath = path.join(this.logDir, `bot-${today}.log`);
    }
    return this.currentFilePath;
  }

  static write(level: LogLevel, ...args: unknown[]): void {
    try {
      const filePath = this.getLogFilePath();
      const rawMsg = args
        .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a)))
        .join(' ');
      const cleanMsg = this.sanitize(rawMsg);
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] [${level}] ${cleanMsg}\n`;
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch (_) {
      // Fallback: don't crash if logging fails
    }
  }

  static info(...args: unknown[]): void {
    this.write('INFO', ...args);
  }

  static warn(...args: unknown[]): void {
    this.write('WARN', ...args);
  }

  static error(...args: unknown[]): void {
    this.write('ERROR', ...args);
  }

  static debug(...args: unknown[]): void {
    this.write('DEBUG', ...args);
  }

  /**
   * Hooks process console functions to simultaneously write into dated log files.
   */
  static hookConsole(): void {
    if (this.isHooked) return;
    this.isHooked = true;

    console.log = (...args: unknown[]) => {
      this.write('INFO', ...args);
      this.origLog.apply(console, args);
    };

    console.info = (...args: unknown[]) => {
      this.write('INFO', ...args);
      this.origInfo.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      this.write('WARN', ...args);
      this.origWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      this.write('ERROR', ...args);
      this.origError.apply(console, args);
    };
  }

  /**
   * Restores original console methods (for testing).
   */
  static unhookConsole(): void {
    if (!this.isHooked) return;
    console.log = this.origLog;
    console.info = this.origInfo;
    console.warn = this.origWarn;
    console.error = this.origError;
    this.isHooked = false;
  }

  /**
   * Retrieves the last N lines from the active dated log file.
   */
  static getRecentLogs(maxLines = 50): string {
    try {
      const filePath = this.getLogFilePath();
      if (!fs.existsSync(filePath)) {
        return 'No log entries found for today.';
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.slice(-maxLines).join('\n') || 'No log entries found for today.';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Failed to read bot logs: ${msg}`;
    }
  }
}
