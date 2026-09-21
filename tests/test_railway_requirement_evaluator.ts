import assert from 'assert';
import {
  RailwayRequirementEvaluator,
  RailwayEvaluationContext
} from '../src/control-panel/core/railwayRequirementEvaluator.js';

console.log('--- Running test: RailwayRequirementEvaluator ---');

// Test 1: Daytona with Basic OpenClaw + OmniRoute (Port Forwarding)
// Should require Railway Egress Relay for OmniRoute providers and outbound integrity
{
  const ctx: RailwayEvaluationContext = {
    provider: 'daytona',
    hasDiscordOrNonTelegramMessenger: false,
    llamaTopology: 'cloud_only',
    domainedUrlsRequested: false
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, true, 'Daytona basic setup should require Railway');
  assert.strictEqual(res.status, 'required');
  assert.strictEqual(res.egressRelayNeeded, true, 'Egress relay should be needed for Daytona');
  assert.strictEqual(res.llamaRelayNeeded, false);
  assert.strictEqual(res.webRelayNeeded, false);
  assert.ok(res.reasons.some((r) => r.includes('OmniRoute') || r.includes('Daytona Cloud requires')));
  console.log('[PASS] Test 1: Daytona Basic OpenClaw + OmniRoute requires Railway Egress');
}

// Test 2: Daytona with Discord channel
{
  const ctx: RailwayEvaluationContext = {
    provider: 'daytona',
    hasDiscordOrNonTelegramMessenger: true,
    llamaTopology: 'cloud_only',
    domainedUrlsRequested: false
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, true);
  assert.strictEqual(res.status, 'required');
  assert.strictEqual(res.egressRelayNeeded, true);
  assert.ok(res.reasons.some((r) => r.includes('Discord') || r.includes('messenger')));
  console.log('[PASS] Test 2: Daytona with Discord explicitly flags egress requirement');
}

// Test 3: Daytona with Dedicated Secondary VM
{
  const ctx: RailwayEvaluationContext = {
    provider: 'daytona',
    hasDiscordOrNonTelegramMessenger: false,
    llamaTopology: 'dedicated',
    secondaryProvider: 'daytona',
    domainedUrlsRequested: false
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, true);
  assert.strictEqual(res.status, 'required');
  assert.strictEqual(res.egressRelayNeeded, true);
  assert.strictEqual(res.llamaRelayNeeded, true, 'Dedicated Llama VM on Daytona requires Llama SSE relay');
  console.log('[PASS] Test 3: Daytona with Dedicated Secondary VM requires Llama relay');
}

// Test 4: Daytona with Domained URLs requested
{
  const ctx: RailwayEvaluationContext = {
    provider: 'daytona',
    hasDiscordOrNonTelegramMessenger: false,
    llamaTopology: 'cloud_only',
    domainedUrlsRequested: true,
    domainedUrlProvider: 'railway'
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, true);
  assert.strictEqual(res.status, 'required');
  assert.strictEqual(res.egressRelayNeeded, true);
  assert.strictEqual(res.webRelayNeeded, true, 'Domained URLs on Daytona requires Web Ingress relay');
  console.log('[PASS] Test 4: Daytona with Domained URLs requires Web Ingress relay');
}

// Test 5: FreeStyle with standard Port Forwarding (no Railway needed)
{
  const ctx: RailwayEvaluationContext = {
    provider: 'freestyle',
    hasDiscordOrNonTelegramMessenger: true, // Direct egress works for Discord!
    llamaTopology: 'dedicated',
    secondaryProvider: 'freestyle',
    domainedUrlsRequested: false
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, false, 'FreeStyle with port forwarding does not need Railway');
  assert.strictEqual(res.status, 'not_needed');
  assert.strictEqual(res.egressRelayNeeded, false);
  assert.strictEqual(res.llamaRelayNeeded, false);
  assert.strictEqual(res.webRelayNeeded, false);
  console.log('[PASS] Test 5: FreeStyle with Port Forwarding does not need Railway');
}

// Test 6: FreeStyle with Domained URLs using FreeStyle Native Domain (<slug>.style.dev)
{
  const ctx: RailwayEvaluationContext = {
    provider: 'freestyle',
    hasDiscordOrNonTelegramMessenger: false,
    llamaTopology: 'same_vm',
    domainedUrlsRequested: true,
    domainedUrlProvider: 'freestyle'
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, false, 'FreeStyle with native domain does not need Railway');
  assert.strictEqual(res.status, 'not_needed');
  assert.strictEqual(res.webRelayNeeded, false);
  console.log('[PASS] Test 6: FreeStyle with Native Domain does not need Railway');
}

// Test 7: FreeStyle with Domained URLs explicitly choosing Railway
{
  const ctx: RailwayEvaluationContext = {
    provider: 'freestyle',
    hasDiscordOrNonTelegramMessenger: false,
    llamaTopology: 'cloud_only',
    domainedUrlsRequested: true,
    domainedUrlProvider: 'railway'
  };

  const res = RailwayRequirementEvaluator.evaluate(ctx);
  assert.strictEqual(res.needed, true, 'FreeStyle opting into Railway should report needed');
  assert.strictEqual(res.status, 'optional', 'Status should be optional on FreeStyle');
  assert.strictEqual(res.webRelayNeeded, true);
  console.log('[PASS] Test 7: FreeStyle opting into Railway reports optional & web relay needed');
}

console.log('[PASS] All RailwayRequirementEvaluator tests passed successfully!\n');
