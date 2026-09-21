import assert from 'assert';
import { DaytonaApi, HARD_LIMIT_SPECS } from '../src/control-panel/core/daytonaApi.js';
import { VpsSpecs, DaytonaAccountQuota } from '../src/control-panel/core/types.js';

const TEST_SPECS: VpsSpecs = { cpuCores: 4, ramGb: 8, storageGb: 10 };

function testDaytonaApi() {
  console.log('--- Running test: DaytonaApi ---');

  // 1. Verify API Key Guidance
  const guidance = DaytonaApi.getApiKeyGuidance();
  assert(guidance.length >= 3, 'Should provide step-by-step API guidance');
  assert(guidance[0].includes('https://app.daytona.io'), 'Should point to Daytona app URL');

  // 2. Test Hardware Bounds Enforcement
  const requestedHigh: VpsSpecs = { cpuCores: 16, ramGb: 32, storageGb: 100 };
  const boundedHigh = DaytonaApi.enforceHardwareBounds(requestedHigh);

  assert.strictEqual(boundedHigh.cpuCores, 4, 'Should cap CPU to 4 vCPU');
  assert.strictEqual(boundedHigh.ramGb, 8, 'Should cap RAM to 8 GB');
  assert.strictEqual(boundedHigh.storageGb, 10, 'Should cap storage to 10 GB');

  // 3. Test Bounds with Limited Account Quota
  const quotaLow: DaytonaAccountQuota = {
    valid: true,
    availableCores: 2,
    availableRamGb: 4,
    availableStorageGb: 8,
    hardLimitCores: HARD_LIMIT_SPECS.cpuCores,
    hardLimitRamGb: HARD_LIMIT_SPECS.ramGb,
    hardLimitStorageGb: HARD_LIMIT_SPECS.storageGb
  };

  const boundedQuota = DaytonaApi.enforceHardwareBounds(requestedHigh, quotaLow);
  assert.strictEqual(boundedQuota.cpuCores, 2, 'Should cap to available quota cores');
  assert.strictEqual(boundedQuota.ramGb, 4, 'Should cap to available quota RAM');
  assert.strictEqual(boundedQuota.storageGb, 8, 'Should cap to available quota storage');

  // 4. Test Minimum Lower Bound
  const requestedLow: VpsSpecs = { cpuCores: 0, ramGb: 0, storageGb: 0 };
  const boundedLow = DaytonaApi.enforceHardwareBounds(requestedLow);
  assert(boundedLow.cpuCores >= 1, 'Should enforce at least 1 core');
  assert(boundedLow.ramGb >= 2, 'Should enforce at least 2 GB RAM');
  assert(boundedLow.storageGb >= 5, 'Should enforce at least 5 GB disk');

  // 5. Test Existing Guidance Methods
  const existingApiGuidance = DaytonaApi.getExistingApiKeyGuidance();
  assert(existingApiGuidance.length >= 3, 'Should provide existing API key guidance');
  assert(existingApiGuidance.some(g => g.includes('settings/keys')), 'Should link to API key settings');

  const sandboxGuidance = DaytonaApi.getSandboxGuidance();
  assert(sandboxGuidance.length >= 3, 'Should provide sandbox UUID/name guidance');

  const sshGuidance = DaytonaApi.getExistingSshGuidance();
  assert(sshGuidance.length >= 3, 'Should provide SSH target guidance');
  assert(sshGuidance.some(g => g.includes('ssh.app.daytona.io')), 'Should mention ssh.app.daytona.io');

  console.log('[PASS] DaytonaApi bounds and quota tests completed successfully!\n');
}

async function testResolveSandbox() {
  console.log('--- Running test: DaytonaApi.resolveSandbox ---');
  const res = await DaytonaApi.resolveSandbox('test-key', 'my-test-sandbox');
  assert.strictEqual(res.success, true, 'Should succeed resolving sandbox');
  assert.strictEqual(res.sshTarget, 'my-test-sandbox@ssh.app.daytona.io', 'Should construct standard Daytona SSH target');

  const noKey = await DaytonaApi.createSshAccess('', 'sandbox-123');
  assert.strictEqual(noKey.success, false, 'Should fail without API key');
  const noId = await DaytonaApi.createSshAccess('key-123', '');
  assert.strictEqual(noId.success, false, 'Should fail without Sandbox ID');

  console.log('[PASS] DaytonaApi resolveSandbox & createSshAccess tests completed successfully!\n');
}

async function testProvisionWorkspaceHonest() {
  console.log('--- Running test: DaytonaApi.provisionWorkspace honest results ---');
  const origHttp = DaytonaApi.httpRequest;
  const origCreateSsh = DaytonaApi.createSshAccess;
  try {
    // Success path exposes the real workspaceId and the minted SSH target
    DaytonaApi.httpRequest = async () => ({ statusCode: 201, body: JSON.stringify({ id: 'ws_real_123' }) });
    DaytonaApi.createSshAccess = async (_k, sandboxId) => {
      assert.strictEqual(sandboxId, 'ws_real_123', 'createSshAccess must be called with the real workspace id');
      return { success: true, sshTarget: 'fresh_token@ssh.app.daytona.io' };
    };
    const ok = await DaytonaApi.provisionWorkspace('key', 'openclaw-primary', TEST_SPECS);
    assert.strictEqual(ok.success, true, 'Should succeed on 2xx');
    assert.strictEqual(ok.workspaceId, 'ws_real_123', 'Should expose the real workspace id');
    assert.strictEqual(ok.sshTarget, 'fresh_token@ssh.app.daytona.io', 'Should return the minted SSH target');
    assert.strictEqual(ok.error, undefined);

    // Non-2xx must be a real failure; never fabricate a fake id/target
    DaytonaApi.httpRequest = async () => ({ statusCode: 409, body: 'Workspace name already in use' });
    const fail409 = await DaytonaApi.provisionWorkspace('key', 'openclaw-primary', TEST_SPECS);
    assert.strictEqual(fail409.success, false, '409 must return success:false (no fake ID fallback)');
    assert(fail409.error?.includes('HTTP 409'), 'Should surface the HTTP error');
    assert(!fail409.sshTarget.includes('daytona-'), 'Must not fabricate a phantom daytona-* target');
    assert.strictEqual(fail409.workspaceId, '');
    assert(String(ok.workspaceId) !== String(fail409.workspaceId));

    // Network exception must be a real failure too
    DaytonaApi.httpRequest = async () => { throw new Error('network down'); };
    const failExc = await DaytonaApi.provisionWorkspace('key', 'openclaw-primary', TEST_SPECS);
    assert.strictEqual(failExc.success, false, 'Exception must return success:false');
    assert(failExc.error?.includes('network down'), 'Should surface the underlying error');

    // Provisioned workspace without usable SSH access must fail loudly (not fake target)
    DaytonaApi.httpRequest = async () => ({ statusCode: 201, body: JSON.stringify({ id: 'ws_ssh_fail' }) });
    DaytonaApi.createSshAccess = async () => ({ success: false, error: 'SSH access denied' });
    const failSsh = await DaytonaApi.provisionWorkspace('key', 'openclaw-primary', TEST_SPECS);
    assert.strictEqual(failSsh.success, false, 'Missing SSH access must return success:false');
    assert(failSsh.error?.includes('SSH access denied'));

    console.log('[PASS] DaytonaApi.provisionWorkspace honest result tests passed!\n');
  } finally {
    DaytonaApi.httpRequest = origHttp;
    DaytonaApi.createSshAccess = origCreateSsh;
  }
}

async function testListWorkspacesAuthDetection() {
  console.log('--- Running test: DaytonaApi.listWorkspacesDetailed auth detection ---');
  const origHttp = DaytonaApi.httpRequest;
  try {
    // 401 on a reachable endpoint must be surfaced as authError, not an empty list
    DaytonaApi.httpRequest = async () => ({ statusCode: 401, body: 'unauthorized' });
    const det401 = await DaytonaApi.listWorkspacesDetailed('expired-key');
    assert.strictEqual(det401.authError, true, '401 must be detected as authError');
    assert.strictEqual(det401.workspaces.length, 0);

    // 2xx parses workspaces normally
    DaytonaApi.httpRequest = async () => ({
      statusCode: 200,
      body: JSON.stringify([{ id: 'ws_a', name: 'openclaw-primary', resources: { cpu: 4, memory: 8, disk: 10 } }])
    });
    const det200 = await DaytonaApi.listWorkspacesDetailed('valid-key');
    assert.strictEqual(det200.authError, false);
    assert.strictEqual(det200.ok, true);
    assert.strictEqual(det200.workspaces.length, 1);
    assert.strictEqual(det200.workspaces[0].id, 'ws_a');

    // Thin wrapper keeps the legacy shape
    const wrapped = await DaytonaApi.listWorkspaces('valid-key');
    assert.strictEqual(wrapped.length, 1);
    assert.strictEqual(wrapped[0].name, 'openclaw-primary');

    console.log('[PASS] DaytonaApi.listWorkspacesDetailed auth detection tests passed!\n');
  } finally {
    DaytonaApi.httpRequest = origHttp;
  }
}

async function testListWorkspacesFiltersDeleted() {
  console.log('--- Running test: DaytonaApi.listWorkspacesDetailed filters deleted sandboxes ---');
  const origHttp = DaytonaApi.httpRequest;
  try {
    DaytonaApi.httpRequest = async () => ({
      statusCode: 200,
      body: JSON.stringify([
        { id: 'ws_active', name: 'openclaw-primary', state: 'started', resources: { cpu: 4, memory: 8, disk: 10 } },
        { id: 'ws_deleted_1', name: 'old-sandbox', state: 'deleted', resources: { cpu: 4, memory: 8, disk: 10 } },
        { id: 'ws_destroyed', name: 'destroyed-sandbox', status: 'destroyed', resources: { cpu: 4, memory: 8, disk: 10 } },
        { id: 'ws_deleted_flag', name: 'flagged-sandbox', deleted: true, resources: { cpu: 4, memory: 8, disk: 10 } },
        { id: 'ws_terminating', name: 'terminating-sandbox', state: 'terminating', resources: { cpu: 4, memory: 8, disk: 10 } }
      ])
    });
    const res = await DaytonaApi.listWorkspacesDetailed('valid-key');
    assert.strictEqual(res.workspaces.length, 1, 'Only non-deleted workspaces should be returned');
    assert.strictEqual(res.workspaces[0].id, 'ws_active');
    console.log('[PASS] DaytonaApi filters deleted sandboxes successfully!\n');
  } finally {
    DaytonaApi.httpRequest = origHttp;
  }
}

(async () => {
  try {
    testDaytonaApi();
    await testResolveSandbox();
    await testProvisionWorkspaceHonest();
    await testListWorkspacesAuthDetection();
    await testListWorkspacesFiltersDeleted();
  } catch (e) {
    console.error('[FAIL] test_daytona_api:', e);
    process.exit(1);
  }
})();