import assert from 'assert';
import { BackStepSignal, isBackInput } from '../src/control-panel/core/backSignal.js';
import { DaytonaDriver } from '../src/control-panel/core/daytonaDriver.js';
import { DiagnosticsView } from '../src/control-panel/tui/diagnosticsView.js';
import { LogsView } from '../src/control-panel/tui/logsView.js';
import { OnboardingSteps } from '../src/control-panel/core/onboardingSteps.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';

console.log('--- Running test: Onboarding New Features ---');

// 1. Test BackStepSignal and isBackInput
const backSig = new BackStepSignal();
assert.strictEqual(backSig.name, 'BackStepSignal', 'BackStepSignal should have name BackStepSignal');
assert.ok(backSig instanceof Error, 'BackStepSignal should be an instance of Error');

assert.strictEqual(isBackInput('0'), true, '0 should be recognized as back input');
assert.strictEqual(isBackInput('esc'), true, 'esc should be recognized as back input');
assert.strictEqual(isBackInput('\u001b'), true, 'ESC key character should be recognized as back input');
assert.strictEqual(isBackInput('b'), true, 'b should be recognized as back input');
assert.strictEqual(isBackInput('back'), true, 'back should be recognized as back input');
assert.strictEqual(isBackInput('exit'), true, 'exit should be recognized as back input');
assert.strictEqual(isBackInput('1'), false, '1 should not be back input');
assert.strictEqual(isBackInput('2'), false, '2 should not be back input');
assert.strictEqual(isBackInput(''), false, 'Empty string should not be back input');

// 2. Test DaytonaDriver listExistingWorkspaces
const daytonaDriver = new DaytonaDriver();
assert.strictEqual(typeof daytonaDriver.listExistingWorkspaces, 'function', 'DaytonaDriver should have listExistingWorkspaces');

// 3. Test DiagnosticsView provider-aware headers and egress
const mockConfig: ControlPanelConfig = {
  provider: 'freestyle',
  primarySshTarget: 'openclaw-primary:tok@beta-ssh.freestyle.sh',
  openclawPort: 18789,
  omniroutePort: 20128,
  llamaPort: 20129,
  openclawToken: 'test-token',
  omniroutePassword: 'test-password',
  vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 32 },
  providers: {},
  llama: {
    enabled: true,
    isSeparateVps: true,
    modelName: 'Qwen 2.5 7B MTP',
    modelUrl: 'https://huggingface.co/test.gguf',
    quantization: 'q4_k_m',
    contextSize: 32768,
    batchSize: 512,
    threads: 4,
    enableMtp: true,
    enableFlashAttn: true,
    isMoe: false,
    kvCacheQuant: 'q4_0'
  }
};

const freeDiag = DiagnosticsView.render(
  mockConfig,
  [],
  { openclaw: true, omniroute: true, llama: true, proxy: false },
  { active: false },
  mockConfig.vpsSpecs,
  88
);
const freeDiagStr = freeDiag.join('\n');
assert.ok(freeDiagStr.includes('FREESTYLE.SH VPS LIVE TELEMETRY & DIAGNOSTICS'), 'Freestyle diagnostics should have FREESTYLE.SH header');
assert.ok(freeDiagStr.includes('Direct Public Internet Egress'), 'Freestyle diagnostics should show Direct Public Internet Egress');
assert.ok(!freeDiagStr.includes('RAILWAY EGRESS TUNNEL'), 'Freestyle diagnostics should NOT show Railway Egress section');

// Daytona config diagnostics
const daytonaConfig: ControlPanelConfig = { ...mockConfig, provider: 'daytona' };
const daytonaDiag = DiagnosticsView.render(
  daytonaConfig,
  [],
  { openclaw: true, omniroute: true, llama: true, proxy: false },
  { active: true, response: 'OK' },
  daytonaConfig.vpsSpecs,
  88
);
const daytonaDiagStr = daytonaDiag.join('\n');
assert.ok(daytonaDiagStr.includes('DAYTONA VPS LIVE TELEMETRY & DIAGNOSTICS'), 'Daytona diagnostics should have DAYTONA header');
assert.ok(daytonaDiagStr.includes('RAILWAY EGRESS TUNNEL'), 'Daytona diagnostics should show Railway Egress section');

// 4. Test LogsView provider-aware header and tabs
const freeLogs = LogsView.render('openclaw', mockConfig.primarySshTarget, ['line 1', 'line 2'], 88, 'freestyle');
const freeLogsStr = freeLogs.lines.join('\n');
assert.ok(freeLogsStr.includes('FREESTYLE.SH VPS LIVE SERVICE LOGS'), 'Freestyle logs should have FREESTYLE.SH header');
assert.ok(!freeLogsStr.includes('Railway Relay'), 'Freestyle logs should omit Railway Relay tab');
assert.ok(freeLogsStr.includes('[1-3 / ← →] Switch Tab'), 'Freestyle logs footer should prompt [1-3 / ← →] Switch Tab');

const daytonaLogs = LogsView.render('openclaw', daytonaConfig.primarySshTarget, ['line 1', 'line 2'], 88, 'daytona');
const daytonaLogsStr = daytonaLogs.lines.join('\n');
assert.ok(daytonaLogsStr.includes('DAYTONA VPS LIVE SERVICE LOGS'), 'Daytona logs should have DAYTONA header');
assert.ok(daytonaLogsStr.includes('Railway Relay'), 'Daytona logs should include Railway Relay tab');
assert.ok(daytonaLogsStr.includes('[1-4 / ← →] Switch Tab'), 'Daytona logs footer should prompt [1-4 / ← →] Switch Tab');

// 5. Test OnboardingSteps.promptLlamaTopology
async function testTopology() {
  const top1 = await OnboardingSteps.promptLlamaTopology(async () => '1');
  assert.strictEqual(top1, 'second_vm', 'Choice 1 should be second_vm');

  const top2 = await OnboardingSteps.promptLlamaTopology(async () => '2');
  assert.strictEqual(top2, 'same_vm', 'Choice 2 should be same_vm');

  const top3 = await OnboardingSteps.promptLlamaTopology(async () => '3');
  assert.strictEqual(top3, 'disabled', 'Choice 3 should be disabled');

  // Test 0 / ESC navigation raises BackStepSignal
  let backCaught = false;
  try {
    await OnboardingSteps.promptLlamaTopology(async () => '0');
  } catch (err) {
    if (err instanceof BackStepSignal) backCaught = true;
  }
  assert.strictEqual(backCaught, true, 'Choice 0 must throw BackStepSignal');

  let escCaught = false;
  try {
    await OnboardingSteps.promptModelSelection(async () => 'esc', 'freestyle');
  } catch (err) {
    if (err instanceof BackStepSignal) escCaught = true;
  }
  assert.strictEqual(escCaught, true, 'Choice esc must throw BackStepSignal');
}

testTopology().then(() => {
  console.log('[PASS] Onboarding new features tests completed successfully!\n');
});
