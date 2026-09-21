import assert from 'node:assert';
import { VpsVerifier, VerificationReport } from '../src/control-panel/core/vpsVerifier.js';

export async function testVpsVerifier(): Promise<void> {
  console.log('--- Running test: VpsVerifier (Health & Diagnostics) ---');

  // Test 1: getVerifyScript returns non-empty bash script
  const script = VpsVerifier.getVerifyScript();
  assert.ok(script.length > 50, 'Verify script should not be empty');
  assert.ok(script.includes('verify_setup.sh') || script.includes('supervisorctl status'), 'Script should contain verify steps');
  console.log('[PASS] Test 1: getVerifyScript loads script content');

  // Test 2: parseReport parses successful 6/6 run
  const mockSuccessOutput = `
==========================================================
 Running OpenClaw, Channels & Relay Diagnostics
==========================================================

[1/6] Checking Supervisor Daemon Services...
✔ Supervisor services are active.

[2/6] Validating OpenClaw Configuration...
✔ OpenClaw configuration is valid.

[3/6] Checking Channels Status (Telegram & Discord)...
✔ Channels status reported.

[4/6] Checking Active Models Catalog...
Total OmniRoute models loaded in OpenClaw: 5
✔ Models catalog is populated.

[5/6] Checking OmniRoute Gateway Endpoint (if applicable)...
✔ OmniRoute is responding with 5 active models.

[6/6] Checking Egress Relay & Discord Gateway Tunnel...
✔ Egress Relay active (Discord Gateway reachable through tunnel).

==========================================================
 All verification tests passed successfully! 
==========================================================
`;

  const reportSuccess = VpsVerifier.parseReport(mockSuccessOutput, 0);
  assert.strictEqual(reportSuccess.success, true);
  assert.strictEqual(reportSuccess.totalFailed, 0);
  assert.strictEqual(reportSuccess.steps.length, 6);
  assert.strictEqual(reportSuccess.steps[0].passed, true);
  assert.strictEqual(reportSuccess.steps[1].passed, true);
  assert.strictEqual(reportSuccess.steps[2].passed, true);
  assert.strictEqual(reportSuccess.steps[3].passed, true);
  assert.strictEqual(reportSuccess.steps[4].passed, true);
  assert.strictEqual(reportSuccess.steps[5].passed, true);
  console.log('[PASS] Test 2: parseReport accurately parses successful verification');

  // Test 3: parseReport parses failures
  const mockFailureOutput = `
[1/6] Checking Supervisor Daemon Services...
✘ Supervisor check failed!

[2/6] Validating OpenClaw Configuration...
✘ OpenClaw configuration validation failed!

[3/6] Checking Channels Status (Telegram & Discord)...
✔ Channels status reported.

[4/6] Checking Active Models Catalog...
✘ No models loaded in OpenClaw!

[5/6] Checking OmniRoute Gateway Endpoint (if applicable)...
ℹ OmniRoute not responding or not enabled (port 20128).

[6/6] Checking Egress Relay & Discord Gateway Tunnel...
✘ Egress Relay running but tunnel request failed!

==========================================================
 Diagnostics finished with 4 failures. Check logs above. 
==========================================================
`;

  const reportFailure = VpsVerifier.parseReport(mockFailureOutput, 1);
  assert.strictEqual(reportFailure.success, false);
  assert.strictEqual(reportFailure.totalFailed, 4);
  assert.strictEqual(reportFailure.steps[0].passed, false);
  assert.strictEqual(reportFailure.steps[1].passed, false);
  assert.strictEqual(reportFailure.steps[2].passed, true);
  assert.strictEqual(reportFailure.steps[3].passed, false);
  assert.strictEqual(reportFailure.steps[4].passed, true); // Info/skipped counts as non-fatal
  assert.strictEqual(reportFailure.steps[5].passed, false);
  console.log('[PASS] Test 3: parseReport accurately detects failures');

  // Test 4: formatTelegramReport produces formatted markdown
  const formattedSuccess = VpsVerifier.formatTelegramReport(reportSuccess, 'user@daytona.app');
  assert.ok(formattedSuccess.includes('*OPENCLAW & VPS VERIFICATION REPORT*'));
  assert.ok(formattedSuccess.includes('user@daytona.app'));
  assert.ok(formattedSuccess.includes('ALL CHECKS PASSED'));
  assert.ok(formattedSuccess.includes('✔'));

  const formattedFail = VpsVerifier.formatTelegramReport(reportFailure, 'user@daytona.app');
  assert.ok(formattedFail.includes('FAILURES DETECTED'));
  assert.ok(formattedFail.includes('✘'));
  console.log('[PASS] Test 4: formatTelegramReport generates expected markdown with badges');

  console.log('--- All VpsVerifier tests passed! ---');
}

if (process.argv[1]?.endsWith('test_vps_verifier.ts')) {
  testVpsVerifier().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
