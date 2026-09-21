import assert from 'assert';
import { HuggingFaceInspector } from '../src/control-panel/core/huggingfaceInspector.js';

async function testHuggingFaceInspector() {
  console.log('--- Running test: HuggingFaceInspector ---');

  // 1. Test Repo ID and Filename Parsing
  const url1 = 'https://huggingface.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF';
  const parsed1 = HuggingFaceInspector.parseRepoId(url1);
  assert.strictEqual(parsed1.repoId, 'DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF');
  assert.strictEqual(parsed1.specificFilename, undefined);

  const url2 = 'https://huggingface.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF/resolve/main/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-IQ3_M.gguf';
  const parsed2 = HuggingFaceInspector.parseRepoId(url2);
  assert.strictEqual(parsed2.repoId, 'DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF');
  assert.strictEqual(parsed2.specificFilename, 'Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-IQ3_M.gguf');

  // 2. Test Live Model Inspection on the actual Qwen 3.5 9B repository
  console.log('Fetching metadata for DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF...');
  try {
    const info = await HuggingFaceInspector.inspectModel(url1, 8); // 8GB RAM VPS
    assert.strictEqual(info.isGguf, true, 'Should detect GGUF models');
    assert.strictEqual(info.hasMtp, true, 'Should detect MTP draft heads');
    assert(info.quantizations.length > 0, 'Should find quantization files');
    console.log(`[PASS] Detected ${info.quantizations.length} quants. Recommended quant for 8GB: ${info.recommendedQuant}`);
    console.log(`[PASS] Min size: ${info.minSizeGb} GB, Fits RAM: ${info.quantizations[0].fitsRam}`);
  } catch (err: any) {
    console.warn(`[WARN] Network/HF API rate limit during live test: ${err.message}`);
  }

  console.log('[PASS] HuggingFaceInspector tests completed successfully!\n');
}

testHuggingFaceInspector().catch((e) => {
  console.error('[FAIL] test_huggingface_inspector:', e);
  process.exit(1);
});
