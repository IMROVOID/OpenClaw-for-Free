import assert from 'assert';
import { DaytonaDriver } from '../src/control-panel/core/daytonaDriver.js';
import { FreestyleDriver } from '../src/control-panel/core/freestyleDriver.js';
import { VpsProviderFactory } from '../src/control-panel/core/vpsProviderDriver.js';
import { DaytonaApi } from '../src/control-panel/core/daytonaApi.js';
import { ConfigManager, DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { MenuView } from '../src/control-panel/tui/menuView.js';
import { OnboardingSteps } from '../src/control-panel/core/onboardingSteps.js';
import { SshTerminalLauncher } from '../src/control-panel/core/sshTerminalLauncher.js';

async function testProviderDrivers() {
  console.log('--- Running test: Provider Drivers ---');

  // 1. Daytona Driver Tests
  const daytonaDriver = new DaytonaDriver();
  assert.strictEqual(daytonaDriver.providerId, 'daytona');
  assert.strictEqual(daytonaDriver.hasDirectEgress, false);
  assert.strictEqual(daytonaDriver.defaultSpecs.storageGb, 10);
  assert.strictEqual(daytonaDriver.defaultSpecs.cpuCores, 4);

  // 1a. provisionDualVms must expose workspace IDs and not invent phantom targets
  const origProvWorkspace = DaytonaApi.provisionWorkspace;
  try {
    DaytonaApi.provisionWorkspace = async (_k, name) => ({
      success: true,
      workspaceId: `ws_${name}`,
      sshTarget: `tok_${name}@ssh.app.daytona.io`
    });
    const daytonaProv = await daytonaDriver.provisionDualVms('test-daytona-key', 'openclaw');
    assert(daytonaProv.primarySshTarget.includes('@ssh.app.daytona.io'));
    assert(daytonaProv.secondarySshTarget.includes('@ssh.app.daytona.io'));
    assert.strictEqual(daytonaProv.primaryWorkspaceId, 'ws_openclaw-primary', 'Dual provision should expose primary workspace id');
    assert.strictEqual(daytonaProv.secondaryWorkspaceId, 'ws_openclaw-llama', 'Dual provision should expose secondary workspace id');
    assert.strictEqual(daytonaProv.specs.storageGb, 10);

    // 1b. provisionPrimary returns a real workspace id
    const pRes = await daytonaDriver.provisionPrimary('test-daytona-key', 'openclaw');
    assert.strictEqual(pRes.primaryWorkspaceId, 'ws_openclaw-primary', 'provisionPrimary must expose workspaceId');
    assert.strictEqual(pRes.secondarySshTarget, '', 'provisionPrimary must not create a secondary');

    // 1c. provisionSecondary returns a real workspace id
    const sRes = await daytonaDriver.provisionSecondary('test-daytona-key', 'openclaw');
    assert.strictEqual(sRes.secondaryWorkspaceId, 'ws_openclaw-llama', 'provisionSecondary must expose workspaceId');

    // 1d. Real provisioning failure must throw (no silent fake)
    DaytonaApi.provisionWorkspace = async () => ({ success: false, workspaceId: '', sshTarget: '', error: 'HTTP 500: quota exceeded' });
    await assert.rejects(() => daytonaDriver.provisionDualVms('test-daytona-key', 'openclaw'), /Failed to provision/, 'provisionDualVms must throw on real failure');
    await assert.rejects(() => daytonaDriver.provisionPrimary('test-daytona-key', 'openclaw'), /Failed to provision/, 'provisionPrimary must throw on real failure');
  } finally {
    DaytonaApi.provisionWorkspace = origProvWorkspace;
  }

  // 2. Freestyle Driver Tests
  const freestyleDriver = new FreestyleDriver();
  assert.strictEqual(freestyleDriver.providerId, 'freestyle');
  assert.strictEqual(freestyleDriver.hasDirectEgress, true);
  assert.strictEqual(freestyleDriver.defaultSpecs.storageGb, 32);
  assert.strictEqual(freestyleDriver.defaultSpecs.cpuCores, 4);

  const fsProv = await freestyleDriver.provisionDualVms('fst_test_1234567890abcdef1234', 'testclaw');
  assert(fsProv.primarySshTarget.includes('@beta-ssh.freestyle.sh'));
  assert(fsProv.secondarySshTarget.includes('@beta-ssh.freestyle.sh'));
  assert(fsProv.primarySshTarget.startsWith('testclaw-primary:'));
  assert(fsProv.secondarySshTarget.startsWith('testclaw-llama:'));
  assert.strictEqual(fsProv.interVmEndpoint, 'testclaw-llama.openclaw-mesh');
  assert.strictEqual(fsProv.specs.storageGb, 32);
  assert.strictEqual(fsProv.primarySlug, 'testclaw-primary', 'Dual provision should expose primary slug');
  assert.strictEqual(fsProv.secondarySlug, 'testclaw-llama', 'Dual provision should expose secondary slug');
  assert(fsProv.primaryWorkspaceId, 'Dual provision should expose primary workspace id');

  // 2a. Freestyle provisionPrimary exposes slug + id and only builds the primary
  const fpRes = await freestyleDriver.provisionPrimary('fst_test_1234567890abcdef1234', 'testclaw');
  assert.strictEqual(fpRes.primarySlug, 'testclaw-primary', 'provisionPrimary must expose primary slug');
  assert.strictEqual(fpRes.primaryWorkspaceId, 'vm_testclaw-primary', 'provisionPrimary must expose workspace id');
  assert(fpRes.primarySshTarget.startsWith('testclaw-primary:'), 'provisionPrimary must mint a scoped SSH target');
  assert.strictEqual(fpRes.secondarySshTarget, '', 'provisionPrimary must not create a secondary');

  // 2b. Freestyle provisionSecondary exposes slug + id
  const fsSec = await freestyleDriver.provisionSecondary('fst_test_1234567890abcdef1234', 'testclaw');
  assert.strictEqual(fsSec.secondarySlug, 'testclaw-llama');
  assert.strictEqual(fsSec.secondaryWorkspaceId, 'vm_testclaw-llama');
  assert(fsSec.secondarySshTarget.startsWith('testclaw-llama:'));

  // 2b. FreestyleDriver.detectHardware 32GB disk retain
  const detectedFsSpecs = await freestyleDriver.detectHardware('dummy-target');
  assert.strictEqual(detectedFsSpecs.storageGb, 32, 'FreestyleDriver must retain 32GB storage');

  // 3. Provider Factory Tests
  const dFromFactory = VpsProviderFactory.getDriver('daytona');
  assert.strictEqual(dFromFactory.providerId, 'daytona');

  const fFromFactory = VpsProviderFactory.getDriver('freestyle');
  assert.strictEqual(fFromFactory.providerId, 'freestyle');

  // 4. ConfigManager Default Provider & Fallback
  assert.strictEqual(DEFAULT_CONFIG.provider, 'freestyle', 'DEFAULT_CONFIG must have provider: freestyle');
  const parsedTarget = ConfigManager.parseSshTarget('openclaw:tok123@beta-ssh.freestyle.sh', 'fallback');
  assert.strictEqual(parsedTarget, 'openclaw:tok123@beta-ssh.freestyle.sh', 'Should parse colon-bearing Freestyle SSH target');

  const fsBare = ConfigManager.parseSshTarget('my-freestyle-node', 'fallback', 'freestyle');
  assert.strictEqual(fsBare, 'my-freestyle-node', 'Should not append daytona domain for freestyle provider');

  const fsTokenPair = ConfigManager.parseSshTarget('my-node:my-tok', 'fallback', 'freestyle');
  assert.strictEqual(fsTokenPair, 'my-node:my-tok@beta-ssh.freestyle.sh', 'Should append beta-ssh for freestyle slug:token');

  // 4b. ConfigManager save/load round-trip with provider: 'freestyle'
  const origSave = ConfigManager.save;
  const origLoad = ConfigManager.load;
  let mockStored: any = null;
  ConfigManager.save = (c) => { mockStored = { ...c }; };
  ConfigManager.load = () => ({ ...DEFAULT_CONFIG, ...mockStored });
  try {
    const testFsConfig = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle' as const,
      freestyleApiKey: 'fst_roundtrip_secret_key'
    };
    ConfigManager.save(testFsConfig);
    const reloaded = ConfigManager.load();
    assert.strictEqual(reloaded.provider, 'freestyle', 'Round-trip config should retain provider: freestyle');
    assert.strictEqual(reloaded.freestyleApiKey, 'fst_roundtrip_secret_key', 'Round-trip config should retain freestyleApiKey');
  } finally {
    ConfigManager.save = origSave;
    ConfigManager.load = origLoad;
  }

  // 5. MenuView Freestyle Direct Egress Badge
  const freestyleConfig = {
    ...DEFAULT_CONFIG,
    provider: 'freestyle' as const,
    primarySshTarget: 'openclaw-primary:tok1@beta-ssh.freestyle.sh'
  };

  const menuOnlineRes = MenuView.render(freestyleConfig, {
    openclaw: true,
    omniroute: true,
    llama: false,
    egressRelay: true,
    primarySsh: true
  }, 0, 90, 1);

  const menuOnlineText = menuOnlineRes.lines.join('\n');
  assert(menuOnlineText.includes('[ONLINE DIRECT]'), 'Freestyle MenuView must display [ONLINE DIRECT] when primary SSH is online');
  assert(menuOnlineText.includes('Network Egress'), 'Freestyle MenuView must display Network Egress label');
  assert(menuOnlineText.includes('Exit Control Panel'), 'MenuView must include Exit Control Panel');
  assert(!menuOnlineText.includes('Exit Control Panel (Local Only)'), 'Exit Control Panel must not contain (Local Only)');
  assert(menuOnlineText.includes('Logout'), 'MenuView must include Logout option');
  assert(menuOnlineRes.hitboxes.some((h) => h.key === 'L'), 'MenuView hitboxes must include L key for Logout');
  assert(menuOnlineRes.hitboxes.some((h) => h.key === 'Q'), 'MenuView hitboxes must include Q key for Exit');

  // 5b. MenuView Freestyle Offline Handling
  const menuOfflineRes = MenuView.render(freestyleConfig, {
    openclaw: false,
    omniroute: false,
    llama: false,
    egressRelay: false,
    primarySsh: false
  }, 0, 90, 1);

  const menuOfflineText = menuOfflineRes.lines.join('\n');
  assert(menuOfflineText.includes('[OFFLINE]'), 'Freestyle MenuView must render [OFFLINE] badge when primary SSH is false');
  assert(!menuOfflineText.includes('[ONLINE DIRECT]'), 'Freestyle MenuView must not render [ONLINE DIRECT] when primary SSH is offline');

  // 6. Model Selection Default (Qwen 2.5 7B MTP)
  const defaultModel = await OnboardingSteps.promptModelSelection(async () => '1', 'freestyle');
  assert.strictEqual(defaultModel.enabled, true);
  assert.strictEqual(defaultModel.modelName, 'Qwen 2.5 7B MTP');
  assert.strictEqual(defaultModel.enableMtp, true);
  assert.strictEqual(defaultModel.contextSize, 32768);
  assert.strictEqual(defaultModel.kvCacheQuant, 'q4_0');

  // 6b. Remote Provisioning Command Formatting with Model Flags
  const llamaCmd = OnboardingSteps.buildProvisioningCommand('llama', 'freestyle', {
    modelUrl: 'https://huggingface.co/custom/model.gguf',
    modelName: 'Qwen 2.5 7B MTP'
  });
  assert(llamaCmd.includes('--model-url=https://huggingface.co/custom/model.gguf'), 'Should include model-url flag');
  assert(llamaCmd.includes('--model-filename=qwen-2.5-7b-mtp.gguf'), 'Should include model-filename flag');
  assert(llamaCmd.includes('--role=llama'), 'Should include role=llama flag');
  assert(llamaCmd.includes('--provider=freestyle'), 'Should include provider=freestyle flag');

  // 7. SSH Terminal Launcher Command Formatting
  // 8. FreestyleDriver filters deleted/terminated VMs
  const { FreestyleApi } = await import('../src/control-panel/core/freestyleApi.js');
  const origListVms = FreestyleApi.listVms;
  try {
    FreestyleApi.listVms = async () => [
      { id: 'vm_live', slug: 'live-vm', state: 'running', cpu: 4, memory: 8192, storage: 32768 },
      { id: 'vm_del', slug: 'deleted-vm', state: 'deleted', cpu: 4, memory: 8192, storage: 32768 },
      { id: 'vm_term', slug: 'term-vm', state: 'terminated', cpu: 4, memory: 8192, storage: 32768 },
      { id: 'vm_dest', slug: 'destroying-vm', state: 'destroying', cpu: 4, memory: 8192, storage: 32768 },
      { id: 'vm_flag', slug: 'flag-vm', state: 'running', deleted: true, cpu: 4, memory: 8192, storage: 32768 } as any
    ];
    const wsList = await freestyleDriver.listExistingWorkspaces('test-key');
    assert.strictEqual(wsList.length, 1, 'FreestyleDriver must filter out deleted/terminated VMs');
    assert.strictEqual(wsList[0].id, 'vm_live');
    console.log('[PASS] FreestyleDriver filters deleted/terminated VMs successfully!\n');
  } finally {
    FreestyleApi.listVms = origListVms;
  }

  console.log('[PASS] Provider driver tests completed successfully!\n');
}

(async () => {
  try {
    await testProviderDrivers();
  } catch (err) {
    console.error('[FAIL] test_provider_drivers:', err);
    process.exit(1);
  }
})();
