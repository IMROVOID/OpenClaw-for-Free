import assert from 'assert';
import { SecondaryVmWizardStep } from '../src/control-panel/core/secondaryVmWizardStep.js';
import { BackStepSignal } from '../src/control-panel/core/backSignal.js';
import { VpsSetupWizard } from '../src/control-panel/core/vpsSetupWizard.js';
import readline from 'readline';
import { PassThrough } from 'stream';

console.log('--- Running test: Secondary VM Provider Selection ---');

async function runTests() {
  // 1. Test BackStepSignal on provider choice
  let backTriggered = false;
  try {
    await SecondaryVmWizardStep.setup(async (q) => '0', 'freestyle');
  } catch (err: any) {
    if (err instanceof BackStepSignal) {
      backTriggered = true;
    }
  }
  assert.ok(backTriggered, 'Selecting 0 on Secondary VM provider should throw BackStepSignal');

  // 2. Test selecting Daytona when Primary is Freestyle (cross-provider) via direct SSH
  const answersDaytona = [
    '2', // 1. Provider: Daytona Cloud
    '2', // 2. Setup mode: Direct SSH Key / Target
    'my-llama-box@ssh.app.daytona.io' // 3. SSH target
  ];
  let daytonaIdx = 0;
  const resDaytona = await SecondaryVmWizardStep.setup(async (q) => answersDaytona[daytonaIdx++], 'freestyle');
  assert.strictEqual(resDaytona.provider, 'daytona', 'Secondary VM provider should be Daytona');
  assert.strictEqual(resDaytona.secondarySshTarget, 'my-llama-box@ssh.app.daytona.io');

  // 3. Test selecting Freestyle when Primary is Daytona (cross-provider) via direct SSH
  const answersFreestyle = [
    '1', // 1. Provider: Freestyle.sh
    '2', // 2. Setup mode: Direct SSH Key / Target
    'openclaw-llama:tok123@beta-ssh.freestyle.sh' // 3. SSH target
  ];
  let freeIdx = 0;
  const resFreestyle = await SecondaryVmWizardStep.setup(async (q) => answersFreestyle[freeIdx++], 'daytona');
  assert.strictEqual(resFreestyle.provider, 'freestyle', 'Secondary VM provider should be Freestyle');
  assert.strictEqual(resFreestyle.secondarySshTarget, 'openclaw-llama:tok123@beta-ssh.freestyle.sh');

  // 4. Test VpsSetupWizard integration
  const inStream = new PassThrough();
  const outStream = new PassThrough();
  const rl = readline.createInterface({ input: inStream, output: outStream });
  const wizard = new VpsSetupWizard(rl, async (q) => {
    if (q.includes('provider')) return '1';
    if (q.includes('option')) return '2';
    return 'llama-host:tok@beta-ssh.freestyle.sh';
  });
  const wizRes = await wizard.setupSecondaryVm('freestyle');
  assert.strictEqual(wizRes.provider, 'freestyle');
  assert.strictEqual(wizRes.secondarySshTarget, 'llama-host:tok@beta-ssh.freestyle.sh');
  rl.close();

  console.log('[PASS] Secondary VM provider selection tests completed successfully!\n');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
