import assert from 'assert';
import { ProviderValidator, COMMON_PROVIDERS } from '../src/control-panel/core/providerValidator.js';

async function testProviderValidator() {
  console.log('--- Running test: ProviderValidator ---');

  // 1. Verify Catalog
  assert(COMMON_PROVIDERS.length >= 8, 'Common providers should have at least 8 entries');
  const anthropic = COMMON_PROVIDERS.find((p) => p.id === 'anthropic');
  const openai = COMMON_PROVIDERS.find((p) => p.id === 'openai');
  const gemini = COMMON_PROVIDERS.find((p) => p.id === 'gemini');
  const openrouter = COMMON_PROVIDERS.find((p) => p.id === 'openrouter');

  assert(anthropic, 'Anthropic should be cataloged');
  assert(openai, 'OpenAI should be cataloged');
  assert(gemini, 'Gemini should be cataloged');
  assert(openrouter, 'OpenRouter should be cataloged');

  // 2. Test Invalid Key Rejection
  console.log('Testing invalid key rejection on OpenAI endpoint...');
  const res = await ProviderValidator.validateKey('openai', 'sk-invalid-test-key-12345');
  assert.strictEqual(res.valid, false, 'Invalid key should not pass validation');
  console.log(`[PASS] Correctly rejected invalid key: ${res.error}`);

  console.log('[PASS] ProviderValidator tests completed successfully!\n');
}

testProviderValidator().catch((e) => {
  console.error('[FAIL] test_provider_validator:', e);
  process.exit(1);
});
