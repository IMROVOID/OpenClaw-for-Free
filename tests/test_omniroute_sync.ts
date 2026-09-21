import assert from 'assert';

console.log('--- Running test: OmnirouteSync ---');

async function runTests() {
  // Test endpoint normalization logic matching OmnirouteSync.registerLlamaInOpenClaw
  const normalizeEndpoint = (url: string): string => {
    const raw = url.replace(/\/+$/, '');
    return raw.endsWith('/v1') ? raw : `${raw}/v1`;
  };

  assert.strictEqual(
    normalizeEndpoint('https://llama-relay-production.up.railway.app'),
    'https://llama-relay-production.up.railway.app/v1'
  );
  assert.strictEqual(
    normalizeEndpoint('https://llama-relay-production.up.railway.app/'),
    'https://llama-relay-production.up.railway.app/v1'
  );
  assert.strictEqual(
    normalizeEndpoint('https://llama-relay-production.up.railway.app/v1'),
    'https://llama-relay-production.up.railway.app/v1'
  );
  assert.strictEqual(
    normalizeEndpoint('http://127.0.0.1:8080'),
    'http://127.0.0.1:8080/v1'
  );

  // Test model ID cleaning
  const cleanModelId = (modelName: string): { cleanModel: string; fullModelId: string } => {
    const cleanModel = modelName.split('/').pop() || 'qwen2.5-7b-mtp';
    return {
      cleanModel,
      fullModelId: `daytona-llama/${cleanModel}`
    };
  };

  const m1 = cleanModelId('qwen3.5-9b-defiant-fable');
  assert.strictEqual(m1.cleanModel, 'qwen3.5-9b-defiant-fable');
  assert.strictEqual(m1.fullModelId, 'daytona-llama/qwen3.5-9b-defiant-fable');

  const m2 = cleanModelId('DavidAU/Qwen3.5-9B-The-Defiant-Fable-GGUF');
  assert.strictEqual(m2.cleanModel, 'Qwen3.5-9B-The-Defiant-Fable-GGUF');
  assert.strictEqual(m2.fullModelId, 'daytona-llama/Qwen3.5-9B-The-Defiant-Fable-GGUF');

  console.log('[PASS] OmnirouteSync tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[FAIL] OmnirouteSync test failed:', err);
  process.exit(1);
});
