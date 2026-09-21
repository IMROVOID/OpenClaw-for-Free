import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { configureAccess } from '../src/control-panel/core/accessSettingsController.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { BackStepSignal } from '../src/control-panel/core/backSignal.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';

function config(): ControlPanelConfig {
  return { ...structuredClone(DEFAULT_CONFIG), primarySshTarget: 'fixture@host',
    publicBaseDomain: 'https://old.example.test', customOpenclawUrl: 'https://old-claw.example.test',
    customOmnirouteUrl: 'https://old-route.example.test', customLlamaUrl: 'https://old-llama.example.test' };
}

test('forwarding saves only access changes and clears stale public overrides', async t => {
  t.mock.method(console, 'log', () => {});
  const original = config();
  const snapshot = structuredClone(original);
  let saved: ControlPanelConfig | undefined;
  const messages: string[] = [];
  await configureAccess(original, async () => '2', next => { saved = next; }, msg => messages.push(msg));
  assert.deepEqual(original, snapshot);
  assert.deepEqual(saved, { ...snapshot, domainedUrlsEnabled: false, ingressProvider: 'none',
    publicBaseDomain: undefined, customOpenclawUrl: undefined, customOmnirouteUrl: undefined, customLlamaUrl: undefined });
  assert.ok(messages.some(msg => /not provisioned|no.*provision/i.test(msg)));
});

test('changing the base domain removes stale service URL overrides', async t => {
  t.mock.method(console, 'log', () => {});
  const validate = RailwayClient.validateApiKey;
  const listRelays = RailwayClient.listExistingRelays;
  RailwayClient.validateApiKey = async () => ({ valid: true, user: 'fixture' });
  RailwayClient.listExistingRelays = async () => [{
    projectId: 'project-fixture', projectName: 'fixture', serviceId: 'service-fixture', serviceName: 'web relay',
    domain: 'web-relay-production.up.railway.app', fullUrl: 'https://web-relay-production.up.railway.app', isLlama: false
  }];
  try {
  const original = { ...config(), provider: 'daytona' as const, railwayApiKey: 'fixture-token' };
  const answers = ['1', '', 'https://new.example.test'];
  let saved: ControlPanelConfig | undefined;
  await configureAccess(original, async () => answers.shift() ?? '0', next => { saved = next; }, () => {});
  assert.ok(saved);
  assert.equal(saved.customOpenclawUrl, undefined);
  assert.equal(saved.customOmnirouteUrl, undefined);
  assert.equal(saved.customLlamaUrl, undefined);
  assert.equal(saved.publicBaseDomain, 'new.example.test');
  } finally {
    RailwayClient.validateApiKey = validate;
    RailwayClient.listExistingRelays = listRelays;
  }
});

test('public selection uses existing prompt and preserves unrelated settings', async t => {
  t.mock.method(console, 'log', () => {});
  const original = config();
  const snapshot = structuredClone(original);
  const answers = ['1', '3', 'https://new.example.test'];
  let saved: ControlPanelConfig | undefined;
  const messages: string[] = [];
  await configureAccess(original, async () => answers.shift() ?? assert.fail('Unexpected prompt'), next => { saved = next; }, msg => messages.push(msg));
  assert.deepEqual(original, snapshot);
  assert.equal(saved?.publicBaseDomain, 'https://new.example.test');
  assert.equal(saved?.domainedUrlsEnabled, true);
  assert.deepEqual(saved?.llama, snapshot.llama);
  assert.equal(saved?.primarySshTarget, snapshot.primarySshTarget);
  assert.equal(saved?.customOpenclawUrl, undefined);
  assert.ok(messages.some(msg => /not provisioned|no.*provision/i.test(msg)));
});

test('Back cancels without saving or mutating config', async t => {
  t.mock.method(console, 'log', () => {});
  const original = config();
  const snapshot = structuredClone(original);
  await configureAccess(original, async () => { throw new BackStepSignal(); }, () => assert.fail('Unexpected save'), () => {});
  assert.deepEqual(original, snapshot);
});

test('prompt failure propagates without saving', async t => {
  t.mock.method(console, 'log', () => {});
  await assert.rejects(configureAccess(config(), async () => { throw new Error('fixture failure'); },
    () => assert.fail('Unexpected save'), () => {}), /fixture failure/);
});
