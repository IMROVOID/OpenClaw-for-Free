import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { ConfigManager, DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { createAuthMiddleware } from '../src/telegram-bot/middleware/authMiddleware.js';
import { MenuHandler } from '../src/telegram-bot/handlers/menuHandler.js';
import { BotContext, BotConfig } from '../src/telegram-bot/types.js';

async function runMultiUserTests() {
  console.log('--- Running test: Telegram Bot Multi-User Session & Config Isolation ---');

  const userA = 100001;
  const userB = 200002;

  try {
    // 1. Clean up any previous test artifacts
    ConfigManager.clearUserConfig(userA);
    ConfigManager.clearUserConfig(userB);
    BotSessionManager.clearUserSession(userA);
    BotSessionManager.clearUserSession(userB);

    // 2. Test initial isolated load
    const cfgA = ConfigManager.loadForUser(userA);
    const cfgB = ConfigManager.loadForUser(userB);

    assert.strictEqual(cfgA._userId, userA);
    assert.strictEqual(cfgB._userId, userB);
    assert.strictEqual(cfgA.primarySshTarget, '');
    assert.strictEqual(cfgB.primarySshTarget, '');

    // 3. User A configures Daytona environment
    cfgA.provider = 'daytona';
    cfgA.daytonaApiKey = 'daytona_key_user_A';
    cfgA.primarySshTarget = 'user-a-target@ssh.app.daytona.io';
    ConfigManager.save(cfgA, userA);

    assert(ConfigManager.hasUserConfig(userA), 'User A config file should exist');
    assert(!ConfigManager.hasUserConfig(userB), 'User B config file should NOT exist yet');

    // 4. Verify User B config remains completely pristine and unpolluted
    const loadedB = ConfigManager.loadForUser(userB);
    assert.strictEqual(loadedB.daytonaApiKey, undefined, 'User B must not see User A Daytona API key');
    assert.strictEqual(loadedB.primarySshTarget, '', 'User B must not see User A SSH target');

    // 5. User B configures Freestyle environment
    loadedB.provider = 'freestyle';
    loadedB.freestyleApiKey = 'fst_key_user_B';
    loadedB.primarySshTarget = 'user-b-slug:tok_b@beta-ssh.freestyle.sh';
    ConfigManager.save(loadedB, userB);

    // 6. Verify User A config is unaffected by User B changes
    const reloadA = ConfigManager.loadForUser(userA);
    assert.strictEqual(reloadA.provider, 'daytona');
    assert.strictEqual(reloadA.daytonaApiKey, 'daytona_key_user_A');
    assert.strictEqual(reloadA.freestyleApiKey, undefined);
    assert.strictEqual(reloadA.primarySshTarget, 'user-a-target@ssh.app.daytona.io');

    const reloadB = ConfigManager.loadForUser(userB);
    assert.strictEqual(reloadB.provider, 'freestyle');
    assert.strictEqual(reloadB.freestyleApiKey, 'fst_key_user_B');
    assert.strictEqual(reloadB.daytonaApiKey, undefined);

    // 6b. Verify SQLite database holds encrypted data without plaintext secrets
    const dbPath = path.join(ConfigManager.getTelegramDataDir(), 'telegram_assistant.db');
    assert(fs.existsSync(dbPath), 'SQLite database file must exist');
    const rawSqlite = new DatabaseSync(dbPath);
    const rowA = rawSqlite.prepare('SELECT encrypted_data FROM user_configs WHERE user_id = ?').get(String(userA)) as { encrypted_data: string };
    assert(rowA, 'User A config row must exist in SQLite DB');
    assert(!rowA.encrypted_data.includes('daytona_key_user_A'), 'User A Daytona key must be encrypted in SQLite DB');
    assert(rowA.encrypted_data.includes('$encrypted'), 'User A config must have $encrypted envelope');
    rawSqlite.close();

    console.log('[PASS] Per-user configuration isolation and SQLite encryption verified');

    // 7. Test Session and Memory Isolation
    const sessA = BotSessionManager.startOnboarding(userA);
    sessA.onboardingDraft.provider = 'daytona';
    BotSessionManager.setUserMemory(userA, 'customNote', 'User A persistent note');

    const sessB = BotSessionManager.getSession(userB);
    assert.strictEqual(sessB.flow, 'none', 'User B session must not be affected by User A onboarding');
    assert.strictEqual(BotSessionManager.getUserMemory(userB, 'customNote'), undefined, 'User B must not see User A memory');

    // 8. Test Session Disk Persistence
    // Clear in-memory cache to force disk load
    BotSessionManager.clearAll();

    const restoredA = BotSessionManager.getSession(userA);
    assert.strictEqual(restoredA.flow, 'onboarding', 'User A session flow should be restored from disk');
    assert.strictEqual(restoredA.onboardingDraft.provider, 'daytona', 'User A draft should be restored from disk');
    assert.strictEqual(BotSessionManager.getUserMemory(userA, 'customNote'), 'User A persistent note', 'User A memory should be restored from disk');

    console.log('[PASS] Per-user session and memory persistence verified');

    // 9. Test Public Bot Auth Middleware
    const publicBotConfig: BotConfig = {
      botToken: '123456:TEST_TOKEN',
      allowedUserIds: [],
      isPublic: true
    };
    const authMw = createAuthMiddleware(publicBotConfig);

    let nextA = false;
    const ctxA = {
      from: { id: userA },
      config: reloadA,
      reply: async () => {}
    } as unknown as BotContext;
    await authMw(ctxA, async () => { nextA = true; });
    assert(nextA, 'User A should pass public bot auth');
    assert.strictEqual(ctxA.isOwner, true, 'User A is treated as owner of their isolated instance');

    let nextB = false;
    const ctxB = {
      from: { id: userB },
      config: reloadB,
      reply: async () => {}
    } as unknown as BotContext;
    await authMw(ctxB, async () => { nextB = true; });
    assert(nextB, 'User B should pass public bot auth');
    assert.strictEqual(ctxB.isOwner, true, 'User B is treated as owner of their isolated instance');

    let nextC = false;
    const ctxC = {
      from: { id: 999999 },
      config: DEFAULT_CONFIG,
      reply: async () => {}
    } as unknown as BotContext;
    await authMw(ctxC, async () => { nextC = true; });
    assert(nextC, 'User C should pass public bot auth');

    console.log('[PASS] Public bot authorization allows any user to manage their own isolated instance');

    // 10. Test Logout & Reset Behavior (Verify no automatic re-login)
    const ctxLogout = {
      from: { id: userA },
      config: reloadA,
      botConfig: publicBotConfig,
      reply: async () => {},
      answerCallbackQuery: async () => {}
    } as unknown as BotContext;

    await MenuHandler.handleLogout(ctxLogout);
    assert(!ConfigManager.hasUserConfig(userA), 'User A config should be deleted after logout');
    const freshA = ConfigManager.loadForUser(userA);
    assert.strictEqual(freshA.primarySshTarget, '', 'Fresh user config must have empty primarySshTarget');
    assert.strictEqual(MenuHandler.isConfigured(freshA), false, 'User must NOT be considered configured after logout');

    console.log('[PASS] Reset/Logout correctly unconfigures user and prevents auto-relogin');

    console.log('[PASS] All multi-user isolation tests passed successfully!');
  } finally {
    // Cleanup
    ConfigManager.clearUserConfig(userA);
    ConfigManager.clearUserConfig(userB);
    BotSessionManager.clearUserSession(userA);
    BotSessionManager.clearUserSession(userB);
  }
}

runMultiUserTests().catch((err) => {
  console.error('[FAIL] test_telegram_bot_multi_user:', err);
  process.exit(1);
});
