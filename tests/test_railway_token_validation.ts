import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { RailwaySafetyGuard } from '../src/control-panel/core/railwaySafetyGuard.js';

describe('Railway Token Validation & Sanitization', () => {
  beforeEach(() => {
    RailwaySafetyGuard.reset();
  });

  describe('sanitizeToken', () => {
    it('strips surrounding single and double quotes', () => {
      assert.equal(RailwayClient.sanitizeToken('"rlw_token_123"'), 'rlw_token_123');
      assert.equal(RailwayClient.sanitizeToken("'rlw_token_456'"), 'rlw_token_456');
    });

    it('strips Bearer prefix', () => {
      assert.equal(RailwayClient.sanitizeToken('Bearer rlw_token_789'), 'rlw_token_789');
      assert.equal(RailwayClient.sanitizeToken('bearer  rlw_token_abc'), 'rlw_token_abc');
    });

    it('strips variable assignment prefixes', () => {
      assert.equal(RailwayClient.sanitizeToken('RAILWAY_API_TOKEN=rlw_token_def'), 'rlw_token_def');
      assert.equal(RailwayClient.sanitizeToken('railway_token = rlw_token_ghi'), 'rlw_token_ghi');
    });

    it('handles clean tokens and whitespace', () => {
      assert.equal(RailwayClient.sanitizeToken('   rlw_clean_token   '), 'rlw_clean_token');
      assert.equal(RailwayClient.sanitizeToken(''), '');
    });
  });

  describe('validateApiKey multi-token support', () => {
    const origExecute = RailwayClient.executeGraphQL;

    afterEach(() => {
      RailwayClient.executeGraphQL = origExecute;
    });

    it('validates Account Token via me and projects queries', async () => {
      RailwayClient.executeGraphQL = (async (token: string, query: string) => {
        if (query.includes('projects')) {
          return { data: { projects: { edges: [{ node: { id: 'p1', name: 'My Project' } }] } } };
        }
        if (query.includes('me')) {
          return { data: { me: { id: 'u1', name: 'Alice', email: 'alice@example.com' } } };
        }
        return {};
      }) as typeof RailwayClient.executeGraphQL;

      const res = await RailwayClient.validateApiKey('acc-token');
      assert.equal(res.valid, true);
      assert.equal(res.tokenType, 'account');
      assert.equal(res.user, 'alice@example.com');
    });

    it('validates Workspace Token when me fails with Not Authorized', async () => {
      RailwayClient.executeGraphQL = (async (token: string, query: string) => {
        if (query.includes('projects')) {
          return { data: { projects: { edges: [{ node: { id: 'p1', name: 'Team Project' } }] } } };
        }
        if (query.includes('me')) {
          return { errors: [{ message: 'Not Authorized' }], statusCode: 200 };
        }
        return {};
      }) as typeof RailwayClient.executeGraphQL;

      const res = await RailwayClient.validateApiKey('workspace-token');
      assert.equal(res.valid, true);
      assert.equal(res.tokenType, 'workspace');
      assert.equal(res.user, 'Workspace (Project: Team Project)');
    });

    it('validates Workspace Token with 0 projects (empty edges)', async () => {
      RailwayClient.executeGraphQL = (async (token: string, query: string) => {
        if (query.includes('projects')) {
          return { data: { projects: { edges: [] } } };
        }
        if (query.includes('me')) {
          return { errors: [{ message: 'Not Authorized' }], statusCode: 200 };
        }
        return {};
      }) as typeof RailwayClient.executeGraphQL;

      const res = await RailwayClient.validateApiKey('empty-workspace-token');
      assert.equal(res.valid, true);
      assert.equal(res.tokenType, 'workspace');
      assert.equal(res.user, 'Workspace Token');
    });

    it('validates Project Token with Project-Access-Token header', async () => {
      RailwayClient.executeGraphQL = (async (token: string, query: string, _vars?: unknown, _timeout?: number, headers?: Record<string, string>) => {
        if (headers?.['Project-Access-Token']) {
          return { data: { projectToken: { projectId: 'proj-12345678-abcd', environmentId: 'env-1' } } };
        }
        // Bearer calls return Not Authorized
        return { errors: [{ message: 'Not Authorized' }], statusCode: 200 };
      }) as typeof RailwayClient.executeGraphQL;

      const res = await RailwayClient.validateApiKey('proj-token-xyz');
      assert.equal(res.valid, true);
      assert.equal(res.tokenType, 'project');
      assert.ok(res.user?.includes('Project Token'));
    });

    it('returns informative error when all token types fail auth', async () => {
      RailwayClient.executeGraphQL = (async () => {
        return { errors: [{ message: 'Not Authorized' }], statusCode: 200 };
      }) as typeof RailwayClient.executeGraphQL;

      const res = await RailwayClient.validateApiKey('invalid-token');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('Not Authorized'));
      assert.ok(res.error?.includes('account/tokens'));
    });
  });
});
