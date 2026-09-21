import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BotLogger } from '../src/telegram-bot/services/botLogger.js';

describe('BotLogger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-logger-test-'));
    BotLogger.setLogDir(tmpDir);
  });

  afterEach(() => {
    BotLogger.unhookConsole();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('sanitize', () => {
    it('redacts Telegram bot token', () => {
      const input = 'Starting bot with token 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456789...';
      const clean = BotLogger.sanitize(input);
      assert.ok(!clean.includes('123456789:ABCdef'));
      assert.ok(clean.includes('<TELEGRAM_TOKEN_REDACTED>'));
    });

    it('redacts Railway token', () => {
      const input = 'Using token rlw_abc123456789xyz';
      const clean = BotLogger.sanitize(input);
      assert.ok(!clean.includes('rlw_abc123456789xyz'));
      assert.ok(clean.includes('<RAILWAY_TOKEN_REDACTED>'));
    });

    it('redacts passwords and keys', () => {
      const input = 'omniroutePassword="supersecretpass" apiKey: "rlw_key"';
      const clean = BotLogger.sanitize(input);
      assert.ok(!clean.includes('supersecretpass'));
      assert.ok(clean.includes('omniroutePassword=<REDACTED>'));
    });
  });

  describe('dated log writing and retrieval', () => {
    it('writes log entry with level and timestamp to dated file', () => {
      BotLogger.info('Test bot started successfully');
      BotLogger.warn('Warning: connection retry 1');
      BotLogger.error('Error: socket closed');

      const today = new Date().toISOString().slice(0, 10);
      const expectedFile = path.join(tmpDir, `bot-${today}.log`);
      assert.ok(fs.existsSync(expectedFile));

      const content = fs.readFileSync(expectedFile, 'utf-8');
      assert.ok(content.includes('[INFO] Test bot started successfully'));
      assert.ok(content.includes('[WARN] Warning: connection retry 1'));
      assert.ok(content.includes('[ERROR] Error: socket closed'));
    });

    it('reads recent logs via getRecentLogs', () => {
      for (let i = 1; i <= 10; i++) {
        BotLogger.info(`Log line ${i}`);
      }
      const recent = BotLogger.getRecentLogs(3);
      const lines = recent.split('\n');
      assert.equal(lines.length, 3);
      assert.ok(lines[0].includes('Log line 8'));
      assert.ok(lines[1].includes('Log line 9'));
      assert.ok(lines[2].includes('Log line 10'));
    });
  });

  describe('hookConsole', () => {
    it('intercepts console.log, console.warn, console.error and writes to dated file', () => {
      BotLogger.hookConsole();

      console.log('Console log message');
      console.warn('Console warn message');
      console.error('Console error message');

      const today = new Date().toISOString().slice(0, 10);
      const expectedFile = path.join(tmpDir, `bot-${today}.log`);
      const content = fs.readFileSync(expectedFile, 'utf-8');

      assert.ok(content.includes('[INFO] Console log message'));
      assert.ok(content.includes('[WARN] Console warn message'));
      assert.ok(content.includes('[ERROR] Console error message'));
    });
  });
});
