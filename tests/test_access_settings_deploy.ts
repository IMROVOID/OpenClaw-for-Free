import assert from 'node:assert/strict';
import { configureAccess } from '../src/control-panel/core/accessSettingsController.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { WebIngressDeployer, RailwayWebRelayDeployOptions } from '../src/control-panel/core/webIngressDeployer.js';
import { OnboardingIngressStep } from '../src/control-panel/core/onboardingIngressStep.js';

console.log('--- Running test: configureAccess Railway Web Relay Redeploy ---');

async function testConfigureAccessRedeploy() {
  let deployedOpts: RailwayWebRelayDeployOptions | null = null;
  const origDeploy = WebIngressDeployer.deployRailwayWebRelay;
  WebIngressDeployer.deployRailwayWebRelay = async (opts) => {
    deployedOpts = opts;
    return { success: true, message: 'Deployed successfully' };
  };

  const origPrompt = OnboardingIngressStep.promptIngress;
  OnboardingIngressStep.promptIngress = async () => ({
    domainedUrlsEnabled: true,
    ingressProvider: 'railway',
    publicBaseDomain: 'openclaw-relay.up.railway.app',
    railwayApiKey: 'test-api-token-xyz'
  });

  try {
    const config: ControlPanelConfig = {
      provider: 'daytona',
      primarySshTarget: 'user@ssh.app.daytona.io',
      openclawPort: 18789,
      omniroutePort: 20128,
      llamaPort: 8080,
      openclawToken: 'test-token',
      omniroutePassword: 'CHANGEME',
      vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 10 },
      providers: {},
      llama: {
        enabled: false,
        isSeparateVps: false,
        modelUrl: '',
        modelName: '',
        quantization: '',
        contextSize: 8192,
        batchSize: 512,
        threads: 4,
        enableMtp: false,
        enableFlashAttn: false,
        isMoe: false,
        kvCacheQuant: 'q4_0'
      },
      daytonaPrimaryWorkspaceId: 'ws-daytona-123'
    };

    let savedConfig: ControlPanelConfig | undefined;
    const reports: string[] = [];

    await configureAccess(
      config,
      async () => '1',
      (c) => { savedConfig = c; },
      (msg) => { reports.push(msg); }
    );

    assert.ok(savedConfig, 'Config should be saved');
    const finalConfig: ControlPanelConfig = savedConfig!;
    assert.strictEqual(finalConfig.domainedUrlsEnabled, true);
    assert.strictEqual(finalConfig.publicBaseDomain, 'openclaw-relay.up.railway.app');
    assert.ok(deployedOpts, 'WebIngressDeployer.deployRailwayWebRelay should have been called');
    const finalOpts: RailwayWebRelayDeployOptions = deployedOpts!;
    assert.strictEqual(finalOpts.apiKey, 'test-api-token-xyz');
    assert.strictEqual(finalOpts.domain, 'openclaw-relay.up.railway.app');
    assert.strictEqual(finalOpts.primaryWorkspaceId, 'ws-daytona-123');
    assert.ok(reports.some((r) => r.includes('deployed/redeployed successfully')));

    console.log('[PASS] configureAccess successfully triggers deployRailwayWebRelay when Railway ingress is configured');
  } finally {
    WebIngressDeployer.deployRailwayWebRelay = origDeploy;
    OnboardingIngressStep.promptIngress = origPrompt;
  }
}

testConfigureAccessRedeploy().catch((err) => {
  console.error('✘ Test failed:', err);
  process.exit(1);
});
