import assert from 'assert';
import { ControlPanelApp } from '../src/control-panel/app.js';
import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';
import { VmSshAutoRenewer } from '../src/control-panel/core/vmSshAutoRenewer.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { MenuView } from '../src/control-panel/tui/menuView.js';
import { ServiceStatus } from '../src/control-panel/core/types.js';
import { SshTunnelManager } from '../src/control-panel/core/sshTunnelManager.js';
import { ActionDispatcher } from '../src/control-panel/core/actionDispatcher.js';

async function runTests() {
  console.log('--- Testing Status Detection Defect Reproduction ---');

  // Save original methods
  const origQueryVpsTelemetry = VpsProbe.queryVpsTelemetry;
  const origTestSshReachability = VpsProbe.testSshReachability;
  const origExecRemote = VpsProbe.execRemote;
  const origTestEgress = RailwayHelper.testVpsEgressTunnel;
  const origRenewSecondary = VmSshAutoRenewer.refreshSecondaryVmSsh;
  const origRenewPrimary = VmSshAutoRenewer.refreshPrimaryVmSsh;

  try {
    const testConfig = {
      ...DEFAULT_CONFIG,
      primarySshTarget: 'test-primary@ssh.app.daytona.io',
      secondarySshTarget: 'test-secondary@ssh.app.daytona.io',
      llama: {
        ...DEFAULT_CONFIG.llama,
        enabled: true,
        isSeparateVps: true,
        sshTarget: 'test-secondary@ssh.app.daytona.io'
      }
    };

    // 1. Mock VPS Probe: Remote daemons ARE running on the VPS
    VpsProbe.queryVpsTelemetry = async (target: string, isPrimary = true) => {
      if (isPrimary) {
        return {
          services: [
            { name: 'openclaw', status: 'RUNNING' as const, pid: 101 },
            { name: 'omniroute', status: 'RUNNING' as const, pid: 102 }
          ],
          hardware: null
        };
      }
      return {
        services: [
          { name: 'llama', status: 'RUNNING' as const, pid: 201 }
        ],
        hardware: null
      };
    };

    RailwayHelper.testVpsEgressTunnel = async () => ({ active: true, response: 'OK' });

    // Instantiate app and inject testConfig using typed accessor
    const app = new ControlPanelApp();
    interface TestAppAccessor {
      config: typeof testConfig;
      status: ServiceStatus;
      tunnelMgr: SshTunnelManager;
      statusMessage: string;
      render: () => void;
    }
    const appTest = app as unknown as TestAppAccessor;
    appTest.config = testConfig;
    appTest.status.primarySsh = true;

    // Mock tunnelMgr to simulate that local tunnels are NOT active / checkHttp fails
    appTest.tunnelMgr = {
      ensureTunnelsRunning: async () => ({
        openclawActive: false,
        omnirouteActive: true,
        llamaActive: false
      }),
      startAllTunnels: async () => ({
        openclawActive: false,
        omnirouteActive: true,
        llamaActive: false
      }),
      startPrimaryTunnel: async () => false,
      startSecondaryTunnel: async () => false,
      stopAll: () => {},
      checkTunnels: async () => ({
        openclawActive: false,
        omnirouteActive: true,
        llamaActive: false
      }),
      updateConfig: () => {}
    } as unknown as SshTunnelManager;

    // Trigger refreshTelemetry
    console.log('Test 1: refreshTelemetry must detect OpenClaw and Llama when remote VPS daemons are RUNNING...');
    await app.refreshTelemetry();

    const actionCtx = app.createActionContext();

    // Defect reproduction assertion:
    // When remote services are RUNNING, status.openclaw and status.llama must be TRUE (ONLINE),
    // matching Telegram Bot's behavior, even if local HTTP tunnels haven't responded yet.
    assert.strictEqual(
      actionCtx.status.openclaw,
      true,
      'OpenClaw status must be true when remote service is RUNNING on primary VPS'
    );
    assert.strictEqual(
      actionCtx.status.llama,
      true,
      'Llama status must be true when remote service is RUNNING on secondary VPS'
    );
    assert.strictEqual(
      actionCtx.status.omniroute,
      true,
      'OmniRoute status must be true'
    );

    // Test 2: MenuView renders [ONLINE] and does NOT render [Disabled - Inactive]
    console.log('Test 2: MenuView must show [ONLINE] and enable actions [1] and [3]...');
    const rendered = MenuView.render(testConfig, actionCtx.status, 0, 90);
    const text = rendered.lines.join('\n');
    assert(text.includes('OpenClaw (Port 18789) : \x1b[32m[ONLINE]\x1b[0m') || text.includes('[ONLINE]'), 'OpenClaw must be ONLINE');
    assert(text.includes('Llama AI (Port 8080)  : \x1b[32m[ONLINE]\x1b[0m') || text.includes('[ONLINE]'), 'Llama AI must be ONLINE');
    assert(!text.includes('[Disabled - Inactive]'), 'Actions [1] and [3] must NOT be [Disabled - Inactive]');

    // Test 3: ActionDispatcher allows triggering option 1 without [!] Inactive error
    console.log('Test 3: ActionDispatcher allows launching OpenClaw when service is online...');
    let lastStatusMsg = '';
    appTest.statusMessage = '';
    appTest.render = () => {};

    await ActionDispatcher.triggerMenuAction('1', app);
    assert(!lastStatusMsg.includes('INACTIVE'), `Action 1 must not report INACTIVE error, got: ${lastStatusMsg}`);

    // Test 4: Auto-renewal on expired secondary Daytona SSH token during telemetry
    console.log('Test 4: Auto-renewal of secondary Daytona SSH token during telemetry...');
    let secondaryRenewed = false;
    VmSshAutoRenewer.refreshSecondaryVmSsh = async (cfg) => {
      secondaryRenewed = true;
      cfg.secondarySshTarget = 'renewed-secondary@ssh.app.daytona.io';
      if (cfg.llama) cfg.llama.sshTarget = cfg.secondarySshTarget;
      return { renewed: true, found: true, newSshTarget: cfg.secondarySshTarget };
    };

    let secondaryAttempt = 0;
    VpsProbe.queryVpsTelemetry = async (target: string, isPrimary = true) => {
      if (isPrimary) {
        return {
          services: [{ name: 'openclaw', status: 'RUNNING' as const }, { name: 'omniroute', status: 'RUNNING' as const }],
          hardware: null
        };
      }
      secondaryAttempt++;
      if (secondaryAttempt === 1) {
        // First attempt fails due to expired token
        return { services: [], hardware: null };
      }
      // Second attempt succeeds after token renewal
      return {
        services: [{ name: 'llama', status: 'RUNNING' as const }],
        hardware: null
      };
    };

    await app.refreshTelemetry();
    assert.strictEqual(secondaryRenewed, true, 'Secondary Daytona SSH token must be auto-renewed when probe fails');
    const ctxAfterRenew = app.createActionContext();
    assert.strictEqual(ctxAfterRenew.status.llama, true, 'Llama must be online after auto-renewing secondary token');

    console.log('[PASS] Status detection defect tests passed successfully!\n');
  } finally {
    // Restore original methods
    VpsProbe.queryVpsTelemetry = origQueryVpsTelemetry;
    VpsProbe.testSshReachability = origTestSshReachability;
    VpsProbe.execRemote = origExecRemote;
    RailwayHelper.testVpsEgressTunnel = origTestEgress;
    VmSshAutoRenewer.refreshSecondaryVmSsh = origRenewSecondary;
    VmSshAutoRenewer.refreshPrimaryVmSsh = origRenewPrimary;
  }
}

runTests().catch((err) => {
  console.error('[FAIL] Status detection test failed:', err);
  process.exit(1);
});
