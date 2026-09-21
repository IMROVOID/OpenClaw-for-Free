import assert from 'assert';
import { FreestyleApi, FREESTYLE_DEFAULT_SPECS } from '../src/control-panel/core/freestyleApi.js';
import { VpsSpecs } from '../src/control-panel/core/types.js';

async function testFreestyleApi() {
  console.log('--- Running test: FreestyleApi ---');

  // 1. Guidance Methods
  const apiGuidance = FreestyleApi.getApiKeyGuidance();
  assert(apiGuidance.length >= 3, 'Should provide step-by-step Freestyle API guidance');
  assert(apiGuidance[0].includes('https://freestyle.sh'), 'Should point to freestyle.sh');

  const sshGuidance = FreestyleApi.getExistingSshGuidance();
  assert(sshGuidance.length >= 3, 'Should provide Freestyle SSH target guidance');
  assert(sshGuidance.some(g => g.includes('beta-ssh.freestyle.sh')), 'Should mention beta-ssh.freestyle.sh');

  // 2. SSH Target Formatting
  const formatted = FreestyleApi.formatSshTarget('openclaw-primary', 'fst_sec_abc123');
  assert.strictEqual(formatted, 'openclaw-primary:fst_sec_abc123@beta-ssh.freestyle.sh', 'Should format scoped token SSH target');

  // 3. Hardware Bounds Enforcement
  const requestedHigh: VpsSpecs = { cpuCores: 16, ramGb: 32, storageGb: 100 };
  const boundedHigh = FreestyleApi.enforceHardwareBounds(requestedHigh);
  assert.strictEqual(boundedHigh.cpuCores, 4, 'Should cap CPU to 4 vCPU');
  assert.strictEqual(boundedHigh.ramGb, 8, 'Should cap RAM to 8 GB');
  assert.strictEqual(boundedHigh.storageGb, 32, 'Should cap storage to 32 GB');

  const requestedLow: VpsSpecs = { cpuCores: 0, ramGb: 1, storageGb: 2 };
  const boundedLow = FreestyleApi.enforceHardwareBounds(requestedLow);
  assert.strictEqual(boundedLow.cpuCores, 1, 'Should enforce minimum 1 vCPU');
  assert.strictEqual(boundedLow.ramGb, 2, 'Should enforce minimum 2 GB RAM');
  assert.strictEqual(boundedLow.storageGb, 5, 'Should enforce minimum 5 GB storage');

  // 4. API Key Validation
  const emptyRes = await FreestyleApi.validateApiKey('');
  assert.strictEqual(emptyRes.valid, false, 'Empty key should be invalid');

  const fallbackKey = 'fst_test_1234567890abcdef1234';
  const valRes = await FreestyleApi.validateApiKey(fallbackKey);
  assert.strictEqual(valRes.valid, true, 'Valid formatted key should pass offline fallback validation');

  // 4b. Strict validation: Non-fst_test_ key should strictly fail on network error or auth failure
  const origHttp = (FreestyleApi as any).httpRequest;
  try {
    (FreestyleApi as any).httpRequest = async () => {
      throw new Error('ENOTFOUND api.freestyle.sh');
    };
    const nonFstLongKey = 'production_live_key_1234567890abcdef';
    const offlineRes = await FreestyleApi.validateApiKey(nonFstLongKey);
    assert.strictEqual(offlineRes.valid, false, 'Non-fst_test_ key should strictly fail when network fails');
    assert.ok(offlineRes.error?.includes('Network error'), 'Error message should describe network error');

    const shortKey = 'short-key';
    const shortRes = await FreestyleApi.validateApiKey(shortKey);
    assert.strictEqual(shortRes.valid, false, 'Short key should fail when network throws');
  } finally {
    (FreestyleApi as any).httpRequest = origHttp;
  }

  // 5. VM Creation and Identity Token Generation
  const vmRes = await FreestyleApi.createVm(fallbackKey, {
    slug: 'openclaw-primary',
    displayName: 'OpenClaw Primary Node',
    firewall: {
      rules: [{ action: 'allow', destination: { public: true } }]
    },
    networks: [{ vpc: 'openclaw-mesh', ipv4: true }]
  });
  assert(vmRes.success, 'VM creation should succeed');
  assert(vmRes.id.length > 0, 'VM ID should be present');
  assert.strictEqual(vmRes.slug, 'openclaw-primary', 'Slug should match');

  const tokenRes = await FreestyleApi.createIdentityToken(fallbackKey, vmRes.id);
  assert(tokenRes.token.length > 0, 'Identity token should be generated');

  // 5b. String slug VM creation with default firewall rules
  const stringSlugRes = await FreestyleApi.createVm(fallbackKey, 'openclaw-llama');
  assert.strictEqual(stringSlugRes.success, true, 'String slug VM creation should succeed');
  assert.strictEqual(stringSlugRes.slug, 'openclaw-llama', 'Slug should match string argument');

  console.log('[PASS] FreestyleApi tests completed successfully!\n');
}

(async () => {
  try {
    await testFreestyleApi();
  } catch (err) {
    console.error('[FAIL] test_freestyle_api:', err);
    process.exit(1);
  }
})();
