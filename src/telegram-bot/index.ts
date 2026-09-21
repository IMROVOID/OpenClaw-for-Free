import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../control-panel/core/configManager.js';
import { createTelegramBot } from './bot.js';
import { BotConfig } from './types.js';
import { BotLogger } from './services/botLogger.js';

const LOCK_FILE = ConfigManager.getBotLockPath();

function acquireProcessLock(): boolean {
  try {
    const dir = path.dirname(LOCK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(LOCK_FILE)) {
      const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      if (!isNaN(existingPid) && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          console.warn(`[WARN] Another Telegram bot instance is already running (PID: ${existingPid}). Exiting this process to avoid 409 Conflict.`);
          return false;
        } catch (_) {
          // Process not alive, stale lock file
        }
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    return true;
  } catch (_) {
    return true;
  }
}

function releaseProcessLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      if (existingPid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch (_) {}
}

function parseArgs(): { token?: string; ownerId?: number; isPublic?: boolean } {
  const args = process.argv.slice(2);
  let token: string | undefined;
  let ownerId: number | undefined;
  let isPublic: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) {
      token = args[i + 1];
      i++;
    } else if (args[i] === '--owner' && args[i + 1]) {
      ownerId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--public') {
      isPublic = true;
    } else if (args[i] === '--private') {
      isPublic = false;
    }
  }
  return { token, ownerId, isPublic };
}

async function main(): Promise<void> {
  BotLogger.hookConsole();
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch (_) {}
  }
  const args = parseArgs();
  const config = ConfigManager.load();

  const botToken = args.token ||
    process.env.TELEGRAM_BOT_TOKEN ||
    config.telegramBotToken;

  if (!botToken) {
    console.error('====================================================');
    console.error('  [ERROR] Telegram Bot Token not found.');
    console.error('====================================================');
    console.error('Please provide a bot token via:');
    console.error('  1. Environment variable: export TELEGRAM_BOT_TOKEN="123456:ABC-DEF"');
    console.error('  2. CLI option: npx tsx src/telegram-bot/index.ts --token "123456:ABC-DEF"');
    console.error('  3. Config file in ~/.openclaw-control-panel.json');
    console.error('Get a token from @BotFather on Telegram.\n');
    process.exit(1);
  }

  if (!acquireProcessLock()) {
    process.exit(0);
  }

  const rawOwner = args.ownerId || (process.env.TELEGRAM_OWNER_ID ? parseInt(process.env.TELEGRAM_OWNER_ID, 10) : undefined);
  const isPublic = args.isPublic !== undefined
    ? args.isPublic
    : process.env.TELEGRAM_PUBLIC_BOT !== undefined
      ? process.env.TELEGRAM_PUBLIC_BOT === 'true'
      : true;

  const botConfig: BotConfig = {
    botToken,
    ownerTelegramId: rawOwner && !isNaN(rawOwner) ? rawOwner : undefined,
    allowedUserIds: [],
    isPublic
  };

  const bot = createTelegramBot(botConfig);

  console.log('====================================================');
  console.log('  OpenClaw Daytona/Freestyle Telegram Bot');
  console.log('====================================================');
  console.log(`• Provider      : ${config.provider.toUpperCase()}`);
  console.log(`• Primary Target: ${config.primarySshTarget || 'Not configured'}`);
  console.log(`• Mode          : ${botConfig.isPublic ? 'Public Bot (Isolated per-user sessions & configs)' : `Restricted (Owner: ${botConfig.ownerTelegramId})`}`);
  console.log(`• Status        : Starting long-polling...\n`);

  process.once('SIGINT', () => {
    console.log('\n[INFO] Stopping Telegram bot...');
    releaseProcessLock();
    bot.stop();
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    console.log('\n[INFO] Stopping Telegram bot...');
    releaseProcessLock();
    bot.stop();
    process.exit(0);
  });

  process.once('exit', () => {
    releaseProcessLock();
  });

  let retryCount = 0;
  while (true) {
    try {
      await bot.start({
        onStart: (botInfo) => {
          retryCount = 0;
          console.log(`[INFO] Telegram bot connected as @${botInfo.username}! Listening for updates...`);
        }
      });
      break;
    } catch (err: any) {
      const is409 = err?.error_code === 409 ||
        err?.description?.includes('409') ||
        err?.message?.includes('409') ||
        err?.description?.includes('Conflict');

      if (is409) {
        retryCount++;
        const backoffMs = Math.min(30000, 5000 * retryCount);
        console.warn(`[WARN] 409 Conflict: Another bot instance is polling Telegram. Backing off for ${backoffMs / 1000}s... (attempt ${retryCount})`);
        if (retryCount >= 6) {
          console.error('[ERROR] Consecutive 409 Conflict limit reached. Exiting to allow the other active instance to poll.');
          releaseProcessLock();
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        console.error('[WARN] Polling connection interrupted, reconnecting in 5s...', err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

process.on('unhandledRejection', (reason) => {
  console.warn('[WARN] Unhandled promise rejection in bot runtime:', reason);
});

main().catch((err) => {
  console.error('[FATAL] Telegram bot error:', err);
  process.exit(1);
});
