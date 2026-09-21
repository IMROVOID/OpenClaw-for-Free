import assert from 'assert';
import { VmSshAutoRenewer } from '../src/control-panel/core/vmSshAutoRenewer.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { ConfigManager, DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { FreestyleApi } from '../src/control-panel/core/freestyleApi.js';
import { DaytonaApi } from '../src/control-panel/core/daytonaApi.js';

function validQuota() {
  return {
    valid: true as const,
    availableCores: 4,
    availableRamGb: 8,
    availableStorageGb: 10,
    hardLimitCores: 4,
    hardLimitRamGb: 8,
    hardLimitStorageGb: 10
  };
}

async function runTests() {
  console.log('--- Running test: VmSshAutoRenewer ---');

  const origFstList = FreestyleApi.listVms;
  const origFstToken = FreestyleApi.createIdentityToken;
  const origFstValidate = FreestyleApi.validateApiKey;
  const origDaytoList = DaytonaApi.listWorkspacesDetailed;
  const origDaytoValidate = DaytonaApi.validateApiKey;
  const origDaytoAccess = DaytonaApi.createSshAccess;
  const origConfigSave = ConfigManager.save;

  try {
    ConfigManager.save = () => {};

    // 1. Freestyle primary renewal via matching slug (unchanged behavior)
    FreestyleApi.validateApiKey = async () => ({ valid: true, vms: [{ id: 'vm_123', slug: 'my-openclaw-primary' }] });
    FreestyleApi.createIdentityToken = async (_k, vmId) => {
      assert.strictEqual(vmId, 'vm_123');
      return { token: 'new_token_abc', expiresAt: null };
    };
    const freestyleCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle',
      freestyleApiKey: 'fst_test_key_123',
      primarySshTarget: 'my-openclaw-primary:old_expired_token@beta-ssh.freestyle.sh'
    };
    const res1 = await VmSshAutoRenewer.refreshPrimaryVmSsh(freestyleCfg);
    assert.strictEqual(res1.renewed, true, 'Freestyle VM SSH should be renewed');
    assert.strictEqual(res1.found, true, 'Freestyle VM should be found');
    assert.strictEqual(res1.newSshTarget, 'my-openclaw-primary:new_token_abc@beta-ssh.freestyle.sh');
    assert.strictEqual(freestyleCfg.primarySshTarget, 'my-openclaw-primary:new_token_abc@beta-ssh.freestyle.sh');
    assert.strictEqual(freestyleCfg.freestylePrimarySlug, 'my-openclaw-primary');
    assert.strictEqual(freestyleCfg.freestylePrimaryVmId, 'vm_123');
    console.log('[PASS] Freestyle Primary VM SSH renewal verified');

    // 2. Daytona renewal via stored workspace id even when the expired token cannot match any workspace name
    DaytonaApi.validateApiKey = async () => validQuota();
    DaytonaApi.listWorkspacesDetailed = async () => ({
      ok: true,
      authError: false,
      workspaces: [
        { id: 'ws_other_1', name: 'random-sandbox', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_store_42', name: 'main-node', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_other_2', name: 'scratch-box', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } }
      ]
    });
    DaytonaApi.createSshAccess = async (_k, wsId) => {
      assert.strictEqual(wsId, 'ws_store_42', 'Must mint SSH for the stored workspace id, not a heuristic pick');
      return { success: true, sshTarget: 'fresh_daytona_token@ssh.app.daytona.io' };
    };
    const daytonaCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'daytona',
      daytonaApiKey: 'daytona_key_1234567890',
      daytonaPrimaryWorkspaceId: 'ws_store_42',
      primarySshTarget: 'old_expired_daytona_token@ssh.app.daytona.io'
    };
    const res2 = await VmSshAutoRenewer.refreshPrimaryVmSsh(daytonaCfg);
    assert.strictEqual(res2.renewed, true, 'Daytona VM SSH should be renewed via stored UUID');
    assert.strictEqual(res2.found, true);
    assert.strictEqual(res2.newSshTarget, 'fresh_daytona_token@ssh.app.daytona.io');
    assert.strictEqual(daytonaCfg.primarySshTarget, 'fresh_daytona_token@ssh.app.daytona.io');
    assert.strictEqual(daytonaCfg.daytonaPrimaryWorkspaceId, 'ws_store_42');
    console.log('[PASS] Daytona renewal via stored UUID when token cannot match verified');

    // 3. Expired/invalid Daytona API key must produce an explicit reason, not recovery-ambiguity
    DaytonaApi.validateApiKey = async () => ({
      valid: false,
      availableCores: 0,
      availableRamGb: 0,
      availableStorageGb: 0,
      hardLimitCores: 4,
      hardLimitRamGb: 8,
      hardLimitStorageGb: 10,
      error: 'HTTP 401: Authentication failed'
    });
    const res3 = await VmSshAutoRenewer.refreshPrimaryVmSsh(daytonaCfg);
    assert.strictEqual(res3.renewed, false);
    assert.strictEqual(res3.found, false);
    assert.strictEqual(res3.error, 'API key invalid or expired', 'Expired key must be reported explicitly');
    console.log('[PASS] Expired Daytona API key reported explicitly');

    // 4. Reachable-but-401 on the sandbox list must also be reported as key expired
    DaytonaApi.validateApiKey = async () => validQuota();
    DaytonaApi.listWorkspacesDetailed = async () => ({ ok: false, authError: true, workspaces: [] });
    const res4 = await VmSshAutoRenewer.refreshPrimaryVmSsh(daytonaCfg);
    assert.strictEqual(res4.renewed, false);
    assert.strictEqual(res4.error, 'API key invalid or expired', '401 on list must not be conflated with empty account');
    console.log('[PASS] Reachable-but-401 list reported as key expired');

    // 5. Multiple workspaces with no stored id and no heuristic match -> found:false + error lists workspaces
    DaytonaApi.listWorkspacesDetailed = async () => ({
      ok: true,
      authError: false,
      workspaces: [
        { id: 'ws_x1', name: 'scratch-a', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_x2', name: 'scratch-b', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_x3', name: 'scratch-c', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } }
      ]
    });
    const multiCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'daytona',
      daytonaApiKey: 'daytona_key_1234567890',
      primarySshTarget: 'old_expired_daytona_token@ssh.app.daytona.io'
    };
    const res5 = await VmSshAutoRenewer.refreshPrimaryVmSsh(multiCfg);
    assert.strictEqual(res5.renewed, false);
    assert.strictEqual(res5.found, false, 'Ambiguous workspace set must not mint SSH for a guessed VM');
    assert(res5.error?.includes('ws_x1') && res5.error?.includes('ws_x2'), 'Error should list the candidate workspaces');
    console.log('[PASS] Ambiguous multi-workspace returns found:false with workspace list');

    // 6. Daytona secondary renewal via stored daytonaSecondaryWorkspaceId
    DaytonaApi.listWorkspacesDetailed = async () => ({
      ok: true,
      authError: false,
      workspaces: [
        { id: 'ws_p', name: 'openclaw-primary', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_sec7', name: 'anything-else', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } }
      ]
    });
    DaytonaApi.createSshAccess = async (_k, wsId) => {
      assert.strictEqual(wsId, 'ws_sec7', 'Secondary must renew via the stored secondary workspace id');
      return { success: true, sshTarget: 'sec_fresh_token@ssh.app.daytona.io' };
    };
    const secDayCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'daytona',
      secondaryProvider: 'daytona',
      daytonaApiKey: 'daytona_key_1234567890',
      daytonaSecondaryWorkspaceId: 'ws_sec7',
      llama: {
        ...DEFAULT_CONFIG.llama,
        enabled: true,
        isSeparateVps: true,
        sshTarget: 'stale_sec_token@ssh.app.daytona.io'
      },
      secondarySshTarget: 'stale_sec_token@ssh.app.daytona.io'
    };
    const res6 = await VmSshAutoRenewer.refreshSecondaryVmSsh(secDayCfg);
    assert.strictEqual(res6.renewed, true, 'Daytona secondary should renew via stored id');
    assert.strictEqual(secDayCfg.secondarySshTarget, 'sec_fresh_token@ssh.app.daytona.io');
    assert.strictEqual(secDayCfg.llama.sshTarget, 'sec_fresh_token@ssh.app.daytona.io');
    assert.strictEqual(secDayCfg.daytonaSecondaryWorkspaceId, 'ws_sec7');
    console.log('[PASS] Daytona secondary renewal via stored id verified');

    // 7. Freestyle expired API key -> explicit reason
    FreestyleApi.validateApiKey = async () => ({ valid: false, error: 'Authentication failed (HTTP 401)' });
    const badKeyCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle',
      freestyleApiKey: 'fst_real_but_revoked_key',
      primarySshTarget: 'vm-a:old_token@beta-ssh.freestyle.sh'
    };
    const res7 = await VmSshAutoRenewer.refreshPrimaryVmSsh(badKeyCfg);
    assert.strictEqual(res7.renewed, false);
    assert.strictEqual(res7.error, 'API key invalid or expired', 'Freestyle key failure must be explicit');
    console.log('[PASS] Freestyle expired API key reported explicitly');

    // 8. No active VMs under a valid key -> found:false
    FreestyleApi.validateApiKey = async () => ({ valid: true, vms: [] });
    FreestyleApi.validateApiKey = async () => ({ valid: true, vms: [] });
    const emptyCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle',
      freestyleApiKey: 'fst_test_empty_123',
      primarySshTarget: 'gone-vm:old_token@beta-ssh.freestyle.sh'
    };
    const res8 = await VmSshAutoRenewer.refreshPrimaryVmSsh(emptyCfg);
    assert.strictEqual(res8.renewed, false);
    assert.strictEqual(res8.found, false);
    assert(res8.error?.includes('No active VMs found'), 'Should report no active VMs');
    console.log('[PASS] Deleted VM correctly returns found: false');

    // 9. Freestyle multiple VMs, no match -> found:false + error lists candidate slugs
    FreestyleApi.validateApiKey = async () => ({
      valid: true,
      vms: [
        { id: 'vm_a', slug: 'web-server-a' },
        { id: 'vm_b', slug: 'web-server-b' }
      ]
    });
    const ghostCfg: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle',
      freestyleApiKey: 'fst_test_ghost_123',
      primarySshTarget: 'ghost-vm:old_token@beta-ssh.freestyle.sh'
    };
    const res9 = await VmSshAutoRenewer.refreshPrimaryVmSsh(ghostCfg);
    assert.strictEqual(res9.renewed, false);
    assert.strictEqual(res9.found, false, 'Ambiguous Freestyle slug set must not mint SSH for a guessed VM');
    assert(res9.error?.includes('web-server-a'), 'Error should list the candidate slugs');
    console.log('[PASS] Ambiguous Freestyle slug set returns found:false with candidate list');

    console.log('[PASS] All VmSshAutoRenewer tests passed successfully!');
  } finally {
    FreestyleApi.listVms = origFstList;
    FreestyleApi.createIdentityToken = origFstToken;
    FreestyleApi.validateApiKey = origFstValidate;
    DaytonaApi.listWorkspacesDetailed = origDaytoList;
    DaytonaApi.validateApiKey = origDaytoValidate;
    DaytonaApi.createSshAccess = origDaytoAccess;
    ConfigManager.save = origConfigSave;
  }
}

runTests().catch((err) => {
  console.error('[FAIL] test_vm_ssh_auto_renewer:', err);
  process.exit(1);
});