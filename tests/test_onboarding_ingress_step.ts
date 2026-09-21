import assert from 'assert';
import { OnboardingIngressStep } from '../src/control-panel/core/onboardingIngressStep.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { BackStepSignal } from '../src/control-panel/core/backSignal.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';

console.log('--- Running test: OnboardingIngressStep ---');

const baseConfig: Partial<ControlPanelConfig> = {
  provider: 'freestyle',
  freestylePrimarySlug: 'test-app',
  primarySshTarget: 'root@ssh.style.dev:2222',
  llama: {
    enabled: false,
    isSeparateVps: false,
    modelUrl: '',
    modelName: '',
    quantization: '',
    contextSize: 0,
    batchSize: 0,
    threads: 0,
    enableMtp: false,
    enableFlashAttn: false,
    isMoe: false,
    kvCacheQuant: 'q4_0'
  }
};

// Test 1: User chooses Port Forwarding (Option 2)
async function testPortForwarding() {
  const answers = ['2']; // Ingress mode: 2 for Port Forwarding
  let idx = 0;
  const mockAsk = async (_q: string, _def?: string) => answers[idx++];

  const res = await OnboardingIngressStep.promptIngress(mockAsk, baseConfig as ControlPanelConfig);
  assert.strictEqual(res.domainedUrlsEnabled, false);
  assert.strictEqual(res.ingressProvider, 'none');
  assert.strictEqual(res.publicBaseDomain, undefined);
  console.log('[PASS] Test 1: Port forwarding selected');
}

// Test 2: FreeStyle with Native Domains (Option 1 -> Option 1)
async function testFreestyleNativeDomain() {
  const answers = ['1', '1', '']; // Domained (1) -> Freestyle Native (1) -> Default domain
  let idx = 0;
  const mockAsk = async (_q: string, _def?: string) => answers[idx++];

  const res = await OnboardingIngressStep.promptIngress(mockAsk, baseConfig as ControlPanelConfig);
  assert.strictEqual(res.domainedUrlsEnabled, true);
  assert.strictEqual(res.ingressProvider, 'freestyle');
  assert.strictEqual(res.publicBaseDomain, 'https://test-app.style.dev');
  console.log('[PASS] Test 2: FreeStyle native domain selected');
}

// Test 3: FreeStyle with Railway Web Relay (Option 1 -> Option 2)
async function testFreestyleRailwayRelay() {
  const answers = ['1', '2', 'fixture-token', 'https://my-relay.up.railway.app']; // Domained (1) -> Railway (2) -> token -> Relay Domain
  let idx = 0;
  const mockAsk = async (_q: string, _def?: string) => answers[idx++];

  const res = await OnboardingIngressStep.promptIngress(mockAsk, baseConfig as ControlPanelConfig);
  assert.strictEqual(res.domainedUrlsEnabled, true);
  assert.strictEqual(res.ingressProvider, 'railway');
  assert.strictEqual(res.publicBaseDomain, 'my-relay.up.railway.app');
  console.log('[PASS] Test 3: FreeStyle with Railway Web Relay selected');
}

// Test 4: Daytona with Railway Web Relay (Option 1 -> Railway Domain)
async function testDaytonaRailway() {
  const daytonaConfig: ControlPanelConfig = {
    ...baseConfig,
    provider: 'daytona',
    freestylePrimarySlug: undefined
  } as ControlPanelConfig;

  const answers = ['1', 'fixture-token', 'https://openclaw-relay.up.railway.app']; // Domained (1) -> token -> Railway domain
  let idx = 0;
  const mockAsk = async (_q: string, _def?: string) => answers[idx++];

  const res = await OnboardingIngressStep.promptIngress(mockAsk, daytonaConfig);
  assert.strictEqual(res.domainedUrlsEnabled, true);
  assert.strictEqual(res.ingressProvider, 'railway');
  assert.strictEqual(res.publicBaseDomain, 'openclaw-relay.up.railway.app');
  console.log('[PASS] Test 4: Daytona forces Railway Web Relay for domained URLs');
}

// Test 5: Back step signal on '0'
async function testBackStep() {
  const answers = ['0'];
  let idx = 0;
  const mockAsk = async (_q: string, _def?: string) => answers[idx++];

  let caught = false;
  try {
    await OnboardingIngressStep.promptIngress(mockAsk, baseConfig as ControlPanelConfig);
  } catch (err) {
    if (err instanceof BackStepSignal) {
      caught = true;
    }
  }
  assert.strictEqual(caught, true, 'Should throw BackStepSignal when input is 0');
  console.log('[PASS] Test 5: BackStepSignal thrown on 0');
}

async function runAll() {
  const origValidate = RailwayClient.validateApiKey;
  const origList = RailwayClient.listExistingRelays;
  RailwayClient.validateApiKey = async () => ({ valid: true, user: 'fixture' });
  RailwayClient.listExistingRelays = async () => [];
  try {
    await testPortForwarding();
    await testFreestyleNativeDomain();
    await testFreestyleRailwayRelay();
    await testDaytonaRailway();
    await testBackStep();
  } finally {
    RailwayClient.validateApiKey = origValidate;
    RailwayClient.listExistingRelays = origList;
  }
  console.log('--- All OnboardingIngressStep tests passed! ---');
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
