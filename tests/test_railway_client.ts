import assert from 'assert';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';

async function runTests(): Promise<void> {
  console.log('--- Testing RailwayClient & RailwayHelper ---');

  // 1. Validate empty token
  const emptyRes = await RailwayClient.validateApiKey('');
  assert.strictEqual(emptyRes.valid, false, 'Empty key should be invalid');

  // 2. Test listExistingRelays with empty key
  const emptyList = await RailwayClient.listExistingRelays('');
  assert.deepStrictEqual(emptyList, [], 'Empty key should yield empty relay list');

  // 3. Test RailwayHelper.normalizeRelayUrl
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('test-service'),
    'https://test-service.up.railway.app'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('https://test-service.up.railway.app'),
    'https://test-service.up.railway.app'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('test-service.up.railway.app'),
    'https://test-service.up.railway.app'
  );
  assert.strictEqual(
    RailwayHelper.normalizeRelayUrl('https://<your-llama-relay>.up.railway.app'),
    ''
  );

  // 4. Test API guidance
  const guidance = RailwayHelper.getApiKeyGuidance();
  assert.ok(Array.isArray(guidance) && guidance.length >= 4, 'Guidance should provide steps');

  // 4b. Egress relays must never be suggested as the WebUI default
  const relayFixtures = [
    { projectId: 'p1', projectName: 'egress-relay', serviceId: 's1', serviceName: 'egress-relay', domain: 'egress-relay-production.up.railway.app', fullUrl: 'https://egress-relay-production.up.railway.app', isLlama: false },
    { projectId: 'p2', projectName: 'web-relay', serviceId: 's2', serviceName: 'web-relay', domain: 'web-relay-production.up.railway.app', fullUrl: 'https://web-relay-production.up.railway.app', isLlama: false }
  ];
  assert.strictEqual(
    RailwayHelper.findWebRelay(relayFixtures)?.domain,
    'web-relay-production.up.railway.app',
    'Web Relay must be preferred over Egress Relay'
  );
  const egressOnly = [relayFixtures[0]];
  assert.strictEqual(
    RailwayHelper.findWebRelay(egressOnly),
    undefined,
    'Egress-only accounts must not suggest a WebUI default'
  );
  const egressCheck = await RailwayHelper.checkRelayDomain('https://egress-relay-production.up.railway.app', 10);
  assert.strictEqual(egressCheck.reachable, false, 'Egress relay must not validate as a WebUI domain');

  // 5. Test Token Validation & Relay Listing (Mocked GraphQL)
  const origExec = RailwayClient.executeGraphQL;
  try {
    RailwayClient.executeGraphQL = async (_key: string, query: string): Promise<any> => {
      if (query.includes('query { me { id name email } }')) {
        return { data: { me: { id: 'u1', name: 'Test User', email: 'test@example.com' } }, statusCode: 200 };
      }
      if (query.includes('projects {')) {
        return {
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'p1',
                    name: 'test-project',
                    environments: {
                      edges: [
                        {
                          node: {
                            id: 'env1',
                            name: 'production',
                            serviceInstances: {
                              edges: [
                                {
                                  node: {
                                    serviceId: 's1',
                                    domains: {
                                      customDomains: [],
                                      serviceDomains: [{ domain: 'llama-relay.up.railway.app' }]
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      ]
                    },
                    services: {
                      edges: [
                        { node: { id: 's1', name: 'llama-relay' } }
                      ]
                    }
                  }
                }
              ]
            }
          },
          statusCode: 200
        };
      }
      if (query.includes('domains(')) {
        return {
          data: {
            domains: {
              serviceDomains: [{ domain: 'llama-relay.up.railway.app' }],
              customDomains: []
            }
          },
          statusCode: 200
        };
      }
      return { data: {}, statusCode: 200 };
    };

    const liveVal = await RailwayClient.validateApiKey('mock-valid-key');
    assert.strictEqual(liveVal.valid, true, 'Valid workspace token should be verified');

    const relays = await RailwayClient.listExistingRelays('mock-valid-key');
    assert.ok(Array.isArray(relays), 'Relays should return an array');
    assert.ok(relays.length > 0, 'Should find at least 1 relay in test account');
    const llamaRelay = relays.find(r => r.isLlama);
    assert.ok(llamaRelay, 'Should identify the llama-relay service');
  } finally {
    RailwayClient.executeGraphQL = origExec;
  }

  console.log('[PASS] RailwayClient & RailwayHelper tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[FAIL] RailwayClient test failed:', err);
  process.exit(1);
});
