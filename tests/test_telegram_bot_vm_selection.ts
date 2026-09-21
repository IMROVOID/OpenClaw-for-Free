import assert from 'assert';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { OnboardingVmHandler } from '../src/telegram-bot/handlers/onboardingVmHandler.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { DaytonaApi } from '../src/control-panel/core/daytonaApi.js';
import { FreestyleApi } from '../src/control-panel/core/freestyleApi.js';
import { BotContext } from '../src/telegram-bot/types.js';

type KbButton = { callback_data?: string; text?: string };

function flatCallbacks(kb: any): string[] {
  return (kb?.inline_keyboard ?? []).flat().map((b: KbButton) => b.callback_data || '');
}

async function testTelegramVmSelection() {
  console.log('--- Running test: Telegram Bot VM Selection & Picker ---');
  const testChatId = 42424242;

  const origFstValidate = FreestyleApi.validateApiKey;
  const origFstList = FreestyleApi.listVms;
  const origFstToken = FreestyleApi.createIdentityToken;
  const origDstListDetailed = DaytonaApi.listWorkspacesDetailed;
  const origDstValidate = DaytonaApi.validateApiKey;
  const origDstAccess = DaytonaApi.createSshAccess;
  const origDstProvision = DaytonaApi.provisionWorkspace;
  const origAdvance = OnboardingHandler.advanceToStep3;
  const origShowModel = OnboardingHandler.showModelSelection;

  let lastText = '';
  let lastKb: any = null;
  let advanceCount = 0;
  let modelCount = 0;

  function makeCtx(): BotContext {
    return {
      chat: { id: testChatId },
      from: { id: testChatId },
      config: { ...DEFAULT_CONFIG },
      callbackQuery: { id: 'cb_vm', message: { message_id: 900 } },
      answerCallbackQuery: async () => true,
      api: {
        editMessageText: async (_chatId: number, _msgId: number, text: string, opts?: any) => {
          lastText = text;
          lastKb = opts?.reply_markup ?? null;
          return true;
        }
      }
    } as unknown as BotContext;
  }

  try {
    // Stub the terminal-awaiting steps so no SSH probing runs in tests
    OnboardingHandler.advanceToStep3 = async () => { advanceCount++; };
    OnboardingHandler.showModelSelection = async () => { modelCount++; };

    // 1. Keyboard builders expose New/Existing for both roles
    const pcb = flatCallbacks(InlineKeyboards.buildOnboardingVmChoice('primary'));
    assert(pcb.includes('onboard:vm:new:p'), 'Primary choice should offer Create-NEW');
    assert(pcb.includes('onboard:vm:existing:p'), 'Primary choice should offer Existing VM');

    const scb = flatCallbacks(InlineKeyboards.buildOnboardingVmChoice('secondary'));
    assert(scb.includes('onboard:vm:new:s'), 'Secondary choice should offer Create-NEW');
    assert(scb.includes('onboard:vm:existing:s'), 'Secondary choice should offer Existing VM');

    const mcb = flatCallbacks(InlineKeyboards.buildSecondaryMethod());
    assert(mcb.includes('onboard:sec:method:api'), 'Secondary method should offer API key');
    assert(mcb.includes('onboard:sec:method:ssh'), 'Secondary method should offer SSH target');
    assert(mcb.includes('onboard:cancel'), 'Secondary method should offer Cancel');
    console.log('[PASS] VM choice & picker keyboard builders verified');

    // 2. Workspace picker renders role-scoped callbacks
    const wcb = flatCallbacks(InlineKeyboards.buildWorkspacePicker(
      [0, 1, 2].map((i) => ({ id: `ws_${i}`, name: `sandbox-${i}`, specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } })),
      'primary'
    ));
    assert(wcb.includes('onboard:ws:p:0') && wcb.includes('onboard:ws:p:2'), 'Picker should expose primary role indices');
    assert(!wcb.some((c) => c.startsWith('onboard:ws:s:')), 'Primary picker must not use secondary role');
    assert(!flatCallbacks(InlineKeyboards.buildWorkspacePicker([], 'primary')).some((c) => c.startsWith('onboard:ws:')), 'Empty picker renders no rows');
    console.log('[PASS] Workspace picker builder verified');

    // 3. VM choice prompt offers Create-NEW / Existing
    const ctx3 = makeCtx();
    await OnboardingVmHandler.handleShowVmChoice(ctx3, 'primary');
    assert(lastText.toLowerCase().includes('create a new vm'), 'Prompt must offer to create a NEW VM');
    assert(lastText.toLowerCase().includes('existing'), 'Prompt must offer to use an Existing VM');
    console.log('[PASS] Primary VM choice prompt verified');

    // 4. Existing primary: picker populates from the provider list and caches it
    const ctx4 = makeCtx();
    DaytonaApi.validateApiKey = async () => ({
      valid: true,
      availableCores: 4,
      availableRamGb: 8,
      availableStorageGb: 10,
      hardLimitCores: 4,
      hardLimitRamGb: 8,
      hardLimitStorageGb: 10
    });
    DaytonaApi.listWorkspacesDetailed = async () => ({
      ok: true,
      authError: false,
      workspaces: [
        { id: 'ws_a', name: 'openclaw-primary', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_b', name: 'web-staging', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'ws_c', name: 'scratch', specs: { cpuCores: 8, ramGb: 16, storageGb: 20 } }
      ]
    });
    const s4 = BotSessionManager.startOnboarding(testChatId);
    s4.onboardingDraft.provider = 'daytona';
    s4.onboardingDraft.primaryMethod = 'api';
    s4.onboardingDraft.primaryApiKey = 'daytona_key_test';
    await OnboardingVmHandler.handleCallback(ctx4, 'onboard:vm:existing:p');
    const firstWsCb = flatCallbacks(lastKb).filter((c) => c.startsWith('onboard:ws:p:'));
    assert.strictEqual(firstWsCb.length, 3, 'Picker must show all 3 existing workspaces');
    assert.strictEqual(s4.userMemory?.['onboarding:workspaces']?.length, 3, 'Workspaces must be cached in session memory');
    console.log('[PASS] Existing primary workspace picker populated');

    // 4b. Re-opening workspace picker must always fetch live list and not use stale cached list
    DaytonaApi.listWorkspacesDetailed = async () => ({
      ok: true,
      authError: false,
      workspaces: [
        { id: 'ws_a', name: 'openclaw-primary', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } }
      ]
    });
    await OnboardingVmHandler.handleCallback(ctx4, 'onboard:vm:existing:p');
    const updatedCbs = flatCallbacks(lastKb).filter((c) => c.startsWith('onboard:ws:p:'));
    assert.strictEqual(updatedCbs.length, 1, 'Picker must refresh live and show only 1 workspace after deletion');
    assert.strictEqual(s4.userMemory?.['onboarding:workspaces']?.length, 1, 'Session memory must reflect live list');
    console.log('[PASS] Workspace picker re-fetches live without stale cache');

    // 5. Selecting an existing primary workspace mints SSH and advances to step 3
    const ctx5 = makeCtx();
    DaytonaApi.createSshAccess = async (_k, wsId) => {
      assert.strictEqual(wsId, 'ws_a', 'Must mint SSH for the selected workspace');
      return { success: true, sshTarget: 'fresh_ws_a_token@ssh.app.daytona.io' };
    };
    await OnboardingVmHandler.handleCallback(ctx5, 'onboard:ws:p:0');
    assert.strictEqual(advanceCount, 1, 'advanceToStep3 must run after workspace selection');
    assert.strictEqual(s4.onboardingDraft.primaryWorkspaceId, 'ws_a', 'Selected workspace id must be persisted');
    assert.strictEqual(s4.onboardingDraft.primarySlug, 'openclaw-primary');
    assert.strictEqual(s4.onboardingDraft.primarySshTarget, 'fresh_ws_a_token@ssh.app.daytona.io');
    console.log('[PASS] Existing-primary select minted SSH and persisted workspace id');

    // 6. Create-NEW primary provisions immediately and launches step 3
    DaytonaApi.provisionWorkspace = async (_k, name) => ({
      success: true,
      workspaceId: 'ws_fresh_1',
      sshTarget: 'fresh_prov_token@ssh.app.daytona.io'
    });
    const ctx6 = makeCtx();
    await OnboardingVmHandler.handleCallback(ctx6, 'onboard:vm:new:p');
    assert.strictEqual(advanceCount, 2, 'Create-NEW must advance to step 3');
    assert.strictEqual(s4.onboardingDraft.primaryWorkspaceId, 'ws_fresh_1', 'Provisioned workspace id must be persisted');
    assert.strictEqual(s4.onboardingDraft.primarySlug, 'openclaw-primary');
    assert.strictEqual(s4.onboardingDraft.primarySshTarget, 'fresh_prov_token@ssh.app.daytona.io');
    console.log('[PASS] Create-NEW primary provisioned and persisted id');

    // 7. Dedicated topology with API-key primary routes to the SECONDARY VM choice
    const ctx7 = makeCtx();
    FreestyleApi.validateApiKey = async () => ({ valid: true, vms: [] });
    FreestyleApi.listVms = async () => [
      { id: 'fs_sec_b', slug: 'llama-box' },
      { id: 'fs_sec_c', slug: 'gpu-box' }
    ];
    const s7 = BotSessionManager.getSession(testChatId);
    s7.onboardingDraft.provider = 'freestyle';
    s7.onboardingDraft.primaryMethod = 'api';
    s7.onboardingDraft.primaryApiKey = 'fst_test_key_1';
    s7.onboardingDraft.primaryWorkspaceId = 'ws_fresh_1';
    s7.onboardingDraft.primarySshTarget = 'openclaw-primary:tok@beta-ssh.freestyle.sh';
    await OnboardingHandler.handleTopologySelect(ctx7, 'dedicated');
    assert(lastText.toLowerCase().includes('secondary'), 'Dedicated topology with API primary must ask about the secondary VM');
    console.log('[PASS] Dedicated topology routes to secondary VM choice');

    // 8. Existing-secondary picker EXCLUDES the primary workspace and mints SSH for the selection
    const ctx8 = makeCtx();
    BotSessionManager.getSession(testChatId).userMemory = {
      'onboarding:workspaces': [
        { id: 'ws_fresh_1', name: 'openclaw-primary', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'fs_sec_b', name: 'llama-box', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } },
        { id: 'fs_sec_c', name: 'gpu-box', specs: { cpuCores: 4, ramGb: 8, storageGb: 10 } }
      ]
    };
    FreestyleApi.listVms = async () => []; // secondary reuses the cache; must NOT refetch
    await OnboardingVmHandler.handleCallback(ctx8, 'onboard:vm:existing:s');
    const secWsCb = flatCallbacks(lastKb).filter((c) => c.startsWith('onboard:ws:s:'));
    assert.strictEqual(secWsCb.length, 2, 'Secondary picker must exclude the primary workspace');
    FreestyleApi.createIdentityToken = async (_k, id) => {
      assert.strictEqual(id, 'fs_sec_b', 'Must mint SSH for the selected secondary workspace');
      return { token: 'sec_tok', expiresAt: null };
    };
    await OnboardingVmHandler.handleCallback(ctx8, 'onboard:ws:s:0');
    assert.strictEqual(modelCount, 1, 'Secondary selection must proceed to model selection');
    assert.strictEqual(s7.onboardingDraft.secondaryWorkspaceId, 'fs_sec_b');
    assert.strictEqual(s7.onboardingDraft.secondarySlug, 'llama-box');
    assert(s7.onboardingDraft.secondarySshTarget?.includes('sec_tok'), 'Secondary SSH target must be minted');
    console.log('[PASS] Secondary picker excluded primary and persisted secondary id');

    // 9. Secondary SSH method routes to a text input
    const ctx9 = makeCtx();
    await OnboardingVmHandler.handleCallback(ctx9, 'onboard:sec:method:ssh');
    assert.strictEqual(BotSessionManager.getSession(testChatId).awaitingField, 'secondarySshTarget', 'SSH method must await a target string');
    console.log('[PASS] Secondary SSH method routes to target input');
  } finally {
    FreestyleApi.validateApiKey = origFstValidate;
    FreestyleApi.listVms = origFstList;
    FreestyleApi.createIdentityToken = origFstToken;
    DaytonaApi.listWorkspacesDetailed = origDstListDetailed;
    DaytonaApi.validateApiKey = origDstValidate;
    DaytonaApi.createSshAccess = origDstAccess;
    DaytonaApi.provisionWorkspace = origDstProvision;
    OnboardingHandler.advanceToStep3 = origAdvance;
    OnboardingHandler.showModelSelection = origShowModel;
    BotSessionManager.clearUserSession(testChatId);
  }
}

testTelegramVmSelection().catch((err) => {
  console.error('[FAIL] test_telegram_bot_vm_selection:', err);
  process.exit(1);
});