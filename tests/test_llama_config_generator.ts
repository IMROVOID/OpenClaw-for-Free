import assert from 'assert';
import { LlamaConfigGenerator } from '../src/control-panel/core/llamaConfigGenerator.js';
import { LlamaSettings, VpsSpecs } from '../src/control-panel/core/types.js';

function testLlamaConfigGenerator() {
  console.log('--- Running test: LlamaConfigGenerator ---');

  const specs: VpsSpecs = { cpuCores: 4, ramGb: 8, storageGb: 10 };
  const settings: LlamaSettings = {
    enabled: true,
    isSeparateVps: true,
    modelUrl: 'https://huggingface.co/model.gguf',
    modelName: 'Qwen3.5-9B',
    quantization: 'IQ3_M',
    contextSize: 32768,
    batchSize: 512,
    threads: 4,
    enableMtp: true,
    enableFlashAttn: true,
    isMoe: false,
    kvCacheQuant: 'q4_0'
  };

  // 1. Verify script generation
  const script = LlamaConfigGenerator.generateServerScript(settings, specs, '/home/daytona/models/model.gguf');
  assert(script.includes('-c 32768'), 'Should include context size 32768');
  assert(script.includes('-t 4'), 'Should include 4 threads');
  assert(script.includes('--spec-type draft-mtp'), 'Should include draft-mtp for MTP models');
  assert(script.includes('-fa on'), 'Should include flash attention');
  assert(script.includes('--cache-type-k q4_0'), 'Should include q4_0 KV cache quant');

  // 2. Test Adaptive Config Downgrades on Retry
  const retry1 = LlamaConfigGenerator.getAdaptedConfigForRetry(settings, 1);
  assert.strictEqual(retry1.contextSize, 16384, 'First retry should halve context size');

  const retry2 = LlamaConfigGenerator.getAdaptedConfigForRetry(settings, 2);
  assert.strictEqual(retry2.contextSize, 8192, 'Second retry should reduce context to 8192');
  assert.strictEqual(retry2.batchSize, 256, 'Second retry should reduce batch size to 256');

  const retry3 = LlamaConfigGenerator.getAdaptedConfigForRetry(settings, 3);
  assert.strictEqual(retry3.contextSize, 4096, 'Third retry should enter emergency 4k context mode');
  assert.strictEqual(retry3.enableMtp, false, 'Third retry should disable MTP for lowest footprint');

  console.log('[PASS] LlamaConfigGenerator tests completed successfully!\n');
}

try {
  testLlamaConfigGenerator();
} catch (e) {
  console.error('[FAIL] test_llama_config_generator:', e);
  process.exit(1);
}
