import assert from 'assert';
import { EndpointResolver } from '../src/control-panel/core/endpointResolver.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';

console.log('--- Running test: EndpointResolver & Dual-Provider LLM URLs ---');

async function runTests() {
  // 1. Test slug extraction
  assert.strictEqual(
    EndpointResolver.extractSlug('openclaw-llama:4prCb539xYpuQcFn.FxPMezeLiJ1s8UeV@beta-ssh.freestyle.sh'),
    'openclaw-llama',
    'Should extract clean slug from Freestyle SSH target'
  );
  assert.strictEqual(
    EndpointResolver.extractSlug('custom-llama-node'),
    'custom-llama-node',
    'Should handle bare slug string'
  );
  assert.strictEqual(
    EndpointResolver.extractSlug('daytona-box-123@ssh.app.daytona.io'),
    'daytona-box-123',
    'Should extract ID from Daytona SSH target'
  );
  assert.strictEqual(
    EndpointResolver.extractSlug(''),
    'openclaw-llama',
    'Empty target should fallback to default slug'
  );

  // 2. Test URL normalization
  assert.strictEqual(
    EndpointResolver.normalizeV1Url('openclaw-llama.style.dev'),
    'https://openclaw-llama.style.dev/v1'
  );
  assert.strictEqual(
    EndpointResolver.normalizeV1Url('https://openclaw-llama.style.dev/'),
    'https://openclaw-llama.style.dev/v1'
  );
  assert.strictEqual(
    EndpointResolver.normalizeV1Url('https://openclaw-llama.style.dev/v1'),
    'https://openclaw-llama.style.dev/v1'
  );
  assert.strictEqual(
    EndpointResolver.normalizeV1Url('http://127.0.0.1:8080'),
    'http://127.0.0.1:8080/v1'
  );

  // 3. Test resolveBaseUrl for same-VM co-located topology
  const sameVmConfig: ControlPanelConfig = {
    ...DEFAULT_CONFIG,
    llama: {
      ...DEFAULT_CONFIG.llama,
      enabled: true,
      isSeparateVps: false
    }
  };
  assert.strictEqual(
    EndpointResolver.resolveBaseUrl(sameVmConfig),
    'http://127.0.0.1:8080/v1',
    'Same VM should route to localhost:8080/v1'
  );

  // 4. Test resolveBaseUrl for Freestyle.sh native domain
  const freestyleConfig: ControlPanelConfig = {
    ...DEFAULT_CONFIG,
    provider: 'freestyle',
    secondaryProvider: 'freestyle',
    secondarySshTarget: 'openclaw-llama:token123@beta-ssh.freestyle.sh',
    llama: {
      ...DEFAULT_CONFIG.llama,
      enabled: true,
      isSeparateVps: true,
      sshTarget: 'openclaw-llama:token123@beta-ssh.freestyle.sh'
    }
  };
  assert.strictEqual(
    EndpointResolver.resolveBaseUrl(freestyleConfig),
    'https://openclaw-llama.style.dev/v1',
    'Freestyle should default to https://<slug>.style.dev/v1'
  );

  // 5. Test resolveBaseUrl for Freestyle with custom domain override
  const freestyleCustomConfig: ControlPanelConfig = {
    ...freestyleConfig,
    llama: {
      ...freestyleConfig.llama,
      freestyleDomainUrl: 'https://custom-ai.style.dev'
    }
  };
  assert.strictEqual(
    EndpointResolver.resolveBaseUrl(freestyleCustomConfig),
    'https://custom-ai.style.dev/v1',
    'Freestyle should honor custom domain override'
  );

  // 6. Test resolveBaseUrl for Daytona with Railway Relay
  const daytonaConfig: ControlPanelConfig = {
    ...DEFAULT_CONFIG,
    provider: 'daytona',
    secondaryProvider: 'daytona',
    llama: {
      ...DEFAULT_CONFIG.llama,
      enabled: true,
      isSeparateVps: true,
      railwayEndpointUrl: 'https://my-relay.up.railway.app'
    }
  };
  assert.strictEqual(
    EndpointResolver.resolveBaseUrl(daytonaConfig),
    'https://my-relay.up.railway.app/v1',
    'Daytona should route via Railway relay endpoint'
  );

  // 7. Test resolveBaseUrl when llama is disabled
  const disabledConfig: ControlPanelConfig = {
    ...DEFAULT_CONFIG,
    llama: {
      ...DEFAULT_CONFIG.llama,
      enabled: false
    }
  };
  assert.strictEqual(
    EndpointResolver.resolveBaseUrl(disabledConfig),
    '',
    'Disabled llama should return empty string'
  );

  // 8. Test RailwayHelper normalization and guidance
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('my-relay'),
    'https://my-relay.up.railway.app',
    'Bare subdomain should expand to .up.railway.app'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('https://my-relay.up.railway.app'),
    'https://my-relay.up.railway.app',
    'Full URL should be preserved'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('my-relay.up.railway.app'),
    'https://my-relay.up.railway.app',
    'Domain without protocol should get https://'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('https://my-relay'),
    'https://my-relay.up.railway.app',
    'Protocol with bare subdomain should expand to .up.railway.app'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('https://<your-llama-relay>.up.railway.app'),
    '',
    'Dummy placeholder should normalize to empty'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl(''),
    '',
    'Empty input should return empty string'
  );
  assert.ok(
    RailwayHelper.getApiKeyGuidance().length >= 4,
    'Guidance instructions must be present'
  );

  console.log('[PASS] EndpointResolver & RailwayHelper tests completed successfully!\n');
}

runTests().catch((err) => {
  console.error('[FAIL] EndpointResolver test failed:', err);
  process.exit(1);
});
