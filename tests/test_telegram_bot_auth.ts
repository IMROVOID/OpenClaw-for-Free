import assert from 'assert';
import { createAuthMiddleware } from '../src/telegram-bot/middleware/authMiddleware.js';
import { sanitizeErrorMessage } from '../src/telegram-bot/middleware/errorMiddleware.js';
import { BotContext, BotConfig } from '../src/telegram-bot/types.js';
import { DEFAULT_CONFIG, ConfigManager } from '../src/control-panel/core/configManager.js';

async function testTelegramBotAuth() {
  console.log('--- Running test: Telegram Bot Auth & Security ---');

  const ownerId = 123456789;
  const botConfig: BotConfig = {
    botToken: '123456789:TEST_BOT_TOKEN_MOCK_1234567890',
    ownerTelegramId: ownerId,
    allowedUserIds: [987654321]
  };

  const middleware = createAuthMiddleware(botConfig);

  // 1. Test Authorized Owner access
  let nextCalled = false;
  const ownerCtx = {
    from: { id: ownerId },
    config: DEFAULT_CONFIG,
    reply: async () => {},
    callbackQuery: undefined
  } as unknown as BotContext;

  await middleware(ownerCtx, async () => {
    nextCalled = true;
  });
  assert(nextCalled, 'Owner should pass through auth middleware');
  assert(ownerCtx.isOwner === true, 'ctx.isOwner should be true for owner');

  // 2. Test Allowed User access
  nextCalled = false;
  const allowedCtx = {
    from: { id: 987654321 },
    config: DEFAULT_CONFIG,
    reply: async () => {},
    callbackQuery: undefined
  } as unknown as BotContext;

  await middleware(allowedCtx, async () => {
    nextCalled = true;
  });
  assert(nextCalled, 'Allowed user should pass through auth middleware');
  assert(allowedCtx.isOwner === true, 'ctx.isOwner should be true for allowed user');

  // 3. Test Unauthorized User rejection
  nextCalled = false;
  let replyMessage = '';
  const unauthorizedCtx = {
    from: { id: 55555555 },
    config: DEFAULT_CONFIG,
    reply: async (msg: string) => {
      replyMessage = msg;
    },
    callbackQuery: undefined
  } as unknown as BotContext;

  await middleware(unauthorizedCtx, async () => {
    nextCalled = true;
  });
  assert(!nextCalled, 'Unauthorized user MUST NOT pass through auth middleware');
  assert(unauthorizedCtx.isOwner === false, 'ctx.isOwner should be false for unauthorized user');
  assert(replyMessage.includes('Access Denied'), 'Should reply with Access Denied');

  // 4. Test Error Message Sanitizer
  const rawKey = 'Failed to connect: sk-proj-12345678abcdefghij-invalid';
  const sanitizedKey = sanitizeErrorMessage(rawKey);
  assert(!sanitizedKey.includes('sk-proj-12345678abcdefghij-invalid'), 'Should sanitize OpenAI secret key');
  assert(sanitizedKey.includes('sk-***'), 'Should replace key with sk-***');

  const rawTg = 'Telegram update error with 987654321:AAEkd9342klsfj238947230492834-fake';
  const sanitizedTg = sanitizeErrorMessage(rawTg);
  assert(!sanitizedTg.includes('987654321:AAEkd9342klsfj238947230492834-fake'), 'Should sanitize Bot Token');
  assert(sanitizedTg.includes('***BOT_TOKEN***'), 'Should replace with ***BOT_TOKEN***');

  // 5. Test First-User Auto-Binding when owner is undefined
  const originalSave = ConfigManager.save;
  ConfigManager.save = () => {};
  try {
    const unboundConfig: BotConfig = {
      botToken: '123456789:TEST',
      ownerTelegramId: undefined,
      allowedUserIds: []
    };
    const unboundMiddleware = createAuthMiddleware(unboundConfig);
    let unboundNextCalled = false;
    const firstUserCtx = {
      from: { id: 777888999 },
      config: { ...DEFAULT_CONFIG },
      reply: async () => {},
      callbackQuery: undefined
    } as unknown as BotContext;

    await unboundMiddleware(firstUserCtx, async () => {
      unboundNextCalled = true;
    });
    assert(unboundNextCalled, 'First user should be allowed');
    assert.strictEqual(unboundConfig.ownerTelegramId, 777888999, 'Owner ID should be auto-bound to first user');

    // Second user should now be rejected because owner is bound
    let secondUserNext = false;
    let secondUserReply = '';
    const secondUserCtx = {
      from: { id: 111222333 },
      config: { ...DEFAULT_CONFIG },
      reply: async (m: string) => { secondUserReply = m; },
      callbackQuery: undefined
    } as unknown as BotContext;
    await unboundMiddleware(secondUserCtx, async () => {
      secondUserNext = true;
    });
    assert(!secondUserNext, 'Second user must be rejected once owner is bound');
    assert(secondUserReply.includes('Access Denied'), 'Second user should receive Access Denied');
  } finally {
    ConfigManager.save = originalSave;
  }

  // 6. Test SSH Target Command Injection Prevention
  const safeFallback = 'safe@ssh.app.daytona.io';
  const maliciousInput1 = 'victim.com && calc.exe';
  const maliciousInput2 = '-oProxyCommand=calc.exe';
  const maliciousInput3 = 'victim.com; rm -rf /';
  const maliciousInput4 = 'victim.com | nc -e /bin/sh';

  assert.strictEqual(ConfigManager.parseSshTarget(maliciousInput1, safeFallback), safeFallback, 'Should reject shell &&');
  assert.strictEqual(ConfigManager.parseSshTarget(maliciousInput2, safeFallback), safeFallback, 'Should reject leading hyphen -');
  assert.strictEqual(ConfigManager.parseSshTarget(maliciousInput3, safeFallback), safeFallback, 'Should reject semicolon ;');
  assert.strictEqual(ConfigManager.parseSshTarget(maliciousInput4, safeFallback), safeFallback, 'Should reject pipe |');

  console.log('[PASS] Telegram Bot Auth & Security tests passed successfully!');
}

testTelegramBotAuth();
