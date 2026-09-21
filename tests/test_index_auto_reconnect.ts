import assert from 'assert';
import { VpsDetector } from '../src/control-panel/core/vpsDetector.js';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';
import { VmSshAutoRenewer } from '../src/control-panel/core/vmSshAutoRenewer.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { ControlPanelConfig, InstallationState } from '../src/control-panel/core/types.js';

const REACHABLE_VM = {
  reachable: true,
  openclawInstalled: true,
  omnirouteInstalled: true,
  omnirouteActive: true,
  railwayRelayConfigured: false,
  railwayDomain: '',
  railwayUuid: '',
  llamaInstalled: true,
  llamaRunning: true
};

const UNREACHABLE_VM = {
  ...REACHABLE_VM,
  reachable: false,
  openclawInstalled: false,
  omnirouteInstalled: false
};

function daytonaConfig(overrides: Partial<ControlPanelConfig> = {}): ControlPanelConfig {
  return {
    ...DEFAULT_CONFIG,
    provider: 'daytona',
    daytonaApiKey: 'daytona_key_1234567890',
    primarySshTarget: 'expired_token@ssh.app.daytona.io',
    ...overrides
  };
}

async function testAutoReconnect() {
  console.log('--- Running test: VpsDetector Auto-Reconnect ---');
  const origInspectStatic = VpsConfigDetector.inspect;
  const origRenewPrimary = VmSshAutoRenewer.refreshPrimaryVmSsh;
  const origInspectAll = VpsDetector.inspectAll;

  try {
    // 1. inspectAll surfaces a SUCCESSFUL primary renewal and flips to skip_to_tui
    let inspectCount = 0;
    VpsConfigDetector.inspect = async () => {
      inspectCount++;
      return inspectCount === 1 ? UNREACHABLE_VM : REACHABLE_VM;
    };
    VmSshAutoRenewer.refreshPrimaryVmSsh = async (cfg) => {
      cfg.primarySshTarget = 'fresh_token@ssh.app.daytona.io';
      return { renewed: true, found: true, newSshTarget: 'fresh_token@ssh.app.daytona.io' };
    };
    const cfg1 = daytonaConfig();
    const state1 = await VpsDetector.inspectAll(cfg1);
    assert.strictEqual(state1.primaryReachable, true, 'Renewed primary must probe reachable');
    assert.strictEqual(state1.primaryRenewed, true, 'Successful renewal must be surfaced');
    assert.strictEqual(state1.primaryRenewError, undefined, 'No error on successful renewal');
    assert.strictEqual(state1.recoveryNeeded, false, 'Recovery must not be needed after successful reconnect');
    assert.strictEqual(VpsDetector.determineAction(state1), 'skip_to_tui', 'Fully configured after reconnect');
    assert.strictEqual(cfg1.primarySshTarget, 'fresh_token@ssh.app.daytona.io', 'Config must carry the renewed target');
    console.log('[PASS] Successful auto-renewal ends action=skip_to_tui');

    // 2. inspectAll surfaces an HONEST renewal failure as recovery, not a silent retry
    VpsConfigDetector.inspect = async () => UNREACHABLE_VM;
    VmSshAutoRenewer.refreshPrimaryVmSsh = async () => ({ renewed: false, found: false, error: 'API key invalid or expired' });
    const state2 = await VpsDetector.inspectAll(daytonaConfig());
    assert.strictEqual(state2.primaryReachable, false);
    assert.strictEqual(state2.primaryRenewed, false, 'Failed renewal must not be marked renewed');
    assert.strictEqual(state2.primaryRenewError, 'API key invalid or expired', 'Renewal error must be surfaced for the status');
    assert.strictEqual(state2.recoveryNeeded, true, 'Unreachable primary must still require recovery');
    assert.strictEqual(VpsDetector.determineAction(state2), 'vm_recovery', 'Honest failure must route to Recovery menu');
    console.log('[PASS] Honest renewal failure ends action=vm_recovery');

    // 3. autoReconnect retries inspect, stops when the VM reconnects within retries
    VmSshAutoRenewer.refreshPrimaryVmSsh = async (cfg) => {
      cfg.primarySshTarget = 'renewed_tok@ssh.app.daytona.io';
      return { renewed: true, found: true, newSshTarget: 'renewed_tok@ssh.app.daytona.io' };
    };
    VpsConfigDetector.inspect = async () => REACHABLE_VM;
    let allCalls = 0;
    const states: InstallationState[] = [
      {
        primaryReachable: false,
        primaryOpenclaw: false,
        primaryOmniroute: false,
        secondaryLlama: false,
        isFullyConfigured: false,
        isPartiallyConfigured: false,
        recoveryNeeded: true,
        missingVmType: 'primary',
        missingServices: ['Primary VPS unreachable / deleted'],
        primaryRenewed: false,
        primaryRenewError: 'transient blip'
      },
      {
        primaryReachable: true,
        primaryOpenclaw: true,
        primaryOmniroute: true,
        secondaryLlama: true,
        isFullyConfigured: true,
        isPartiallyConfigured: false,
        recoveryNeeded: false,
        missingVmType: 'none',
        missingServices: [],
        primaryRenewed: true
      }
    ];
    VpsDetector.inspectAll = async () => states[Math.min(allCalls++, states.length - 1)];
    const autoCfg = daytonaConfig();
    const autoState = await VpsDetector.autoReconnect(autoCfg, 1);
    assert.strictEqual(allCalls, 2, 'autoReconnect must re-inspect once after a failed first pass');
    assert.strictEqual(autoState.primaryReachable, true);
    assert.strictEqual(autoState.primaryRenewed, true, 'autoReconnect must adopt the renewed state');
    assert.strictEqual(VpsDetector.determineAction(autoState), 'skip_to_tui', 'autoReconnect must skip the Recovery menu when reconnected');
    console.log('[PASS] autoReconnect reconnects via API key and skips Recovery menu');

    // 4. autoReconnect exhausts retries and still ends at vm_recovery when renewal truthfully fails
    const failingState: InstallationState = {
      primaryReachable: false,
      primaryOpenclaw: false,
      primaryOmniroute: false,
      secondaryLlama: false,
      primaryRenewed: false,
      primaryRenewError: 'API key invalid or expired',
      recoveryNeeded: true,
      missingVmType: 'primary',
      missingServices: ['Primary VPS unreachable / deleted'],
      isFullyConfigured: false,
      isPartiallyConfigured: false
    };
    VpsDetector.inspectAll = async () => failingState;
    const failCfg = daytonaConfig();
    const failState = await VpsDetector.autoReconnect(failCfg, 2);
    assert.strictEqual(failState.recoveryNeeded, true, 'Recovery must still be needed after exhausted retries');
    assert.strictEqual(failState.primaryRenewError, 'API key invalid or expired');
    assert.strictEqual(VpsDetector.determineAction(failState), 'vm_recovery', 'Truthful failure must still route to the Recovery menu');
    console.log('[PASS] autoReconnect exhaustion ends action=vm_recovery');
  } finally {
    VpsConfigDetector.inspect = origInspectStatic;
    VmSshAutoRenewer.refreshPrimaryVmSsh = origRenewPrimary;
    VpsDetector.inspectAll = origInspectAll;
  }
}

testAutoReconnect().catch((err) => {
  console.error('[FAIL] test_index_auto_reconnect:', err);
  process.exit(1);
});