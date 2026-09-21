import assert from 'assert';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';
import { VpsDetector } from '../src/control-panel/core/vpsDetector.js';
import { OnboardingIngressStep } from '../src/control-panel/core/onboardingIngressStep.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';

console.log('--- Running test: Onboarding Fixes & Domained URL Default ---');

// Test 1: OmniRoute multi-signal detection (NVM / supervisor / process / port)
{
  const stdoutNoBin = [
    'OC_BIN:/usr/local/bin/openclaw',
    'OC_CONF:/home/daytona/.openclaw/openclaw.json',
    'OR_BIN:/usr/local/share/nvm/current/bin/omniroute',
    'OR_DIR:/home/daytona/.omniroute',
    'OR_ACTIVE:YES',
    'LLAMA_RUN:NO',
    'LLAMA_INST:NO',
    'LL_TOP:second_vm',
    'LL_URL:https://llama-relay.up.railway.app/v1'
  ].join('\n');

  const detected = VpsConfigDetector.parseProbeOutput(stdoutNoBin);
  assert.strictEqual(detected.openclawInstalled, true, 'OpenClaw should be detected');
  assert.strictEqual(detected.omnirouteInstalled, true, 'OmniRoute should be detected via NVM path and active check');
  assert.strictEqual(detected.omnirouteActive, true, 'OmniRoute active should be true');
  console.log('[PASS] Test 1: OmniRoute multi-signal detection verified');
}

// Test 2: Primary VM does NOT report local llama-server running when topology is second_vm
{
  const stdoutPrimary = [
    'OC_BIN:/usr/local/bin/openclaw',
    'OC_CONF:/home/daytona/.openclaw/openclaw.json',
    'OR_BIN:/usr/local/bin/omniroute',
    'OR_ACTIVE:YES',
    'LLAMA_RUN:NO',
    'LLAMA_INST:NO',
    'LL_TOP:second_vm',
    'LL_URL:https://llama-relay-production.up.railway.app/v1',
    'LL_MOD:qwen3.5-9b-defiant-fable'
  ].join('\n');

  const detected = VpsConfigDetector.parseProbeOutput(stdoutPrimary);
  assert.strictEqual(detected.llamaRunning, false, 'llamaRunning should be false on primary VM');
  assert.strictEqual(detected.llamaInstalled, false, 'llamaInstalled should be false on primary VM with second_vm topology');
  assert.strictEqual(detected.llamaTopology, 'second_vm');
  assert.strictEqual(detected.llamaEndpoint, 'https://llama-relay-production.up.railway.app/v1');
  console.log('[PASS] Test 2: Primary VM correctly reports false for local llama-server running');
}

// Test 3: VpsDetector.detectExistingLlamaSetup outputs clean separation without duplicate fake running on Primary
async function testVpsDetectorSeparation() {
  const origInspect = VpsConfigDetector.inspect;
  const origDetectSecondary = VpsConfigDetector.detectSecondaryLlama;

  try {
    // Mock Primary VM inspection: client connection to remote endpoint
    VpsConfigDetector.inspect = async () => ({
      reachable: true,
      openclawInstalled: true,
      omnirouteInstalled: true,
      omnirouteActive: true,
      railwayRelayConfigured: true,
      llamaInstalled: false,
      llamaRunning: false,
      llamaTopology: 'second_vm',
      llamaEndpoint: 'https://llama-relay-production.up.railway.app/v1',
      llamaModel: 'qwen3.5-9b-defiant-fable'
    });

    // Mock Secondary VM inspection: actual local llama-server running
    VpsConfigDetector.detectSecondaryLlama = async () => ({
      reachable: true,
      openclawInstalled: false,
      omnirouteInstalled: false,
      omnirouteActive: false,
      railwayRelayConfigured: false,
      llamaInstalled: true,
      llamaRunning: true,
      llamaTopology: undefined,
      llamaModel: 'Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-IQ3_M',
      llamaModelFile: 'model.gguf'
    });

    const mockConfig: ControlPanelConfig = {
      provider: 'daytona',
      primarySshTarget: 'user@primary.daytona.io',
      secondarySshTarget: 'user@secondary.daytona.io',
      openclawPort: 18789,
      omniroutePort: 20128,
      llamaPort: 8080,
      openclawToken: 'tok',
      omniroutePassword: 'pass',
      vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 10 },
      providers: {},
      llama: {
        enabled: true,
        isSeparateVps: true,
        sshTarget: 'user@secondary.daytona.io',
        modelUrl: '',
        modelName: 'qwen3.5-9b-defiant-fable',
        quantization: 'q4_0',
        contextSize: 8192,
        batchSize: 512,
        threads: 4,
        enableMtp: false,
        enableFlashAttn: true,
        isMoe: false,
        kvCacheQuant: 'q4_0',
        activeEndpointUrl: 'https://llama-relay-production.up.railway.app/v1'
      }
    };

    const result = await VpsDetector.detectExistingLlamaSetup(mockConfig, mockConfig.primarySshTarget);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.isSeparate, true);

    // Verify Primary VM is NOT claimed to be running llama-server
    assert.ok(!result.summary.includes('• Primary VM: llama-server [RUNNING]'), 'Primary VM must not be reported as llama-server [RUNNING]');
    assert.ok(result.summary.includes('• Primary VM: Connected to Remote LLM'), 'Primary VM should report client connection');

    // Verify Secondary VM is correctly reported as running
    assert.ok(result.summary.includes('• Secondary VM: llama-server [RUNNING]'), 'Secondary VM must be reported as running');
    console.log('[PASS] Test 3: VpsDetector accurately attributes running status to Secondary VM only');
  } finally {
    VpsConfigDetector.inspect = origInspect;
    VpsConfigDetector.detectSecondaryLlama = origDetectSecondary;
  }
}

// Test 4: OnboardingIngressStep defaults to Domained URLs (Option 1)
async function testIngressDefaultOption() {
  const dummyConfig = {
    provider: 'freestyle',
    freestylePrimarySlug: 'my-app'
  } as ControlPanelConfig;

  // Default option (pressing Enter / '1')
  const defaultAnswers = ['1', '1', ''];
  let idx = 0;
  const mockAsk = async () => defaultAnswers[idx++];

  const res = await OnboardingIngressStep.promptIngress(mockAsk, dummyConfig);
  assert.strictEqual(res.domainedUrlsEnabled, true, 'Default option must be domained URLs');
  assert.strictEqual(res.ingressProvider, 'freestyle');
  assert.strictEqual(res.publicBaseDomain, 'https://my-app.style.dev');
  console.log('[PASS] Test 4: OnboardingIngressStep defaults to Domained URLs (Option 1)');
}

// Test 5: InlineKeyboards.buildOnboardingIngressChoice puts Domained URLs first
{
  const kb = InlineKeyboards.buildOnboardingIngressChoice();
  const buttons = kb.inline_keyboard.flat();
  const firstButton = buttons[0] as any;
  assert.strictEqual(firstButton.callback_data, 'onboard:ingress:domained', 'First button must be domained URL');
  assert.ok(firstButton.text.includes('Default'), 'First button text must indicate Default');
  console.log('[PASS] Test 5: Telegram keyboard puts Domained URLs first as default');
}

async function runAll() {
  await testVpsDetectorSeparation();
  await testIngressDefaultOption();
  console.log('--- All onboarding fix tests passed successfully! ---');
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
