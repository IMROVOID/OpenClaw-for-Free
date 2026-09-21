import assert from 'assert';
import { ControlPanelApp } from '../src/control-panel/app.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { RailwayIngressVerifier } from '../src/control-panel/core/railwayIngressVerifier.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';
import { ActionDispatcher } from '../src/control-panel/core/actionDispatcher.js';
import { MenuView, MenuItemHitbox } from '../src/control-panel/tui/menuView.js';
import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';
import { ControlPanelConfig, ServiceStatus } from '../src/control-panel/core/types.js';
import { SshTunnelManager } from '../src/control-panel/core/sshTunnelManager.js';

interface TestAppAccessor {
  config: ControlPanelConfig;
  status: ServiceStatus;
  tunnelMgr: SshTunnelManager;
  statusMessage: string;
  selectedMenuIndex: number;
  menuHitboxes: MenuItemHitbox[];
  handleMouseClick: (ev: { button: number; row: number; col: number }) => void;
  render: () => void;
}

async function runTests() {
  console.log('--- Running Railway Auto-Verification & Inactive Selection Tests ---');

  // Test 1: Railway Ingress Auto-Detection & Verification
  console.log('Test 1: Railway Ingress Verifier auto-detects, verifies, and falls back correctly...');
  const origValidate = RailwayClient.validateApiKey;
  const origList = RailwayClient.listExistingRelays;
  const origCheck = RailwayHelper.checkRelayDomain;

  try {
    // 1a: Missing API token -> Disables domain & falls back to port forwarding
    const cfgNoToken: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      domainedUrlsEnabled: true,
      publicBaseDomain: 'unverified-relay.up.railway.app',
      ingressProvider: 'railway',
      railwayApiKey: ''
    };
    const resNoToken = await RailwayIngressVerifier.autoDetectAndVerify(cfgNoToken);
    assert.strictEqual(resNoToken.domainedUrlsEnabled, false, 'Domain must be disabled when token is missing');
    assert.strictEqual(resNoToken.publicBaseDomain, undefined, 'Domain must be cleared when token is missing');
    assert.strictEqual(resNoToken.ingressProvider, 'none');

    // 1b: Invalid API token -> Disables domain
    RailwayClient.validateApiKey = async () => ({ valid: false, error: 'Invalid API token' });
    const cfgInvalidToken: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      domainedUrlsEnabled: true,
      publicBaseDomain: 'unverified-relay.up.railway.app',
      ingressProvider: 'railway',
      railwayApiKey: 'invalid-token'
    };
    const resInvalidToken = await RailwayIngressVerifier.autoDetectAndVerify(cfgInvalidToken);
    assert.strictEqual(resInvalidToken.domainedUrlsEnabled, false, 'Domain must be disabled on invalid token');
    assert.strictEqual(resInvalidToken.publicBaseDomain, undefined);

    // 1c: Domain returns 404 -> Disables domain & falls back to port forwarding
    RailwayClient.validateApiKey = async () => ({ valid: true, user: 'test-user' });
    RailwayClient.listExistingRelays = async () => [
      {
        projectId: 'p1',
        projectName: 'proj1',
        serviceId: 's1',
        serviceName: 'web-relay',
        domain: 'relay-404.up.railway.app',
        fullUrl: 'https://relay-404.up.railway.app',
        isLlama: false
      }
    ];
    RailwayHelper.checkRelayDomain = async () => ({
      reachable: false,
      statusCode: 404,
      message: 'HTTP 404 (Not deployed)'
    });

    const cfg404: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      domainedUrlsEnabled: true,
      publicBaseDomain: 'relay-404.up.railway.app',
      ingressProvider: 'railway',
      railwayApiKey: 'valid-token'
    };
    const res404 = await RailwayIngressVerifier.autoDetectAndVerify(cfg404);
    assert.strictEqual(res404.domainedUrlsEnabled, false, 'Domain must be disabled when relay returns 404');
    assert.strictEqual(res404.publicBaseDomain, undefined);

    // 1d: Verified token & healthy 200 relay -> Enables domain & sets verified publicBaseDomain
    RailwayHelper.checkRelayDomain = async () => ({
      reachable: true,
      statusCode: 200,
      message: 'HTTP 200 OK'
    });

    const cfgValid: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      domainedUrlsEnabled: true,
      publicBaseDomain: 'relay-404.up.railway.app',
      ingressProvider: 'railway',
      railwayApiKey: 'valid-token'
    };
    const resValid = await RailwayIngressVerifier.autoDetectAndVerify(cfgValid);
    assert.strictEqual(resValid.domainedUrlsEnabled, true, 'Domain must remain enabled when verified');
    assert.strictEqual(resValid.publicBaseDomain, 'relay-404.up.railway.app');
    assert.strictEqual(resValid.ingressProvider, 'railway');
  } finally {
    RailwayClient.validateApiKey = origValidate;
    RailwayClient.listExistingRelays = origList;
    RailwayHelper.checkRelayDomain = origCheck;
  }

  // Test 2: Inactive Option Selection & Clicking Prevention
  console.log('Test 2: Inactive options cannot be clicked, navigated to, or executed...');
  const app = new ControlPanelApp();
  const appTest = app as unknown as TestAppAccessor;

  // Set OpenClaw and Llama to inactive
  appTest.status = {
    primarySsh: true,
    secondarySsh: true,
    openclaw: false,
    omniroute: true,
    llama: false,
    egressRelay: true
  };
  appTest.config = {
    ...DEFAULT_CONFIG,
    domainedUrlsEnabled: false,
    llama: { ...DEFAULT_CONFIG.llama, enabled: true }
  };

  // Render main menu to populate hitboxes
  app.render();

  // Verify hitboxes have disabled property set
  const ocHitbox = appTest.menuHitboxes.find((h) => h.key === '1');
  const orHitbox = appTest.menuHitboxes.find((h) => h.key === '2');
  const lmHitbox = appTest.menuHitboxes.find((h) => h.key === '3');

  assert.strictEqual(ocHitbox?.disabled, true, 'OpenClaw hitbox must be marked disabled');
  assert.strictEqual(orHitbox?.disabled, false, 'OmniRoute hitbox must be active');
  assert.strictEqual(lmHitbox?.disabled, true, 'Llama AI hitbox must be marked disabled');

  // 2a: Mouse click on inactive option must NOT select it or trigger action
  appTest.selectedMenuIndex = 1; // Start on option 2 (OmniRoute)
  if (ocHitbox) {
    appTest.handleMouseClick({ button: 0, row: ocHitbox.row, col: ocHitbox.colStart + 1 });
    assert.strictEqual(appTest.selectedMenuIndex, 1, 'Clicking disabled option must not change selection');
    assert.ok(appTest.statusMessage.includes('disabled while service is inactive'), 'Status message must warn option is disabled');
  }

  // 2b: Keyboard navigation must skip disabled options
  appTest.selectedMenuIndex = 1; // Currently on option 2
  app.navigateSelection(-1); // Try moving up towards option 1 (OpenClaw)
  // Should skip option 1 and wrap around to an enabled option (e.g. Q or last option)
  assert.notStrictEqual(appTest.selectedMenuIndex, 0, 'navigateSelection must not land on inactive option 1');

  // 2c: ActionDispatcher.triggerMenuAction strictly rejects inactive service
  let triggered = false;
  appTest.statusMessage = '';
  await ActionDispatcher.triggerMenuAction('1', app);
  assert.ok(appTest.statusMessage.includes('INACTIVE'), 'Direct trigger on inactive service must be rejected');

  // Test 3: Llama process detection and Freestyle direct egress
  console.log('Test 3: VpsProbe detects process-level llama and Freestyle direct egress...');
  const origExec = VpsProbe.execRemote;
  try {
    // Mock VPS probe output with PROC section
    VpsProbe.execRemote = async (_target, cmd) => {
      if (cmd.includes('---PROC---')) {
        return {
          code: 0,
          stdout: 'sudo supervisorctl status\n---SYSTEMD---\n---PROC---\nopenclaw:RUNNING\nllama:RUNNING\n---HARDWARE---\nCPU: 10%\n',
          stderr: ''
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const telem = await VpsProbe.queryVpsTelemetry('mock-vps', true);
    const ocService = telem.services.find((s) => s.name === 'openclaw');
    const lmService = telem.services.find((s) => s.name === 'llama');

    assert.ok(ocService && ocService.status === 'RUNNING', 'OpenClaw process must be detected as RUNNING');
    assert.ok(lmService && lmService.status === 'RUNNING', 'Llama process must be detected as RUNNING');
  } finally {
    VpsProbe.execRemote = origExec;
  }

  console.log('[PASS] All Railway Auto-Verification & Inactive Selection tests passed!');
}

runTests().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
