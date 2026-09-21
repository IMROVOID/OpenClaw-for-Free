import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { UserCryptoStorage } from '../src/control-panel/core/userCryptoStorage.js';
import { UserDatabase } from '../src/control-panel/core/userDatabase.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { BotSessionData } from '../src/telegram-bot/types.js';

async function runTests() {
  console.log('--- Running test: User SQLite Encrypted Database ---');

  const testDbDir = path.join(process.cwd(), 'data', 'test_telegram_db');
  const testDbPath = path.join(testDbDir, 'test_assistant.db');
  process.env.TELEGRAM_DATA_DIR = testDbDir;
  process.env.TELEGRAM_DB_PATH = testDbPath;

  // Clean up any test directory
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }

  try {
    // 1. Test Crypto Storage directly
    console.log('▶ 1. Testing UserCryptoStorage unit functions...');
    const user1 = 12345678;
    const user2 = 87654321;

    const rawSecret = JSON.stringify({ token: 'sec_xyz_123', password: 'mySecretPassword' });
    const encrypted1 = UserCryptoStorage.encryptData(user1, rawSecret);
    const parsedEnv = JSON.parse(encrypted1);

    assert.strictEqual(parsedEnv.$encrypted, true, 'Envelope must flag $encrypted = true');
    assert.strictEqual(parsedEnv.alg, 'aes-256-gcm', 'Algorithm must be aes-256-gcm');
    assert(parsedEnv.iv && parsedEnv.tag && parsedEnv.data, 'Envelope must contain iv, tag, and data');
    assert(!encrypted1.includes('sec_xyz_123'), 'Ciphertext envelope must NOT contain plaintext token');
    assert(!encrypted1.includes('mySecretPassword'), 'Ciphertext envelope must NOT contain plaintext password');

    const decrypted1 = UserCryptoStorage.decryptData(user1, encrypted1);
    assert.strictEqual(decrypted1, rawSecret, 'Decrypted text must match original secret');

    // Test isolation: user 2 cannot decrypt user 1's ciphertext
    let failedDecryption = false;
    try {
      UserCryptoStorage.decryptData(user2, encrypted1);
    } catch (_) {
      failedDecryption = true;
    }
    assert(failedDecryption, 'User 2 must NOT be able to decrypt User 1 ciphertext');

    // Test tampering detection
    parsedEnv.data = 'A' + parsedEnv.data.slice(1);
    const tamperedEnv = JSON.stringify(parsedEnv);
    let tamperDetected = false;
    try {
      UserCryptoStorage.decryptData(user1, tamperedEnv);
    } catch (_) {
      tamperDetected = true;
    }
    assert(tamperDetected, 'Tampered ciphertext must fail auth tag verification');

    // Test user ID sanitization
    assert.strictEqual(UserCryptoStorage.sanitizeUserId(12345), '12345');
    assert.strictEqual(UserCryptoStorage.sanitizeUserId('tg_user_99'), 'tg_user_99');
    assert.throws(() => UserCryptoStorage.sanitizeUserId('../evil'), /Invalid userId/);
    assert.throws(() => UserCryptoStorage.sanitizeUserId(''), /Invalid userId/);

    console.log('✔ UserCryptoStorage unit tests passed');

    // 2. Test UserDatabase auto-setup and CRUD
    console.log('▶ 2. Testing UserDatabase auto-setup and CRUD...');
    const userDb = UserDatabase.getInstance(testDbPath);

    assert(fs.existsSync(testDbPath), 'SQLite DB file should be created automatically');

    // Verify tables exist in SQLite
    const rawSqlite = new DatabaseSync(testDbPath);
    const tables = rawSqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);
    assert(tableNames.includes('user_configs'), 'user_configs table must exist');
    assert(tableNames.includes('user_sessions'), 'user_sessions table must exist');

    // 3. Test Config CRUD with encryption
    const cfgA: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'daytona',
      primarySshTarget: 'user-a@ssh.app.daytona.io',
      openclawToken: 'super-secret-openclaw-token-12345',
      omniroutePassword: 'omniroute-password-secret-999',
      providers: {
        daytona: {
          id: 'daytona',
          name: 'Daytona',
          baseUrl: 'https://app.daytona.io/api',
          apiKey: 'dt_secret_key_user_a',
          enabled: true,
          validated: true
        }
      },
      _userId: user1
    };

    userDb.saveUserConfig(user1, cfgA);
    assert(userDb.hasUserConfig(user1), 'hasUserConfig must be true after saving');
    assert(!userDb.hasUserConfig(user2), 'hasUserConfig must be false for user2');

    // Verify SQLite raw row is encrypted
    const rowA = rawSqlite.prepare('SELECT encrypted_data FROM user_configs WHERE user_id = ?').get(String(user1)) as { encrypted_data: string };
    assert(rowA, 'Raw row must exist in user_configs');
    assert(!rowA.encrypted_data.includes('super-secret-openclaw-token-12345'), 'Raw DB row must NOT contain plaintext token');
    assert(!rowA.encrypted_data.includes('omniroute-password-secret-999'), 'Raw DB row must NOT contain plaintext password');
    assert(!rowA.encrypted_data.includes('dt_secret_key_user_a'), 'Raw DB row must NOT contain plaintext API key');
    assert(rowA.encrypted_data.includes('$encrypted'), 'Raw DB row must have $encrypted flag');

    // Verify decryption on load
    const loadedA = userDb.getUserConfig(user1);
    assert(loadedA, 'getUserConfig must return loaded config');
    assert.strictEqual(loadedA.primarySshTarget, 'user-a@ssh.app.daytona.io');
    assert.strictEqual(loadedA.openclawToken, 'super-secret-openclaw-token-12345');
    assert.strictEqual(loadedA.omniroutePassword, 'omniroute-password-secret-999');
    assert.strictEqual(loadedA.providers?.daytona?.apiKey, 'dt_secret_key_user_a');

    // 4. Test Session CRUD with encryption
    const sessA: BotSessionData = {
      flow: 'onboarding',
      step: 3,
      onboardingDraft: {
        provider: 'freestyle',
        primaryApiKey: 'freestyle-secret-api-key-888',
        upstreamKeys: {
          openai: 'sk-proj-super-secret-key-111',
          anthropic: 'sk-ant-super-secret-key-222'
        }
      },
      recoveryDraft: {
        missingType: 'primary',
        action: 'new_primary'
      },
      userMemory: {
        lastScreen: 'step3'
      }
    };

    userDb.saveUserSession(user1, sessA);
    const rowSessA = rawSqlite.prepare('SELECT encrypted_data FROM user_sessions WHERE user_id = ?').get(String(user1)) as { encrypted_data: string };
    assert(rowSessA, 'Raw row must exist in user_sessions');
    assert(!rowSessA.encrypted_data.includes('freestyle-secret-api-key-888'), 'Raw session row must NOT contain plaintext API key');
    assert(!rowSessA.encrypted_data.includes('sk-proj-super-secret-key-111'), 'Raw session row must NOT contain plaintext OpenAI key');

    const loadedSessA = userDb.getUserSession(user1);
    assert(loadedSessA, 'getUserSession must return loaded session');
    assert.strictEqual(loadedSessA.flow, 'onboarding');
    assert.strictEqual(loadedSessA.step, 3);
    assert.strictEqual(loadedSessA.onboardingDraft?.primaryApiKey, 'freestyle-secret-api-key-888');
    assert.strictEqual(loadedSessA.onboardingDraft?.upstreamKeys?.openai, 'sk-proj-super-secret-key-111');
    assert.strictEqual(loadedSessA.userMemory?.lastScreen, 'step3');

    // 5. Test Deletion
    userDb.deleteUserConfig(user1);
    assert(!userDb.hasUserConfig(user1), 'hasUserConfig must be false after deletion');
    assert.strictEqual(userDb.getUserConfig(user1), null, 'getUserConfig must return null after deletion');

    userDb.deleteUserSession(user1);
    assert.strictEqual(userDb.getUserSession(user1), null, 'getUserSession must return null after deletion');

    // 6. Test Legacy File Auto-Migration
    console.log('▶ 3. Testing legacy file migration...');
    const legacyUserDir = path.join(testDbDir, 'users');
    const legacySessionDir = path.join(testDbDir, 'sessions');
    fs.mkdirSync(legacyUserDir, { recursive: true });
    fs.mkdirSync(legacySessionDir, { recursive: true });

    const legacyUserId = 999111;
    const legacyCfg = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle',
      primarySshTarget: 'migrated-user@beta-ssh.freestyle.sh',
      openclawToken: 'migrated-token-777'
    };
    fs.writeFileSync(path.join(legacyUserDir, `${legacyUserId}.json`), JSON.stringify(legacyCfg, null, 2), 'utf-8');

    const legacySess = {
      flow: 'recovery',
      step: 1,
      onboardingDraft: { provider: 'daytona' },
      recoveryDraft: { missingType: 'primary', action: 'new_primary' },
      userMemory: { migrated: true }
    };
    fs.writeFileSync(path.join(legacySessionDir, `${legacyUserId}.json`), JSON.stringify(legacySess, null, 2), 'utf-8');

    // Run migration
    userDb.migrateFromFiles(testDbDir);

    // Verify migrated data is now in SQLite and encrypted
    assert(userDb.hasUserConfig(legacyUserId), 'Migrated user config must be accessible in SQLite');
    const migratedCfg = userDb.getUserConfig(legacyUserId);
    assert.strictEqual(migratedCfg?.primarySshTarget, 'migrated-user@beta-ssh.freestyle.sh');
    assert.strictEqual(migratedCfg?.openclawToken, 'migrated-token-777');

    const migratedSess = userDb.getUserSession(legacyUserId);
    assert.strictEqual(migratedSess?.flow, 'recovery');
    assert.strictEqual(migratedSess?.userMemory?.migrated, true);

    rawSqlite.close();
    userDb.close();

    console.log('✔ All User SQLite Encrypted Database tests passed successfully!');
  } finally {
    // Cleanup test directory
    try {
      if (fs.existsSync(testDbDir)) {
        fs.rmSync(testDbDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('[FAIL] test_user_sqlite_encrypted_db:', err);
  process.exit(1);
});
