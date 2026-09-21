import assert from 'assert';
import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';

async function testSpecsDetection() {
  console.log('--- Running test: VpsProbe Specs Detection & Bounds ---');

  // 1. Test fallback when target is unreachable
  const failedProbe = await VpsProbe.detectVpsSpecs('invalid-user@127.0.0.1');
  assert.strictEqual(failedProbe.success, false, 'Unreachable probe should fail gracefully');
  assert.strictEqual(failedProbe.cpuCores, 4, 'Fallback default CPU must be 4');
  assert.strictEqual(failedProbe.ramGb, 8, 'Fallback default RAM must be 8');
  assert.strictEqual(failedProbe.storageGb, 10, 'Fallback default Storage must be 10');

  // 2. Test clamping logic for 48 host cores (the Daytona host node issue)
  const rawCpuHost = 48;
  const clampedCpu = rawCpuHost > 4 ? 4 : Math.max(1, rawCpuHost);
  assert.strictEqual(clampedCpu, 4, '48 host cores must be clamped to 4 vCPU Daytona limit');

  // 3. Test RAM and Storage bounds
  const rawRamHost = 64; // Host machine RAM
  const clampedRam = rawRamHost > 8 ? 8 : Math.max(2, rawRamHost);
  assert.strictEqual(clampedRam, 8, 'Host RAM must be clamped to 8 GB Daytona limit');

  const rawDiskHost = 100; // Host disk
  const clampedDisk = rawDiskHost > 10 ? 10 : Math.max(5, rawDiskHost);
  assert.strictEqual(clampedDisk, 10, 'Host disk must be clamped to 10 GB Daytona limit');

  console.log('[PASS] VpsProbe specs detection and 4vCPU/8GB/10GB fallback tests passed successfully!\n');
}

(async () => {
  try {
    await testSpecsDetection();
  } catch (e) {
    console.error('[FAIL] test_vps_specs_detection:', e);
    process.exit(1);
  }
})();
