import assert from 'assert';
import { VpsDetector } from '../src/control-panel/core/vpsDetector.js';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';

async function main() {
  console.log('--- Running test: External/Remote Llama Detection ---');

  const origInspect = VpsConfigDetector.inspect;
  const origSecondary = VpsConfigDetector.detectSecondaryLlama;

  try {
    const clean = { ...DEFAULT_CONFIG, llama: { ...DEFAULT_CONFIG.llama, enabled: false } };

    // Primary VM has no local llama, but openclaw.json points at an external llama VM
    VpsConfigDetector.inspect = async () => ({
      reachable: true,
      openclawInstalled: true,
      omnirouteInstalled: true,
      omnirouteActive: true,
      railwayRelayConfigured: false,
      llamaInstalled: false,
      llamaRunning: false,
      llamaTopology: 'second_vm',
      llamaEndpoint: 'https://openclaw-llama.style.dev/v1',
      llamaModel: 'qwen7b'
    } as any);
    VpsConfigDetector.detectSecondaryLlama = async () => ({ llamaInstalled: false, llamaRunning: false } as any);

    const external = await VpsDetector.detectExistingLlamaSetup(clean, 'user@primary-ssh');
    assert.strictEqual(external.found, true, 'External llama connection in openclaw.json must be detected');
    assert.strictEqual(external.isSeparate, true, 'Remote llama endpoint must flag a separate VM');
    assert(external.summary.includes('openclaw-llama.style.dev'), 'Summary must include the external endpoint');

    // Primary has no llama at all, but Secondary VM runs llama
    VpsConfigDetector.inspect = async () => ({ reachable: true, llamaInstalled: false, llamaRunning: false } as any);
    const clean2 = {
      ...DEFAULT_CONFIG,
      llama: { ...DEFAULT_CONFIG.llama, enabled: false },
      secondarySshTarget: 'user@secondary-ssh'
    };
    VpsConfigDetector.detectSecondaryLlama = async () => ({
      reachable: true,
      llamaInstalled: true,
      llamaRunning: true,
      llamaModel: 'qwen7b'
    } as any);

    const secondary = await VpsDetector.detectExistingLlamaSetup(clean2, 'user@primary-ssh');
    assert.strictEqual(secondary.found, true, 'Secondary VM llama must be detected');
    assert.strictEqual(secondary.isSeparate, true, 'Secondary VM llama must flag separate');

    console.log('OK');
  } finally {
    VpsConfigDetector.inspect = origInspect;
    VpsConfigDetector.detectSecondaryLlama = origSecondary;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});