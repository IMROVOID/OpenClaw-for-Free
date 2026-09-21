import assert from 'node:assert/strict';
import { OnboardingIngressStep } from '../src/control-panel/core/onboardingIngressStep.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { BackStepSignal } from '../src/control-panel/core/backSignal.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';

const validate = RailwayClient.validateApiKey;
const listRelays = RailwayClient.listExistingRelays;
RailwayClient.validateApiKey = async () => ({ valid: true, user: 'fixture' });
RailwayClient.listExistingRelays = async () => [{
  projectId: 'project-fixture',
  projectName: 'fixture project',
  serviceId: 'service-fixture',
  serviceName: 'web relay',
  domain: 'web-relay-production.up.railway.app',
  fullUrl: 'https://web-relay-production.up.railway.app',
  isLlama: false
}];
try {
  const config = { provider: 'daytona' } as ControlPanelConfig;
  const prompts: Array<{ question: string; fallback?: string }> = [];
  const answers = ['1', 'fixture-token', '', 'https://relay.example.test'];
  const result = await OnboardingIngressStep.promptIngress(async (question, fallback) => {
    prompts.push({ question, fallback });
    return answers.shift() ?? '0';
  }, config);
  assert.equal(prompts[0].question, 'Select Ingress Mode (1-2, or 0 to go back)');
  assert.match(prompts[1].question, /Railway API token/);
  assert.equal(prompts[2].fallback, 'web-relay-production.up.railway.app', 'Connected Railway domain must be the domain default');
  assert.equal(result.publicBaseDomain, 'relay.example.test');
  assert.equal(config.railwayApiKey, 'fixture-token', 'Connected Railway token must persist');
  assert.equal(answers.length, 0, 'Empty domain must reprompt');

  for (const invalid of ['https://', 'http://relay.example.test', 'relay.example.test/path', 'relay.example.test:1234', 'relay.example.test?token=x']) {
    const fixture = { provider: 'daytona', railwayApiKey: 'fixture-token' } as ControlPanelConfig;
    const input = ['1', '', invalid, '0'];
    await assert.rejects(OnboardingIngressStep.promptIngress(async () => input.shift() ?? '0', fixture), BackStepSignal);
  }
  await assert.rejects(RailwayHelper.promptWebRelayApiKey(async () => '', ''), /Railway API token is required/);
  console.log('[PASS] Railway token is required first; connected domain is the dynamic default with an example');
} finally {
  RailwayClient.validateApiKey = validate;
  RailwayClient.listExistingRelays = listRelays;
}
