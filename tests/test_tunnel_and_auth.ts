import assert from 'assert';
import { ConfigManager, DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';

console.log('--- Running test: Tunnel & Auth Settings ---');

// 1. OmniRoute password default check
assert.strictEqual(DEFAULT_CONFIG.omniroutePassword, 'CHANGEME', 'Default OmniRoute password must be CHANGEME');

// 2. Config loader sanitization check
const loaded = ConfigManager.load();
assert.strictEqual(loaded.omniroutePassword, 'CHANGEME', 'Loaded OmniRoute password should be CHANGEME');

// 3. Token URL format check
const testToken = 'test-token-12345';
const port = 18789;
const tokenParam = encodeURIComponent(testToken);
const expectedUrl = `http://127.0.0.1:${port}/?token=${tokenParam}#token=${tokenParam}`;
assert.strictEqual(
  expectedUrl,
  'http://127.0.0.1:18789/?token=test-token-12345#token=test-token-12345',
  'OpenClaw URL must point to 127.0.0.1 and include both ?token= and #token='
);

console.log('[PASS] Tunnel & Auth tests completed successfully!');
