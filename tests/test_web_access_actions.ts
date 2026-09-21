import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { ActionDispatcher, DispatcherHost } from '../src/control-panel/core/actionDispatcher.js';
import { ActionContext, MenuActions } from '../src/control-panel/core/menuActions.js';
import { DomainedUrlResolver } from '../src/control-panel/core/domainedUrlResolver.js';
import { SshTunnelManager } from '../src/control-panel/core/sshTunnelManager.js';
import { SshTerminalLauncher } from '../src/control-panel/core/sshTerminalLauncher.js';
import { EndpointResolver } from '../src/control-panel/core/endpointResolver.js';
import { ControlPanelConfig, ServiceStatus } from '../src/control-panel/core/types.js';

const actions = [
  { key: '1', service: 'openclaw', run: MenuActions.openOpenClaw, resolve: DomainedUrlResolver.resolveOpenclawUrl.bind(DomainedUrlResolver) },
  { key: '2', service: 'omniroute', run: MenuActions.openOmniRoute, resolve: DomainedUrlResolver.resolveOmnirouteUrl.bind(DomainedUrlResolver) },
  { key: '3', service: 'llama', run: MenuActions.openLlama, resolve: DomainedUrlResolver.resolveLlamaUrl.bind(DomainedUrlResolver) }
] as const;

function fixture(overrides: Partial<ControlPanelConfig> = {}, status: ServiceStatus['openclaw'] = false) {
  const config = { ...structuredClone(DEFAULT_CONFIG), ...overrides };
  config.llama.enabled = true;
  const calls = { primary: 0, secondary: 0, urls: [] as string[], copied: [] as string[], messages: [] as string[] };
  const tunnelMgr = new SshTunnelManager(config);
  tunnelMgr.startPrimaryTunnel = async () => { calls.primary++; return true; };
  tunnelMgr.startSecondaryTunnel = async () => { calls.secondary++; return true; };
  tunnelMgr.checkTunnels = async () => ({ openclawActive: false, omnirouteActive: false, llamaActive: false });
  const ctx: ActionContext = {
    config, tunnelMgr,
    status: { openclaw: status, omniroute: status, llama: status, primarySsh: false, egressRelay: false },
    setStatusMessage: msg => { calls.messages.push(msg); }, render() {}
  };
  const host: DispatcherHost = {
    activeTab: 'main_menu', selectedMenuIndex: 0, selectedServiceIndex: 0,
    menuHitboxKeys: [], activeLogService: 'openclaw', createActionContext: () => ctx,
    setActiveTab() {}, setSelectedServiceIndex() {}, async loadLogs() {}, async refreshTelemetry() {},
    navigateSelection() {}, render() {}, shutdown() {}, logout() {}
  };
  return { ctx, host, calls };
}

for (const overrides of [
  { domainedUrlsEnabled: true, publicBaseDomain: 'https://access.example.test' },
  { customOpenclawUrl: 'https://claw.example.test', customOmnirouteUrl: 'https://route.example.test', customLlamaUrl: 'https://llama.example.test' }
]) {
  for (const action of actions) {
    for (const status of [false, 'detecting', true] as const) {
      test(`${action.service}: public action bypasses SSH with status ${status} (${Object.keys(overrides)[0]})`, async t => {
        const { ctx, host, calls } = fixture(overrides, status);
        t.mock.method(SshTunnelManager, 'openBrowser', (url: string) => calls.urls.push(url));
        t.mock.method(SshTunnelManager, 'copyToClipboard', (text: string) => calls.copied.push(text));
        t.mock.method(EndpointResolver, 'probeEndpoint', async () => { throw new Error('Unexpected network probe'); });
        await ActionDispatcher.triggerMenuAction(action.key, host);
        assert.deepEqual(calls.urls, [action.resolve(ctx.config).url]);
        assert.equal(calls.primary + calls.secondary, 0);
        assert.equal(ctx.status[action.service], status);
      });
    }
  }
}

for (const action of actions) {
  test(`${action.service}: forwarding preserves local URL, credentials and tunnel selection`, async t => {
    const { ctx, host, calls } = fixture({ domainedUrlsEnabled: false, openclawToken: 'fixture token', omniroutePassword: 'fixture password' }, true);
    t.mock.method(SshTunnelManager, 'openBrowser', (url: string) => calls.urls.push(url));
    t.mock.method(SshTunnelManager, 'copyToClipboard', (text: string) => calls.copied.push(text));
    await ActionDispatcher.triggerMenuAction(action.key, host);
    const expected = action.key === '1' ? 'http://127.0.0.1:18789/?token=fixture%20token#token=fixture%20token'
      : action.key === '2' ? 'http://127.0.0.1:20128/dashboard' : 'http://127.0.0.1:8080';
    assert.deepEqual(calls.urls, [expected]);
    assert.equal(calls.primary, action.key === '3' ? 0 : 1);
    assert.equal(calls.secondary, action.key === '3' ? 1 : 0);
    assert.deepEqual(calls.copied, [action.key === '1' ? 'fixture token' : action.key === '2' ? 'fixture password' : expected]);
  });
  for (const status of [false, 'detecting'] as const) {
    test(`${action.service}: forwarding still blocks status ${status}`, async t => {
      const { host, calls } = fixture({ domainedUrlsEnabled: false }, status);
      t.mock.method(SshTunnelManager, 'openBrowser', () => assert.fail('Unexpected browser'));
      await ActionDispatcher.triggerMenuAction(action.key, host);
      assert.equal(calls.primary + calls.secondary, 0);
      assert.equal(calls.messages.length, 1);
    });
  }
}

test('public mode preserves management SSH', async t => {
  const { ctx, host } = fixture({ domainedUrlsEnabled: true, publicBaseDomain: 'https://access.example.test' });
  let launches = 0;
  t.mock.method(SshTerminalLauncher, 'launchPrimary', (config: ControlPanelConfig) => {
    assert.equal(config, ctx.config); launches++; return true;
  });
  await ActionDispatcher.triggerMenuAction('7', host);
  assert.equal(launches, 1);
});

for (const method of ['startAllTunnels', 'ensureTunnelsRunning'] as const) {
  test(`${method}: public URLs do not start background forwarding`, async () => {
    const { ctx, calls } = fixture({ domainedUrlsEnabled: true, publicBaseDomain: 'https://access.example.test' });
    await ctx.tunnelMgr[method]();
    assert.equal(calls.primary + calls.secondary, 0);
  });
  test(`${method}: forwarding still starts both tunnels`, async () => {
    const { ctx, calls } = fixture({ domainedUrlsEnabled: false });
    await ctx.tunnelMgr[method]();
    assert.equal(calls.primary, 1);
    assert.equal(calls.secondary, 1);
  });
}
