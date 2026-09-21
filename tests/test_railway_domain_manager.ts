import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RailwayDomainManager } from '../src/control-panel/core/railwayDomainManager.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';

describe('RailwayDomainManager', () => {
  describe('normalizeDomain', () => {
    it('normalizes single subdomain to up.railway.app domain', () => {
      assert.equal(RailwayDomainManager.normalizeDomain('web-relay'), 'web-relay.up.railway.app');
      assert.equal(RailwayDomainManager.normalizeDomain('openclaw-relay'), 'openclaw-relay.up.railway.app');
    });

    it('preserves existing up.railway.app domains', () => {
      assert.equal(
        RailwayDomainManager.normalizeDomain('web-relay.up.railway.app'),
        'web-relay.up.railway.app'
      );
      assert.equal(
        RailwayDomainManager.normalizeDomain('https://web-relay.up.railway.app/'),
        'web-relay.up.railway.app'
      );
    });

    it('preserves custom domains', () => {
      assert.equal(RailwayDomainManager.normalizeDomain('mybot.example.com'), 'mybot.example.com');
      assert.equal(RailwayDomainManager.normalizeDomain('https://sub.domain.org/'), 'sub.domain.org');
    });

    it('rejects invalid domain strings', () => {
      assert.equal(RailwayDomainManager.normalizeDomain(''), undefined);
      assert.equal(RailwayDomainManager.normalizeDomain('   '), undefined);
      assert.equal(RailwayDomainManager.normalizeDomain('invalid domain name with spaces'), undefined);
      assert.equal(RailwayDomainManager.normalizeDomain('bad_label!'), undefined);
    });
  });

  describe('extractSubdomain', () => {
    it('extracts base subdomain correctly', () => {
      assert.equal(RailwayDomainManager.extractSubdomain('web-relay'), 'web-relay');
      assert.equal(RailwayDomainManager.extractSubdomain('web-relay.up.railway.app'), 'web-relay');
      assert.equal(RailwayDomainManager.extractSubdomain('https://my-app.up.railway.app/'), 'my-app');
      assert.equal(RailwayDomainManager.extractSubdomain('custom.domain.com'), 'custom');
    });
  });

  describe('checkDomainAvailability', () => {
    it('returns available: true and isUserOwned: true if domain belongs to user account', async () => {
      const origList = RailwayClient.listExistingRelays;
      try {
        RailwayClient.listExistingRelays = async () => [
          {
            projectId: 'p1',
            projectName: 'my-project',
            serviceId: 's1',
            serviceName: 'web-relay',
            domain: 'web-relay.up.railway.app',
            fullUrl: 'https://web-relay.up.railway.app',
            isLlama: false
          }
        ];

        const res = await RailwayDomainManager.checkDomainAvailability('fake-key', 'web-relay');
        assert.equal(res.available, true);
        assert.equal(res.isUserOwned, true);
        assert.equal(res.domain, 'web-relay.up.railway.app');
      } finally {
        RailwayClient.listExistingRelays = origList;
      }
    });

    it('queries Railway GraphQL if domain is not in user account and returns available: true', async () => {
      const origList = RailwayClient.listExistingRelays;
      const origGql = RailwayClient.executeGraphQL;
      try {
        RailwayClient.listExistingRelays = async () => [];
        RailwayClient.executeGraphQL = (async () => ({
          data: {
            serviceDomainAvailable: {
              available: true,
              message: 'Domain is available'
            }
          }
        })) as unknown as typeof RailwayClient.executeGraphQL;

        const res = await RailwayDomainManager.checkDomainAvailability('fake-key', 'free-relay');
        assert.equal(res.available, true);
        assert.equal(res.isUserOwned, false);
        assert.equal(res.domain, 'free-relay.up.railway.app');
      } finally {
        RailwayClient.listExistingRelays = origList;
        RailwayClient.executeGraphQL = origGql;
      }
    });

    it('returns available: false when Railway GraphQL reports domain taken', async () => {
      const origList = RailwayClient.listExistingRelays;
      const origGql = RailwayClient.executeGraphQL;
      try {
        RailwayClient.listExistingRelays = async () => [];
        RailwayClient.executeGraphQL = (async () => ({
          data: {
            serviceDomainAvailable: {
              available: false,
              message: 'Domain is already in use'
            }
          }
        })) as unknown as typeof RailwayClient.executeGraphQL;

        const res = await RailwayDomainManager.checkDomainAvailability('fake-key', 'occupied-relay');
        assert.equal(res.available, false);
        assert.equal(res.isUserOwned, false);
        assert.equal(res.domain, 'occupied-relay.up.railway.app');
      } finally {
        RailwayClient.listExistingRelays = origList;
        RailwayClient.executeGraphQL = origGql;
      }
    });
  });

  describe('getAvailableRecommendations', () => {
    it('returns free recommended domains when base domain is occupied', async () => {
      const origGql = RailwayClient.executeGraphQL;
      try {
        // Mock GraphQL: return available true for candidates containing '-bot' or '-app'
        RailwayClient.executeGraphQL = (async (_k: string, _q: string, vars?: Record<string, unknown>) => {
          const dom = String(vars?.domain || '');
          const isFree = dom.includes('-bot') || dom.includes('-app') || dom.includes('-live');
          return {
            data: {
              serviceDomainAvailable: {
                available: isFree,
                message: isFree ? 'Available' : 'Occupied'
              }
            }
          };
        }) as unknown as typeof RailwayClient.executeGraphQL;

        const recs = await RailwayDomainManager.getAvailableRecommendations('fake-key', 'web-relay', 3);
        assert.equal(recs.length, 3);
        for (const r of recs) {
          assert.ok(r.startsWith('web-relay-'));
          assert.ok(r.endsWith('.up.railway.app'));
        }
      } finally {
        RailwayClient.executeGraphQL = origGql;
      }
    });
  });

  describe('ensureServiceDomain', () => {
    it('updates existing service domain to desired domain name', async () => {
      const origGql = RailwayClient.executeGraphQL;
      const calls: string[] = [];
      try {
        RailwayClient.executeGraphQL = (async (_k: string, query: string) => {
          if (query.includes('domains(')) {
            calls.push('domains');
            return {
              data: {
                domains: {
                  serviceDomains: [{ id: 'sd-1', domain: 'old-name.up.railway.app' }],
                  customDomains: []
                }
              }
            };
          }
          if (query.includes('serviceDomainUpdate')) {
            calls.push('serviceDomainUpdate');
            return {
              data: {
                serviceDomainUpdate: true
              }
            };
          }
          return {};
        }) as unknown as typeof RailwayClient.executeGraphQL;

        const res = await RailwayDomainManager.ensureServiceDomain(
          'fake-key',
          'proj-1',
          'env-1',
          'svc-1',
          'desired-relay.up.railway.app'
        );
        assert.equal(res.success, true);
        assert.equal(res.domain, 'desired-relay.up.railway.app');
        assert.ok(calls.includes('domains'));
        assert.ok(calls.includes('serviceDomainUpdate'));
      } finally {
        RailwayClient.executeGraphQL = origGql;
      }
    });

    it('creates and updates service domain if none exists', async () => {
      const origGql = RailwayClient.executeGraphQL;
      const calls: string[] = [];
      try {
        let domainCreated = false;
        RailwayClient.executeGraphQL = (async (_k: string, query: string) => {
          if (query.includes('domains(')) {
            calls.push('domains');
            return {
              data: {
                domains: {
                  serviceDomains: domainCreated
                    ? [{ id: 'sd-new', domain: 'desired-relay.up.railway.app' }]
                    : [],
                  customDomains: []
                }
              }
            };
          }
          if (query.includes('serviceDomainCreate')) {
            calls.push('serviceDomainCreate');
            domainCreated = true;
            return {
              data: {
                serviceDomainCreate: {
                  id: 'sd-new',
                  domain: 'generated.up.railway.app'
                }
              }
            };
          }
          if (query.includes('serviceDomainUpdate')) {
            calls.push('serviceDomainUpdate');
            return {
              data: {
                serviceDomainUpdate: true
              }
            };
          }
          return {};
        }) as unknown as typeof RailwayClient.executeGraphQL;

        const res = await RailwayDomainManager.ensureServiceDomain(
          'fake-key',
          'proj-1',
          'env-1',
          'svc-1',
          'desired-relay.up.railway.app'
        );
        assert.equal(res.success, true);
        assert.equal(res.domain, 'desired-relay.up.railway.app');
        assert.ok(calls.includes('serviceDomainCreate'));
        assert.ok(calls.includes('serviceDomainUpdate'));
      } finally {
        RailwayClient.executeGraphQL = origGql;
      }
    });
  });
});
