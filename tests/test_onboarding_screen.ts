import assert from 'assert';
import readline from 'readline';
import { OnboardingScreen } from '../src/control-panel/core/onboardingScreen.js';
import { stripAnsi } from '../src/control-panel/tui/ansi.js';

console.log('--- Running test: OnboardingScreen ---');

import { PassThrough } from 'stream';

// 1. Basic instantiating & attach/detach test
const mockInput = new PassThrough();
const mockOutput = new PassThrough();
const rl = readline.createInterface({ input: mockInput, output: mockOutput });

const screen = new OnboardingScreen(rl);

// Test step tracking
assert.strictEqual(screen.getStep(), 1, 'Initial step should be 1');
screen.setStep(2);
assert.strictEqual(screen.getStep(), 2, 'Step should update to 2');

// 2. Dimmed rendering test
const testLine = '\x1b[36m[Step 1/7] Select Cloud VPS Provider:\x1b[0m';
const formatted = OnboardingScreen.formatDimmedLine(testLine);
assert.ok(formatted.includes('\x1b[2m\x1b[90m'), 'Formatted line should contain dim gray escape sequence');
assert.ok(formatted.includes('[Step 1/7] Select Cloud VPS Provider:'), 'Content should be preserved');
assert.ok(!formatted.includes('\x1b[36m'), 'Bright ANSI cyan should be stripped in dim representation');

// 3. Interception and anti-duplication test
screen.attach();

console.log('Line 1');
console.log('Line 2');
screen.commitSection();

const sec1 = (screen as any).sections.find((s: any) => s.step === 2);
assert.ok(sec1, 'Section for step 2 should exist');
assert.strictEqual(sec1.lines.length, 2, 'Should capture exactly 2 lines (no duplicate lines)');
assert.strictEqual(sec1.lines[0], 'Line 1');
assert.strictEqual(sec1.lines[1], 'Line 2');

// Verify rollback
screen.rollbackStep(1);
assert.strictEqual(screen.getStep(), 1, 'Rollback should set step to 1');
assert.strictEqual((screen as any).sections.length, 0, 'Sections at or above step 1 should be cleared');

// Detach cleanly
screen.detach();
rl.close();

console.log('[PASS] OnboardingScreen tests completed successfully!\n');
