import assert from 'assert';
import { MenuHandler } from '../src/telegram-bot/handlers/menuHandler.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { ServiceStatus } from '../src/control-panel/core/types.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { RecoveryHandler } from '../src/telegram-bot/handlers/recoveryHandler.js';
import { BotContext } from '../src/telegram-bot/types.js';

function testTelegramBotMenu() {
  console.log('--- Running test: Telegram Bot Menu & Keyboards ---');

  // 1. Test status badge & bullet helpers
  assert.strictEqual(MenuHandler.getStatusBullet('detecting'), '🟡');
  assert.strictEqual(MenuHandler.getStatusBullet(true), '🟢');
  assert.strictEqual(MenuHandler.getStatusBullet(false), '🔴');
  assert.strictEqual(MenuHandler.getBadge('detecting'), 'DETECTING...');
  assert.strictEqual(MenuHandler.getBadge(true), 'ONLINE');
  assert.strictEqual(MenuHandler.getBadge(false), 'INACTIVE');
  assert.strictEqual(MenuHandler.getBadge(false, 'YES', 'NO'), 'NO');

  // 2. Test formatMenuText for Freestyle provider
  const freestyleStatus: ServiceStatus = {
    openclaw: true,
    omniroute: true,
    llama: false,
    egressRelay: true,
    primarySsh: true
  };
  const freestyleText = MenuHandler.formatMenuText(DEFAULT_CONFIG, freestyleStatus);
  assert(freestyleText.includes('OPENCLAW & FREESTYLE CONTROL PANEL'), 'Should have Freestyle title');
  assert(freestyleText.includes('🟢 Network Egress : DIRECT (32GB)'), 'Should show direct egress badge');
  assert(freestyleText.includes('🟢 OpenClaw (Port 18789) : ONLINE'), 'OpenClaw should be online');
  assert(freestyleText.includes('🟢 OmniRoute (Port 20128) : ONLINE'), 'OmniRoute should be online');

  // 3. Test formatMenuText for Daytona provider
  const daytonaConfig = {
    ...DEFAULT_CONFIG,
    provider: 'daytona' as const,
    primarySshTarget: 'sandbox-123@ssh.app.daytona.io'
  };
  const daytonaStatus: ServiceStatus = {
    openclaw: 'detecting',
    omniroute: false,
    llama: false,
    egressRelay: false,
    primarySsh: false
  };
  const daytonaText = MenuHandler.formatMenuText(daytonaConfig, daytonaStatus);
  assert(daytonaText.includes('OPENCLAW & DAYTONA CONTROL PANEL'), 'Should have Daytona title');
  assert(daytonaText.includes('🔴 Railway Egress Relay : OFFLINE'), 'Should show Railway relay offline');
  assert(daytonaText.includes('🔴 Primary SSH Reachability : UNREACHABLE'), 'Should show unreachable SSH');

  // 4. Test InlineKeyboards.buildMainMenu
  const kb = InlineKeyboards.buildMainMenu(DEFAULT_CONFIG, freestyleStatus);
  const buttons = kb.inline_keyboard.flat();
  const callbacks = buttons.map((b) => ('callback_data' in b ? b.callback_data : ''));

  assert(callbacks.includes('menu:openclaw'), 'Keyboard should include OpenClaw WebUI');
  assert(callbacks.includes('menu:omniroute'), 'Keyboard should include OmniRoute WebUI');
  assert(callbacks.includes('menu:services'), 'Keyboard should include Service Manager');
  assert(callbacks.includes('menu:diagnostics'), 'Keyboard should include Diagnostics');
  assert(callbacks.includes('menu:logs'), 'Keyboard should include Logs');
  assert(callbacks.includes('menu:terminal'), 'Keyboard should include Terminal');
  assert(callbacks.includes('menu:onboard'), 'Keyboard should include Setup Assistant');
  assert(callbacks.includes('menu:recovery'), 'Keyboard should include VM Recovery');
  assert(callbacks.includes('menu:refresh'), 'Keyboard should include Refresh');

  // 5. Test Llama button inclusion when enabled
  const llamaConfig = {
    ...DEFAULT_CONFIG,
    llama: {
      ...DEFAULT_CONFIG.llama,
      enabled: true
    }
  };
  const llamaKb = InlineKeyboards.buildMainMenu(llamaConfig, freestyleStatus);
  const llamaButtons = llamaKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
  assert(llamaButtons.includes('menu:llama'), 'Keyboard should include Llama WebUI when enabled');

  // 6. Test Service Manager keyboard
  const svcKb = InlineKeyboards.buildServiceManager();
  const svcCallbacks = svcKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
  assert(svcCallbacks.includes('svc:restart:openclaw'), 'Should contain restart OpenClaw');
  assert(svcCallbacks.includes('svc:restart:all'), 'Should contain restart all');
  assert(svcCallbacks.includes('menu:back'), 'Should contain back button');

  // 7. Test Diagnostics keyboard includes full verification
  const diagKb = InlineKeyboards.buildDiagnostics();
  const diagCallbacks = diagKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
  assert(diagCallbacks.includes('diag:verify'), 'Should contain Run Full Verification button');
  assert(diagCallbacks.includes('menu:diagnostics'), 'Should contain refresh telemetry');

  console.log('[PASS] Telegram Bot Menu & Keyboards tests passed successfully!');
}

async function testMenuRedirects() {
  console.log('--- Running test: Menu Redirects (Onboarding & Recovery) ---');

  // Test isConfigured helper
  assert.strictEqual(MenuHandler.isConfigured({ ...DEFAULT_CONFIG, primarySshTarget: '' }), false);
  assert.strictEqual(MenuHandler.isConfigured({ ...DEFAULT_CONFIG, primarySshTarget: 'Not Configured (Run Setup Assistant)' }), false);
  assert.strictEqual(MenuHandler.isConfigured({ ...DEFAULT_CONFIG, primarySshTarget: 'root@1.2.3.4' }), true);

  // 1. Unconfigured target redirects to OnboardingHandler
  let onboardingCalled = false;
  const origStartOnboarding = OnboardingHandler.startOnboarding;
  OnboardingHandler.startOnboarding = (async (_ctx: BotContext) => {
    onboardingCalled = true;
  }) as typeof OnboardingHandler.startOnboarding;

  try {
    const unconfiguredCtx = {
      config: { ...DEFAULT_CONFIG, primarySshTarget: '' },
      chat: { id: 12345 },
      from: { id: 12345 },
      reply: async () => ({ chat: { id: 12345 }, message_id: 1 })
    } as unknown as BotContext;

    await MenuHandler.sendMainMenu(unconfiguredCtx);
    assert.strictEqual(onboardingCalled, true, 'Unconfigured target should redirect to startOnboarding');
  } finally {
    OnboardingHandler.startOnboarding = origStartOnboarding;
  }

  // 2. Configured target but unreachable VM redirects to RecoveryHandler
  let recoveryCalled = false;
  const origStartRecovery = RecoveryHandler.startRecovery;
  RecoveryHandler.startRecovery = (async (_ctx: BotContext, _edit = false, _msgId?: number) => {
    recoveryCalled = true;
  }) as typeof RecoveryHandler.startRecovery;

  const origProbeStatus = MenuHandler.probeStatus;
  MenuHandler.probeStatus = async () => ({
    openclaw: false,
    omniroute: false,
    llama: false,
    egressRelay: false,
    primarySsh: false
  });

  try {
    const configuredCtx = {
      config: { ...DEFAULT_CONFIG, primarySshTarget: 'root@1.2.3.4' },
      chat: { id: 12345 },
      from: { id: 12345 },
      reply: async () => ({ chat: { id: 12345 }, message_id: 1 })
    } as unknown as BotContext;

    await MenuHandler.sendMainMenu(configuredCtx);
    assert.strictEqual(recoveryCalled, true, 'Unreachable VM target should redirect to startRecovery');
  } finally {
    RecoveryHandler.startRecovery = origStartRecovery;
    MenuHandler.probeStatus = origProbeStatus;
  }

  console.log('[PASS] Menu Redirects (Onboarding & Recovery) tests passed successfully!');
}

testControlPanelMenu: {
  testTelegramBotMenu();
  await testMenuRedirects();
}
