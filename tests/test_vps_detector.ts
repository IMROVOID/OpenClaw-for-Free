import assert from 'assert';
import { VpsDetector } from '../src/control-panel/core/vpsDetector.js';
import { InstallationState } from '../src/control-panel/core/types.js';

function testVpsDetector() {
  console.log('--- Running test: VpsDetector ---');

  // 1. Test All Installed (Skip to TUI)
  const stateAll: InstallationState = {
    primaryReachable: true,
    primaryOpenclaw: true,
    primaryOmniroute: true,
    secondaryLlama: false, // llama is optional
    isFullyConfigured: true,
    isPartiallyConfigured: false,
    missingServices: []
  };
  assert.strictEqual(VpsDetector.determineAction(stateAll), 'skip_to_tui', 'Should skip onboarding when OpenClaw & OmniRoute are installed');

  // 2. Test Partial Installation (Guided Repair)
  const statePartial: InstallationState = {
    primaryReachable: true,
    primaryOpenclaw: true,
    primaryOmniroute: false,
    secondaryLlama: false,
    isFullyConfigured: false,
    isPartiallyConfigured: true,
    missingServices: ['OmniRoute Gateway']
  };
  assert.strictEqual(VpsDetector.determineAction(statePartial), 'guided_repair', 'Should trigger guided repair when only one service is installed');

  // 3. Test Clean Slate / None Installed (Full Onboarding)
  const stateNone: InstallationState = {
    primaryReachable: true,
    primaryOpenclaw: false,
    primaryOmniroute: false,
    secondaryLlama: false,
    isFullyConfigured: false,
    isPartiallyConfigured: false,
    missingServices: ['OpenClaw CLI & Runtime', 'OmniRoute Gateway']
  };
  assert.strictEqual(VpsDetector.determineAction(stateNone), 'full_onboarding', 'Should trigger full onboarding when clean VPS is detected');

  // 4. Test Fully Configured with Railway Relay
  const stateWithRelay: InstallationState = {
    primaryReachable: true,
    primaryOpenclaw: true,
    primaryOmniroute: true,
    primaryRailwayRelay: true,
    secondaryLlama: true,
    isFullyConfigured: true,
    isPartiallyConfigured: false,
    missingServices: []
  };
  assert.strictEqual(VpsDetector.determineAction(stateWithRelay), 'skip_to_tui', 'Should skip onboarding when OpenClaw, OmniRoute, and Railway Relay are active');

  console.log('[PASS] VpsDetector decision tests completed successfully!\n');
}

try {
  testVpsDetector();
} catch (e) {
  console.error('[FAIL] test_vps_detector:', e);
  process.exit(1);
}
