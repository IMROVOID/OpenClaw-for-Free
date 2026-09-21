import assert from 'node:assert';
import { RemoteProvisioner } from '../src/control-panel/core/remoteProvisioner.js';
import { ControlPanelConfig, DetectedVmConfig } from '../src/control-panel/core/types.js';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';
import { OnboardingSteps } from '../src/control-panel/core/onboardingSteps.js';
import { RelayDeployer } from '../src/control-panel/core/relayDeployer.js';
import { OmnirouteSync } from '../src/control-panel/core/omnirouteSync.js';
import { OpenclawConfigSyncer } from '../src/control-panel/core/openclawConfigSyncer.js';
import { PrimaryVault } from '../src/control-panel/core/primaryVault.js';

export async function testSharedProvisioner(): Promise<void> {
  console.log('--- Running test: RemoteProvisioner (Shared Workflows) ---');

  const origInspect = VpsConfigDetector.inspect;
  const origDetectSecondaryLlama = VpsConfigDetector.detectSecondaryLlama;
  const origRunRemoteProvisioning = OnboardingSteps.runRemoteProvisioning;
  const origDeployEgressRelay = RelayDeployer.deployEgressRelay;
  const origSync = OpenclawConfigSyncer.sync;
  const origRegisterLlama = OmnirouteSync.registerLlamaInOpenClaw;
  const origSyncProviders = OmnirouteSync.syncProvidersToRemoteVps;
  const origVaultPush = PrimaryVault.pushSnapshot;

  const mockDetected = (overrides: Partial<DetectedVmConfig> = {}): DetectedVmConfig => ({
    reachable: true,
    openclawInstalled: false,
    omnirouteInstalled: false,
    omnirouteActive: false,
    railwayRelayConfigured: false,
    llamaInstalled: false,
    llamaRunning: false,
    ...overrides
  });

  try {
    const calls: string[] = [];

    // Test 1: Fresh Daytona VM with Secondary LLaMA and Relay
    VpsConfigDetector.inspect = async (target: string) => {
      calls.push(`inspect:${target}`);
      return mockDetected({
        openclawInstalled: false,
        omnirouteInstalled: false,
        railwayRelayConfigured: false
      });
    };

    VpsConfigDetector.detectSecondaryLlama = async (target: string) => {
      calls.push(`detectSecondaryLlama:${target}`);
      return mockDetected({
        llamaInstalled: false,
        llamaRunning: false
      });
    };

    OnboardingSteps.runRemoteProvisioning = async (primary, secondary, provider, llamaEnabled, _modelSettings, _ingressDomain) => {
      calls.push(`runRemoteProvisioning:prim=${primary}:sec=${secondary}:prov=${provider}:llama=${llamaEnabled}`);
    };

    RelayDeployer.deployEgressRelay = async (target, domain, uuid) => {
      calls.push(`deployEgressRelay:${target}:${domain}:${uuid}`);
      return true;
    };

    OpenclawConfigSyncer.sync = async (target, _token, tg, dc, _guild) => {
      calls.push(`syncOpenClaw:${target}:tg=${tg}:dc=${dc}`);
    };

    OmnirouteSync.registerLlamaInOpenClaw = async (target, url, model) => {
      calls.push(`registerLlama:${target}:${url}:${model}`);
      return true;
    };

    OmnirouteSync.syncProvidersToRemoteVps = async (target, providers) => {
      calls.push(`syncProviders:${target}:${Object.keys(providers).length}`);
      return { success: true, syncedCount: Object.keys(providers).length };
    };

    PrimaryVault.pushSnapshot = async (target, _snapshot) => {
      calls.push(`vaultPush:${target}`);
      return { success: true };
    };

    const config: ControlPanelConfig = {
      openclawPort: 18789,
      omniroutePort: 20128,
      llamaPort: 8080,
      openclawToken: 'test-token-123',
      omniroutePassword: 'CHANGEME',
      provider: 'daytona',
      primarySshTarget: 'user@daytona-primary',
      secondarySshTarget: 'user@daytona-secondary',
      vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 10 },
      telegramBotToken: '12345:TEST_TG',
      discordBotToken: 'TEST_DC',
      railwayDomain: 'relay.up.railway.app',
      railwayUuid: 'test-uuid-1234',
      llama: {
        enabled: true,
        isSeparateVps: true,
        sshTarget: 'user@daytona-secondary',
        activeEndpointUrl: 'http://127.0.0.1:8080/v1',
        modelName: 'Qwen 2.5 7B MTP',
        modelUrl: 'https://huggingface.co/bartowski/model.gguf',
        quantization: 'q4_k_m',
        contextSize: 32768,
        batchSize: 512,
        threads: 4,
        enableMtp: true,
        enableFlashAttn: true,
        isMoe: false,
        kvCacheQuant: 'q4_0'
      },
      providers: {
        openrouter: {
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          enabled: true,
          apiKey: 'sk-or-test',
          validated: true
        }
      }
    };

    const progressStages: string[] = [];
    const res = await RemoteProvisioner.execute(config, {
      onProgress: (stage) => {
        progressStages.push(stage);
      }
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.warnings.length, 0);

    // Verify all steps were executed in order
    assert.ok(calls.some((c) => c.startsWith('inspect:user@daytona-primary')), 'Should inspect primary VM');
    assert.ok(calls.some((c) => c.startsWith('runRemoteProvisioning:prim=user@daytona-primary:sec=undefined:prov=daytona:llama=false')), 'Should bootstrap primary VM');
    assert.ok(calls.some((c) => c.startsWith('deployEgressRelay:user@daytona-primary:relay.up.railway.app:test-uuid-1234')), 'Should deploy egress relay');
    assert.ok(calls.some((c) => c.startsWith('detectSecondaryLlama:user@daytona-secondary')), 'Should detect secondary LLaMA');
    assert.ok(calls.some((c) => c.startsWith('runRemoteProvisioning:prim=:sec=user@daytona-secondary:prov=daytona:llama=true')), 'Should bootstrap secondary LLaMA');
    assert.ok(calls.some((c) => c.startsWith('syncOpenClaw:user@daytona-primary:tg=12345:TEST_TG:dc=TEST_DC')), 'Should sync OpenClaw');
    assert.ok(calls.some((c) => c.startsWith('registerLlama:user@daytona-primary')), 'Should register LLaMA in OpenClaw');
    assert.ok(calls.some((c) => c.startsWith('syncProviders:user@daytona-primary:1')), 'Should sync OmniRoute providers');

    // Verify progress callback received all stages
    assert.ok(progressStages.includes('inspect_primary'));
    assert.ok(progressStages.includes('bootstrap_primary'));
    assert.ok(progressStages.includes('deploy_relay'));
    assert.ok(progressStages.includes('inspect_secondary'));
    assert.ok(progressStages.includes('bootstrap_secondary_llama'));
    assert.ok(progressStages.includes('sync_openclaw'));
    assert.ok(progressStages.includes('register_llama'));
    assert.ok(progressStages.includes('sync_omniroute'));
    assert.ok(progressStages.includes('vault_sync'));
    assert.ok(calls.some((c) => c.startsWith('vaultPush:user@daytona-primary')), 'Should push vault snapshot to primary');
    assert.ok(progressStages.includes('complete'));

    console.log('[PASS] Test 1: RemoteProvisioner provisions fresh Daytona VM + Secondary LLaMA + Relay + Config');

    // Test 2: Existing OpenClaw installation preserves existing VM and skips bootstrap
    calls.length = 0;
    progressStages.length = 0;

    VpsConfigDetector.inspect = async () => mockDetected({
      openclawInstalled: true,
      omnirouteInstalled: true,
      railwayRelayConfigured: true
    });

    const resPreserve = await RemoteProvisioner.execute(config, {
      skipLlamaProvisioning: true,
      onProgress: (stage) => {
        progressStages.push(stage);
      }
    });

    assert.strictEqual(resPreserve.success, true);
    assert.strictEqual(calls.some((c) => c.includes('runRemoteProvisioning:prim=user@daytona-primary')), false, 'Should NOT bootstrap primary when already installed');
    assert.ok(progressStages.includes('preserve_primary'));
    console.log('[PASS] Test 2: RemoteProvisioner preserves existing installation');

  } finally {
    VpsConfigDetector.inspect = origInspect;
    VpsConfigDetector.detectSecondaryLlama = origDetectSecondaryLlama;
    OnboardingSteps.runRemoteProvisioning = origRunRemoteProvisioning;
    RelayDeployer.deployEgressRelay = origDeployEgressRelay;
    OpenclawConfigSyncer.sync = origSync;
    OmnirouteSync.registerLlamaInOpenClaw = origRegisterLlama;
    OmnirouteSync.syncProvidersToRemoteVps = origSyncProviders;
    PrimaryVault.pushSnapshot = origVaultPush;
  }

  console.log('--- All RemoteProvisioner tests passed! ---');
}

if (process.argv[1]?.endsWith('test_shared_provisioner.ts')) {
  testSharedProvisioner().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
