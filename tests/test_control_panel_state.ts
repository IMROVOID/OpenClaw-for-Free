import assert from 'assert';
import { ConfigManager } from '../src/control-panel/core/configManager.js';
import { extractMouseEvents } from '../src/control-panel/tui/mouse.js';
import { MenuView } from '../src/control-panel/tui/menuView.js';
import { LogsView } from '../src/control-panel/tui/logsView.js';
import { ServiceManagerView } from '../src/control-panel/tui/serviceManagerView.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';

function testControlPanelState() {
  console.log('--- Running test: ControlPanelState ---');

  // 1. Test SSH Target parsing
  const parsed1 = ConfigManager.parseSshTarget('ssh test-sandbox-id@ssh.app.daytona.io', 'fallback');
  assert.strictEqual(parsed1, 'test-sandbox-id@ssh.app.daytona.io');

  const parsed2 = ConfigManager.parseSshTarget('mytoken123', 'fallback');
  assert.strictEqual(parsed2, 'mytoken123@ssh.app.daytona.io');

  // 2. Test SGR Extended Mouse parser
  const mouseSeq = '\x1b[<0;25;10M';
  const { events, remainingText } = extractMouseEvents(mouseSeq);
  assert.strictEqual(events.length, 1, 'Should extract 1 mouse event');
  assert.strictEqual(events[0].button, 0, 'Should be button 0 (left click)');
  assert.strictEqual(events[0].col, 25, 'Should match col 25');
  assert.strictEqual(events[0].row, 10, 'Should match row 10');
  assert.strictEqual(events[0].type, 'press', 'Should be press event');
  assert.strictEqual(remainingText, '', 'Should strip mouse sequence from text');

  // 3. Test MenuView rendering and Hitboxes
  const menuRes = MenuView.render(DEFAULT_CONFIG, {
    openclaw: true,
    omniroute: false,
    llama: false,
    egressRelay: true,
    primarySsh: true
  }, 0, 90, 1);

  assert(menuRes.lines.length > 5, 'MenuView should render lines');
  assert(menuRes.hitboxes.length >= 8, 'MenuView should register hitboxes for actions');
  assert(menuRes.hitboxes.some((h) => h.key === '1'), 'Should have hitbox for OpenClaw');
  assert(menuRes.hitboxes.some((h) => h.key === '2'), 'Should have hitbox for OmniRoute');
  assert(menuRes.hitboxes.some((h) => h.key === '4'), 'Should have hitbox for Service Manager');
  assert(menuRes.hitboxes.some((h) => h.key === '6'), 'Should have hitbox for Logs');
  assert(menuRes.hitboxes.some((h) => h.key === '7'), 'Should have hitbox for Remote Terminal');

  const fullText = menuRes.lines.join('\n');
  assert(!fullText.includes('▶'), 'MenuView should not contain arrow cursor ▶');

  // Verify that hitbox rows exactly match the lines containing their respective key badges
  for (const h of menuRes.hitboxes) {
    const line = menuRes.lines[h.row - 1];
    assert(line && line.includes(`[${h.key}]`), `Hitbox row ${h.row} must match rendered line for key [${h.key}]`);
  }

  // Verify section padding rows exist
  assert(menuRes.lines[1].includes('│') && menuRes.lines[1].replace(/\x1b\[[0-9;]*m/g, '').replace(/[^a-zA-Z0-9]/g, '') === '', 'Line 2 should be an empty padding row after header');

  // 3b. Test Detecting status state and 2-column table alignment
  const detectingMenu = MenuView.render({ ...DEFAULT_CONFIG, provider: 'daytona' }, {
    openclaw: 'detecting',
    omniroute: 'detecting',
    llama: 'detecting',
    egressRelay: 'detecting',
    primarySsh: 'detecting'
  }, 0, 90, 1);

  const detectingText = detectingMenu.lines.join('\n');
  assert(detectingText.includes('[DETECTING...]'), 'MenuView should render [DETECTING...] badges');

  const statusRow1 = detectingMenu.lines.find((l) => l.includes('OpenClaw') && l.includes('OmniRoute'));
  const statusRow2 = detectingMenu.lines.find((l) => l.includes('Railway Relay'));
  assert(statusRow1, 'Should find status row 1 with OpenClaw & OmniRoute');
  assert(statusRow2, 'Should find status row 2 with Railway Relay');

  // Strip ANSI to verify column 2 starts at the same horizontal position in both rows
  const cleanRow1 = statusRow1.replace(/\x1b\[[0-9;]*m/g, '');
  const cleanRow2 = statusRow2.replace(/\x1b\[[0-9;]*m/g, '');
  const col2Idx1 = cleanRow1.indexOf('OmniRoute');
  const col2Idx2 = cleanRow2.indexOf('Railway Relay');
  assert.strictEqual(col2Idx1, col2Idx2, 'Column 2 in both rows must start at the exact same horizontal position');

  // 4. Test LogsView rendering
  const renderedLogs = LogsView.render('openclaw', 'test@ssh.app.daytona.io', ['[INFO] Gateway started on port 18789'], 90);
  assert(renderedLogs.lines.length > 5, 'LogsView should render log frame');
  assert(renderedLogs.lines.some((l) => l.includes('Gateway started')), 'LogsView should display log content');

  // 5. Test ServiceManagerView rendering
  const smLines = ServiceManagerView.render(DEFAULT_CONFIG, [], 0, 90);
  assert(smLines.length > 5, 'ServiceManagerView should render service list');
  assert(smLines.some((l) => l.includes('Start Service')), 'ServiceManagerView should show Start Service');
  assert(smLines.some((l) => l.includes('Restart Service')), 'ServiceManagerView should show Restart Service');
  assert(smLines.some((l) => l.includes('Stop Service')), 'ServiceManagerView should show Stop Service');

  console.log('[PASS] ControlPanelState tests completed successfully!\n');
}

try {
  testControlPanelState();
} catch (e) {
  console.error('[FAIL] test_control_panel_state:', e);
  process.exit(1);
}

