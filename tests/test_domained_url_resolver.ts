import assert from 'assert';
import { DomainedUrlResolver } from '../src/control-panel/core/domainedUrlResolver.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';

console.log('--- Running test: DomainedUrlResolver ---');

const baseMockConfig: ControlPanelConfig = {
  provider: 'daytona',
  primarySshTarget: 'user@ssh.app.daytona.io',
  openclawPort: 18789,
  omniroutePort: 20128,
  llamaPort: 8080,
  openclawToken: 'test-token-12345',
  omniroutePassword: 'admin-password',
  vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 10 },
  providers: {},
  llama: {
    enabled: true,
    isSeparateVps: false,
    modelUrl: 'https://huggingface.co/test/model.gguf',
    modelName: 'Qwen 2.5 7B',
    quantization: 'q4_k_m',
    contextSize: 32768,
    batchSize: 512,
    threads: 4,
    enableMtp: true,
    enableFlashAttn: true,
    isMoe: false,
    kvCacheQuant: 'q4_0'
  }
};

// Test 1: Standard Port Forwarding (domainedUrlsEnabled: false)
{
  const cfg: ControlPanelConfig = {
    ...baseMockConfig,
    domainedUrlsEnabled: false
  };

  const oc = DomainedUrlResolver.resolveOpenclawUrl(cfg);
  assert.strictEqual(oc.isDomained, false);
  assert.strictEqual(oc.url, 'http://127.0.0.1:18789/?token=test-token-12345#token=test-token-12345');
  assert.ok(oc.portForwardCmd.includes('18789:127.0.0.1:18789'));

  const or = DomainedUrlResolver.resolveOmnirouteUrl(cfg);
  assert.strictEqual(or.isDomained, false);
  assert.strictEqual(or.url, 'http://127.0.0.1:20128/dashboard');
  assert.ok(or.portForwardCmd.includes('20128:127.0.0.1:20128'));

  const lm = DomainedUrlResolver.resolveLlamaUrl(cfg);
  assert.strictEqual(lm.isDomained, false);
  assert.strictEqual(lm.url, 'http://127.0.0.1:8080');
  assert.ok(lm.portForwardCmd.includes('8080:127.0.0.1:8080'));

  console.log('[PASS] Test 1: Fallback to local port forwarding verified');
}

// Test 2: Domained URLs via Railway
{
  const cfg: ControlPanelConfig = {
    ...baseMockConfig,
    domainedUrlsEnabled: true,
    ingressProvider: 'railway',
    publicBaseDomain: 'openclaw-hub.up.railway.app'
  };

  const oc = DomainedUrlResolver.resolveOpenclawUrl(cfg);
  assert.strictEqual(oc.isDomained, true);
  assert.strictEqual(oc.url, 'https://openclaw-hub.up.railway.app/openclaw/?token=test-token-12345#token=test-token-12345');

  const or = DomainedUrlResolver.resolveOmnirouteUrl(cfg);
  assert.strictEqual(or.isDomained, true);
  assert.strictEqual(or.url, 'https://openclaw-hub.up.railway.app/omniroute/dashboard');

  const lm = DomainedUrlResolver.resolveLlamaUrl(cfg);
  assert.strictEqual(lm.isDomained, true);
  assert.strictEqual(lm.url, 'https://openclaw-hub.up.railway.app/llama');

  console.log('[PASS] Test 2: Railway Domained URLs resolved with paths & tokens');
}

// Test 3: Domained URLs via FreeStyle native domain (<slug>.style.dev)
{
  const cfg: ControlPanelConfig = {
    ...baseMockConfig,
    provider: 'freestyle',
    domainedUrlsEnabled: true,
    ingressProvider: 'freestyle',
    publicBaseDomain: 'my-project-primary.style.dev'
  };

  const oc = DomainedUrlResolver.resolveOpenclawUrl(cfg);
  assert.strictEqual(oc.isDomained, true);
  assert.strictEqual(oc.url, 'https://my-project-primary.style.dev/openclaw/?token=test-token-12345#token=test-token-12345');

  const or = DomainedUrlResolver.resolveOmnirouteUrl(cfg);
  assert.strictEqual(or.isDomained, true);
  assert.strictEqual(or.url, 'https://my-project-primary.style.dev/omniroute/dashboard');

  const lm = DomainedUrlResolver.resolveLlamaUrl(cfg);
  assert.strictEqual(lm.isDomained, true);
  assert.strictEqual(lm.url, 'https://my-project-primary.style.dev/llama');

  console.log('[PASS] Test 3: FreeStyle native domain URLs resolved with paths & tokens');
}

// Test 4: Custom specific URL overrides take precedence
{
  const cfg: ControlPanelConfig = {
    ...baseMockConfig,
    domainedUrlsEnabled: true,
    publicBaseDomain: 'my-project-primary.style.dev',
    customOpenclawUrl: 'https://claw.mycompany.com',
    customOmnirouteUrl: 'https://omni.mycompany.com',
    customLlamaUrl: 'https://llama.mycompany.com'
  };

  const oc = DomainedUrlResolver.resolveOpenclawUrl(cfg);
  assert.strictEqual(oc.url, 'https://claw.mycompany.com/?token=test-token-12345#token=test-token-12345');

  const or = DomainedUrlResolver.resolveOmnirouteUrl(cfg);
  assert.strictEqual(or.url, 'https://omni.mycompany.com/dashboard');

  const lm = DomainedUrlResolver.resolveLlamaUrl(cfg);
  assert.strictEqual(lm.url, 'https://llama.mycompany.com');

  console.log('[PASS] Test 4: Custom URL overrides take precedence');
}

console.log('[PASS] All DomainedUrlResolver tests passed successfully!\n');
