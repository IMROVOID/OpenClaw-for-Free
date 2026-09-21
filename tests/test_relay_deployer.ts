import assert from 'assert';
import { RelayDeployer } from '../src/control-panel/core/relayDeployer.js';

async function runTests(): Promise<void> {
  console.log('--- Testing RelayDeployer ---');

  // 1. Verify getRelayScript loads the script
  const script = RelayDeployer.getRelayScript();
  assert.ok(script && script.length > 200, 'Relay script must be loaded from local files');
  assert.ok(script.includes('telegram'), 'Script must configure telegram');
  assert.ok(script.includes('discord'), 'Script must configure discord');
  assert.ok(script.includes('HTTP_PROXY'), 'Script must export HTTP_PROXY environment variables');
  assert.ok(script.includes('openclaw-start.sh'), 'Script must configure openclaw-start.sh');

  // 2. Test promptEgressRelay defaults
  const res = await RelayDeployer.promptEgressRelay(
    async (_q, def) => def || '',
    { railwayDomain: 'test-relay.up.railway.app', railwayUuid: '12345678-1234-1234-1234-123456789abc' }
  );
  assert.strictEqual(res.railwayDomain, 'test-relay.up.railway.app');
  assert.strictEqual(res.railwayUuid, '12345678-1234-1234-1234-123456789abc');

  // 3. Test promptEgressRelay cleaning URLs
  const resUrl = await RelayDeployer.promptEgressRelay(
    async () => 'https://custom-relay.up.railway.app/',
    {}
  );
  assert.strictEqual(resUrl.railwayDomain, 'custom-relay.up.railway.app');

  // 4. Test fallback when files do not exist on disk
  const fs = (await import('fs')).default;
  const origExists = fs.existsSync;
  try {
    (fs as any).existsSync = () => false;
    const fallbackScript = RelayDeployer.getRelayScript();
    assert.ok(fallbackScript && fallbackScript.length > 200, 'RelayDeployer must return embedded fallback script when file is missing');
    assert.ok(fallbackScript.includes('HTTP_PORT'), 'Fallback script must contain setup script logic');
  } finally {
    (fs as any).existsSync = origExists;
  }

  // 5. Test promptEgressRelay with apiKey discovering existing relays
  const origList = (await import('../src/control-panel/core/railwayClient.js')).RailwayClient.listExistingRelays;
  try {
    const { RailwayClient } = await import('../src/control-panel/core/railwayClient.js');
    RailwayClient.listExistingRelays = async () => [
      {
        projectId: 'p1',
        projectName: 'My-Egress',
        serviceId: 's1',
        serviceName: 'gateway-relay',
        domain: 'discovered-egress.up.railway.app',
        fullUrl: 'https://discovered-egress.up.railway.app',
        isLlama: false
      }
    ];

    const discoveredRes = await RelayDeployer.promptEgressRelay(
      async (q) => {
        if (q.includes('Select relay number')) return '1';
        return 'test-uuid-123';
      },
      {},
      'test-api-key'
    );
    assert.strictEqual(discoveredRes.railwayDomain, 'discovered-egress.up.railway.app');
    assert.strictEqual(discoveredRes.railwayUuid, 'test-uuid-123');
  } finally {
    const { RailwayClient } = await import('../src/control-panel/core/railwayClient.js');
    RailwayClient.listExistingRelays = origList;
  }

  console.log('[PASS] RelayDeployer tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[FAIL] RelayDeployer test failed:', err);
  process.exit(1);
});
