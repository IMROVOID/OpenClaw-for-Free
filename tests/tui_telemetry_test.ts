import assert from 'assert';
import { extractMouseEvents } from '../src/control-panel/tui/mouse.js';
import { HardwareTelemetry } from '../src/control-panel/core/hardwareTelemetry.js';
import { LogsView } from '../src/control-panel/tui/logsView.js';
import { SshSelectView } from '../src/control-panel/tui/sshSelectView.js';

console.log('Running TUI, Mouse, and Telemetry verification tests...');

// 1. Mouse & Single Number Key Preservation Test
const num1 = extractMouseEvents('1');
assert.strictEqual(num1.remainingText, '1', 'Key 1 must NOT be dropped by mouse packet sanitizer');

const num2 = extractMouseEvents('2');
assert.strictEqual(num2.remainingText, '2', 'Key 2 must NOT be dropped');

const num3 = extractMouseEvents('3');
assert.strictEqual(num3.remainingText, '3', 'Key 3 must NOT be dropped');

// Left click event (button 0)
const leftClick = extractMouseEvents('\x1b[<0;25;10M');
assert.strictEqual(leftClick.events.length, 1);
assert.strictEqual(leftClick.events[0].button, 0);
assert.strictEqual(leftClick.events[0].col, 25);
assert.strictEqual(leftClick.events[0].row, 10);
assert.strictEqual(leftClick.remainingText, '');

// Right click event (button 2)
const rightClick = extractMouseEvents('\x1b[<2;30;12M');
assert.strictEqual(rightClick.events.length, 1);
assert.strictEqual(rightClick.events[0].button, 2);
assert.strictEqual(rightClick.remainingText, '');

// 2. Hardware Telemetry & Square Bar Test
const samplePrimaryOutput = `llama-tunnel RUNNING pid 40304
omniroute RUNNING pid 8613
---SYSTEMD---
MainPID=43560
ActiveState=active
---HARDWARE---
0.34 0.19 0.26 1/196 58579
Mem: 7941 1669 445 1 6125 6271
/dev/root 31950 9645 20652 32% /
4`;

const parsedPrim = HardwareTelemetry.parseHardware(samplePrimaryOutput, 'primary', 'Primary VPS');
assert.ok(parsedPrim, 'Primary hardware must parse successfully');
assert.strictEqual(parsedPrim.cores, 4);
assert.strictEqual(parsedPrim.ramTotalMb, 7941);
assert.strictEqual(parsedPrim.ramUsedMb, 1669);
assert.strictEqual(parsedPrim.ramPercent, 21);
assert.strictEqual(parsedPrim.diskTotalMb, 31950);
assert.strictEqual(parsedPrim.diskUsedMb, 9645);
assert.strictEqual(parsedPrim.diskPercent, 32);

const bar21 = HardwareTelemetry.renderBar(parsedPrim.ramPercent, 10);
assert.ok(bar21.includes('■'), 'Bar must contain filled square shape');
assert.ok(bar21.includes('□'), 'Bar must contain empty square shape');
assert.ok(bar21.includes('21%'), 'Bar must display percentage');

// 3. Logs Tab Hitbox Generation Test
const logsRender = LogsView.render('openclaw', 'target', ['line1'], 90, 'freestyle');
assert.ok(logsRender.hitboxes.length >= 3, 'Must generate hitboxes for all freestyle log tabs');
assert.strictEqual(logsRender.hitboxes[0].id, 'openclaw');
assert.strictEqual(logsRender.hitboxes[1].id, 'omniroute');
assert.strictEqual(logsRender.hitboxes[2].id, 'llama');

// 4. SSH Selection View Test
const sshRender = SshSelectView.render({
  primarySshTarget: 'openclaw-primary:xyz',
  secondarySshTarget: 'openclaw-llama:abc',
  provider: 'freestyle',
  llama: { enabled: true, isSeparateVps: true }
} as any, 90);
assert.strictEqual(sshRender.hitboxes.length, 2, 'Must generate 2 hitboxes for dual VMs');
assert.strictEqual(sshRender.hitboxes[0].targetType, 'primary');
assert.strictEqual(sshRender.hitboxes[1].targetType, 'secondary');

console.log('✅ ALL TUI AND TELEMETRY VERIFICATION TESTS PASSED!');
