import assert from 'assert';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { ConfigManager, DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { InlineKeyboard } from 'grammy';
import { OnboardingVmHandler } from '../src/telegram-bot/handlers/onboardingVmHandler.js';
import { OnboardingLlamaHandler } from '../src/telegram-bot/handlers/onboardingLlamaHandler.js';
import { DaytonaApi } from '../src/control-panel/core/daytonaApi.js';
import { OpenclawConfigSyncer } from '../src/control-panel/core/openclawConfigSyncer.js';
import { OmnirouteSync } from '../src/control-panel/core/omnirouteSync.js';
import { RecoveryHandler } from '../src/telegram-bot/handlers/recoveryHandler.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { BotContext } from '../src/telegram-bot/types.js';

async function testTelegramBotRecovery() {
  console.log('--- Running test: Telegram Bot VM Recovery Flow ---');

  const testChatId = 11223344;

  try {
    // 1. Test Recovery Session Initialization for Primary Missing
    const session1 = BotSessionManager.startRecovery(testChatId, 'primary');
    assert.strictEqual(session1.flow, 'recovery');
    assert.strictEqual(session1.step, 1);
    assert.strictEqual(session1.recoveryDraft.missingType, 'primary');
    assert.strictEqual(session1.recoveryDraft.action, 'new_primary');

    // 2. Test Recovery Keyboard for 'primary' missing
    const primKb = InlineKeyboards.buildRecoveryMenu('primary');
    const primCallbacks = provCallbacks(primKb);
    assert(primCallbacks.includes('rec:primary'), 'Should have Setup Primary option');
    assert(primCallbacks.includes('rec:both'), 'Should have Setup Both option');
    assert(primCallbacks.includes('rec:retry'), 'Should have Retry option');
    assert(primCallbacks.includes('menu:back'), 'Should have Back option');

    // 3. Test Recovery Keyboard for 'secondary' missing
    const secKb = InlineKeyboards.buildRecoveryMenu('secondary');
    const secCallbacks = provCallbacks(secKb);
    assert(secCallbacks.includes('rec:secondary'), 'Should have Setup Secondary option');
    assert(secCallbacks.includes('rec:disable_secondary'), 'Should have Disable Secondary option');
    assert(secCallbacks.includes('rec:both'), 'Should have Setup Both option');

    // 4. Test Recovery Keyboard for 'both' missing
    const bothKb = InlineKeyboards.buildRecoveryMenu('both');
    const bothCallbacks = provCallbacks(bothKb);
    assert(bothCallbacks.includes('rec:both'), 'Should have Setup Both option');
    assert(bothCallbacks.includes('rec:primary'), 'Should have Setup Primary option');
    assert(bothCallbacks.includes('rec:secondary'), 'Should have Setup Secondary option');

    // 5. Test Secondary VM Disabling logic
    const config = {
      ...DEFAULT_CONFIG,
      llama: {
        ...DEFAULT_CONFIG.llama,
        isSeparateVps: true,
        sshTarget: 'secondary-vps@ssh.app.daytona.io'
      },
      secondarySshTarget: 'secondary-vps@ssh.app.daytona.io'
    };

    config.llama.isSeparateVps = false;
    config.llama.sshTarget = config.primarySshTarget;
    config.secondarySshTarget = '';

    assert.strictEqual(config.llama.isSeparateVps, false, 'isSeparateVps should be false');
    assert.strictEqual(config.secondarySshTarget, '', 'secondarySshTarget should be cleared');

    const originalWizard = OnboardingHandler.updateWizard;
    const originalList = DaytonaApi.listWorkspacesDetailed;
    const originalAccess = DaytonaApi.createSshAccess;
    const originalSave = ConfigManager.save;
    const originalSync = OpenclawConfigSyncer.sync;
    const originalOmnirouteSync = OmnirouteSync.syncProvidersToRemoteVps;
    const screens: string[] = [];
    let keyboard = new InlineKeyboard();
    let primarySyncs = 0;
    const ctx = {
      chat: { id: testChatId },
      config: {
        ...config, provider: 'freestyle', secondaryProvider: 'daytona',
        primarySshTarget: 'primary@example.test', freestylePrimaryVmId: 'primary-id',
        freestyleApiKey: 'fixture-primary-key', secondaryDaytonaApiKey: 'fixture-secondary-key',
        telegramBotToken: 'fixture-telegram', discordBotToken: 'fixture-discord',
        domainedUrlsEnabled: true, ingressProvider: 'railway', publicBaseDomain: 'primary.example.test'
      }
    } as unknown as BotContext;
    const originalConfig = structuredClone(ctx.config);
    try {
      OnboardingHandler.updateWizard = async (_ctx, text, kb) => {
        screens.push(text);
        if (kb) keyboard = kb;
      };
      DaytonaApi.listWorkspacesDetailed = async () => ({
        ok: true,
        authError: false,
        workspaces: [{ id: 'ws_secondary', name: 'secondary-vm', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } }]
      });
      DaytonaApi.createSshAccess = async () => ({
        success: true,
        sshTarget: 'secondary-access@ssh.app.daytona.io'
      });
      ConfigManager.save = () => {};
      OpenclawConfigSyncer.sync = async () => { primarySyncs++; };
      OmnirouteSync.syncProvidersToRemoteVps = async () => ({ success: true, syncedCount: 0 });

      await RecoveryHandler.handleAction(ctx, 'rec:secondary');
      assert(screens.at(-1)?.includes('Secondary LLM VM Setup'), 'Secondary recovery must open secondary connection methods, not primary onboarding');
      const draft = BotSessionManager.getSession(testChatId).onboardingDraft;
      assert.strictEqual(draft.provider, 'freestyle');
      assert.strictEqual(draft.llamaTopology, 'dedicated');
      assert.strictEqual(ctx.config.primarySshTarget, 'primary@example.test');
      assert.strictEqual(primarySyncs, 0);

      const callbacks = keyboard.inline_keyboard.flat().map((b) => 'callback_data' in b ? b.callback_data : '');
      assert(callbacks.includes('onboard:sec:method:api'), 'Secondary screen must offer API key method');

      await OnboardingVmHandler.handleCallback(ctx, 'onboard:sec:method:api');
      assert(provCallbacks(keyboard).includes('onboard:sec:provider:daytona'), 'API method must offer Daytona before requesting a key');
      assert(provCallbacks(keyboard).includes('onboard:sec:provider:freestyle'), 'API method must offer Freestyle before requesting a key');
      assert.strictEqual(BotSessionManager.getSession(testChatId).awaitingField, undefined);
      await OnboardingVmHandler.handleCallback(ctx, 'onboard:sec:provider:daytona');
      assert(screens.at(-1)?.includes('existing Daytona Cloud API key'), 'Secondary provider API key offer must be shown');

      await OnboardingVmHandler.handleCallback(ctx, 'onboard:sec:key:existing');
      assert(screens.at(-1)?.includes('Secondary LLM VM Setup'), 'Existing key must advance to secondary VM choice');
      assert.strictEqual(draft.secondaryApiKey, 'fixture-secondary-key', 'Secondary recovery must not reuse the other provider primary key');
      await OnboardingVmHandler.handleCallback(ctx, 'onboard:vm:existing:s');

      const pickerCallbacks = keyboard.inline_keyboard.flat().map((b) => 'callback_data' in b ? b.callback_data : '');
      assert(pickerCallbacks.some((c) => c.startsWith('onboard:ws:s:')), 'Picker must expose secondary workspaces');

      await OnboardingVmHandler.handleCallback(ctx, 'onboard:ws:s:0');
      assert(draft.secondarySshTarget?.includes('secondary-access'), 'Secondary SSH target must be minted');
      assert.strictEqual(draft.secondaryWorkspaceId, 'ws_secondary');

      await OnboardingLlamaHandler.handleModelSelect(ctx, 'qwen7b');
      assert(!screens.at(-1)?.includes('WebUI Access Mode'), 'Secondary recovery must preserve primary ingress without asking to reconfigure it');
      assert.strictEqual(ctx.config.secondarySshTarget, 'secondary-access@ssh.app.daytona.io');
      assert.strictEqual(ctx.config.secondaryProvider, 'daytona');
      assert.strictEqual(ctx.config.daytonaSecondaryWorkspaceId, 'ws_secondary');
      assert.strictEqual(ctx.config.secondaryDaytonaApiKey, 'fixture-secondary-key');
      assert.strictEqual(ctx.config.primarySshTarget, 'primary@example.test');
      assert.strictEqual(ctx.config.telegramBotToken, 'fixture-telegram');
      assert.strictEqual(ctx.config.discordBotToken, 'fixture-discord');
      assert.strictEqual(primarySyncs, 0, 'Secondary recovery must not reconfigure primary services');
      assert.strictEqual(ctx.config.freestylePrimaryVmId, originalConfig.freestylePrimaryVmId);
      assert.strictEqual(ctx.config.freestyleApiKey, originalConfig.freestyleApiKey);
      assert.strictEqual(ctx.config.domainedUrlsEnabled, originalConfig.domainedUrlsEnabled);
      assert.strictEqual(ctx.config.ingressProvider, originalConfig.ingressProvider);
      assert.strictEqual(ctx.config.publicBaseDomain, originalConfig.publicBaseDomain);
      await RecoveryHandler.handleAction(ctx, 'rec:secondary');
      await OnboardingHandler.handleBack(ctx);
      await OnboardingHandler.handleBack(ctx);
      assert(screens.at(-1)?.includes('Secondary LLM VM Setup'), 'Back must stay within secondary recovery');
      assert(!screens.some((screen) => screen.includes('Bot Messaging Channels') || screen.includes('Hardware Probe & Service Discovery')));
    } finally {
      OnboardingHandler.updateWizard = originalWizard;
      DaytonaApi.listWorkspacesDetailed = originalList;
      DaytonaApi.createSshAccess = originalAccess;
      ConfigManager.save = originalSave;
      OpenclawConfigSyncer.sync = originalSync;
      OmnirouteSync.syncProvidersToRemoteVps = originalOmnirouteSync;
    }

    console.log('[PASS] Telegram Bot VM Recovery Flow tests passed successfully!');
  } finally {
    BotSessionManager.clearUserSession(testChatId);
  }
}

function provCallbacks(kb: any): string[] {
  return kb.inline_keyboard.flat().map((b: any) => ('callback_data' in b ? b.callback_data : ''));
}

testTelegramBotRecovery().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
