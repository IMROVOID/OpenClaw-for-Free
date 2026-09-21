import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RailwaySafetyGuard } from '../src/control-panel/core/railwaySafetyGuard.js';

describe('RailwaySafetyGuard', () => {
  beforeEach(() => {
    RailwaySafetyGuard.reset();
  });

  describe('isAbuseOrRestrictionError', () => {
    it('detects payment method requirement', () => {
      assert.equal(
        RailwaySafetyGuard.isAbuseOrRestrictionError('Payment method required: This workspace cannot create new resources'),
        true
      );
    });

    it('detects rate limits and too many requests', () => {
      assert.equal(RailwaySafetyGuard.isAbuseOrRestrictionError('Rate limit exceeded. 429 Too Many Requests'), true);
    });

    it('does not treat routine unauthorized as abuse restriction', () => {
      assert.equal(RailwaySafetyGuard.isAbuseOrRestrictionError('Unauthorized. Please check that your token is valid'), false);
      assert.equal(RailwaySafetyGuard.isAbuseOrRestrictionError('Not Authorized'), false);
      assert.equal(RailwaySafetyGuard.isAbuseOrRestrictionError('Account suspended'), true);
    });

    it('returns false for ordinary operational errors', () => {
      assert.equal(RailwaySafetyGuard.isAbuseOrRestrictionError('Domain not found'), false);
      assert.equal(RailwaySafetyGuard.isAbuseOrRestrictionError('Connection timed out'), false);
    });
  });

  describe('Circuit Breaker & Cooldown', () => {
    it('trips circuit breaker on restriction error and blocks subsequent requests', () => {
      const apiKey = 'test-token-123';
      assert.equal(RailwaySafetyGuard.isRestricted(apiKey).restricted, false);

      RailwaySafetyGuard.recordError(apiKey, 'Payment method required: restricted');

      const status = RailwaySafetyGuard.isRestricted(apiKey);
      assert.equal(status.restricted, true);
      assert.ok(status.reason?.includes('Payment method required'));
    });

    it('clears circuit breaker on recordSuccess', () => {
      const apiKey = 'test-token-456';
      RailwaySafetyGuard.recordError(apiKey, 'Rate limit exceeded');
      assert.equal(RailwaySafetyGuard.isRestricted(apiKey).restricted, true);

      RailwaySafetyGuard.recordSuccess(apiKey);
      assert.equal(RailwaySafetyGuard.isRestricted(apiKey).restricted, false);
    });
  });

  describe('throttle', () => {
    it('spaces requests by at least minimum interval', async () => {
      const start = Date.now();
      await RailwaySafetyGuard.throttle();
      await RailwaySafetyGuard.throttle();
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 280, `Expected elapsed >= 280ms, got ${elapsed}ms`);
    });
  });
});
