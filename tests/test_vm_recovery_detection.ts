import assert from 'assert';
import { VpsDetector } from '../src/control-panel/core/vpsDetector.js';
import { InstallationState, ControlPanelConfig } from '../src/control-panel/core/types.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';

console.log('--- Running test: VM Recovery Detection & Actions ---');

// Test 1: determineAction returns 'vm_recovery' when recoveryNeeded is true
const stateBothMissing: InstallationState = {
  primaryReachable: false,
  secondaryReachable: false,
  primaryOpenclaw: false,
  primaryOmniroute: false,
  secondaryLlama: false,
  isFullyConfigured: false,
  isPartiallyConfigured: false,
  recoveryNeeded: true,
  missingVmType: 'both',
  missingServices: ['Primary VPS unreachable / deleted', 'Secondary Llama VPS unreachable / deleted']
};
assert.strictEqual(VpsDetector.determineAction(stateBothMissing), 'vm_recovery', 'Should return vm_recovery when both VMs missing');

// Test 2: determineAction returns 'vm_recovery' when only primary missing
const statePrimaryMissing: InstallationState = {
  primaryReachable: false,
  secondaryReachable: true,
  primaryOpenclaw: false,
  primaryOmniroute: false,
  secondaryLlama: true,
  isFullyConfigured: false,
  isPartiallyConfigured: false,
  recoveryNeeded: true,
  missingVmType: 'primary',
  missingServices: ['Primary VPS unreachable / deleted']
};
assert.strictEqual(VpsDetector.determineAction(statePrimaryMissing), 'vm_recovery', 'Should return vm_recovery when primary VM missing');

// Test 3: determineAction returns 'vm_recovery' when only secondary missing
const stateSecondaryMissing: InstallationState = {
  primaryReachable: true,
  secondaryReachable: false,
  primaryOpenclaw: true,
  primaryOmniroute: true,
  secondaryLlama: false,
  isFullyConfigured: false,
  isPartiallyConfigured: false,
  recoveryNeeded: true,
  missingVmType: 'secondary',
  missingServices: ['Secondary Llama VPS unreachable / deleted']
};
assert.strictEqual(VpsDetector.determineAction(stateSecondaryMissing), 'vm_recovery', 'Should return vm_recovery when secondary VM missing');

// Test 4: determineAction returns 'skip_to_tui' when fully healthy
const stateHealthy: InstallationState = {
  primaryReachable: true,
  secondaryReachable: true,
  primaryOpenclaw: true,
  primaryOmniroute: true,
  secondaryLlama: true,
  isFullyConfigured: true,
  isPartiallyConfigured: false,
  recoveryNeeded: false,
  missingVmType: 'none',
  missingServices: []
};
assert.strictEqual(VpsDetector.determineAction(stateHealthy), 'skip_to_tui', 'Should return skip_to_tui when fully configured');

// Test 5: determineAction returns 'guided_repair' when reachable but partial services
const statePartial: InstallationState = {
  primaryReachable: true,
  secondaryReachable: true,
  primaryOpenclaw: true,
  primaryOmniroute: false,
  secondaryLlama: false,
  isFullyConfigured: false,
  isPartiallyConfigured: true,
  recoveryNeeded: false,
  missingVmType: 'none',
  missingServices: ['OmniRoute Gateway']
};
assert.strictEqual(VpsDetector.determineAction(statePartial), 'guided_repair', 'Should return guided_repair when partial services installed');

console.log('[PASS] All VM Recovery Detection & Action tests completed successfully!');
