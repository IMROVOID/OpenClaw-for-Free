import assert from 'assert';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { DEFAULT_CONFIG, ConfigManager } from '../src/control-panel/core/configManager.js';
import { OpenclawConfigSyncer } from '../src/control-panel/core/openclawConfigSyncer.js';
import { OmnirouteSync } from '../src/control-panel/core/omnirouteSync.js';
import { BotContext } from '../src/telegram-bot/types.js';

function testTelegramBotOnboarding() {
  console.log('--- Running test: Telegram Bot Onboarding Flow ---');

  const testChatId = 987654321;

  try {
    // 1. Test Session Initialization & Onboarding Start
    const session1 = BotSessionManager.startOnboarding(testChatId);
    assert.strictEqual(session1.flow, 'onboarding');
    assert.strictEqual(session1.step, 1);
    assert.strictEqual(session1.onboardingDraft.provider, 'freestyle');
    assert.strictEqual(session1.awaitingField, undefined);

    // 2. Test Step Update & Awaiting Field
    BotSessionManager.setOnboardingStep(testChatId, 2, 'primaryApiKey');
    const session2 = BotSessionManager.getSession(testChatId);
    assert.strictEqual(session2.step, 2);
    assert.strictEqual(session2.awaitingField, 'primaryApiKey');

    // 3. Test Session Reset / Clear
    BotSessionManager.clearFlow(testChatId);
    const session3 = BotSessionManager.getSession(testChatId);
    assert.strictEqual(session3.flow, 'none');
    assert.strictEqual(session3.step, 0);
    assert.strictEqual(session3.awaitingField, undefined);

    // 4. Test Keyboards: Provider Selection
    const provKb = InlineKeyboards.buildOnboardingProvider();
    const provCallbacks = provKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
    assert(provCallbacks.includes('onboard:provider:freestyle'), 'Should have Freestyle option');
    assert(provCallbacks.includes('onboard:provider:daytona'), 'Should have Daytona option');
    assert(provCallbacks.includes('onboard:cancel'), 'Should have Cancel option');

    // 5. Test Keyboards: Provisioning Method
    const methodKb = InlineKeyboards.buildOnboardingProvisionMethod();
    const methodCallbacks = methodKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
    assert(methodCallbacks.includes('onboard:method:api'), 'Should have API key method');
    assert(methodCallbacks.includes('onboard:method:ssh'), 'Should have SSH target method');
    assert(methodCallbacks.includes('onboard:back'), 'Should have Back option');

    // 6. Test Keyboards: Topology
    const topoKb = InlineKeyboards.buildOnboardingTopology();
    const topoCallbacks = topoKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
    assert(topoCallbacks.includes('onboard:topo:dedicated'), 'Should have Dedicated VM option');
    assert(topoCallbacks.includes('onboard:topo:same_vm'), 'Should have Same VM option');
    assert(topoCallbacks.includes('onboard:topo:cloud_only'), 'Should have Cloud APIs Only option');

    // 7. Test Keyboards: Model Selection
    const modelKb = InlineKeyboards.buildOnboardingModel();
    const modelCallbacks = modelKb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
    assert(modelCallbacks.includes('onboard:model:qwen7b'), 'Should have Qwen 7B MTP option');
    assert(modelCallbacks.includes('onboard:model:qwen14b'), 'Should have Qwen 14B option');
    assert(modelCallbacks.includes('onboard:model:custom'), 'Should have Custom model option');

    console.log('[PASS] Telegram Bot Onboarding Flow tests passed successfully!');
  } finally {
    BotSessionManager.clearUserSession(testChatId);
  }
}

async function testOnboardingSingleMessageEdits() {
  console.log('--- Running test: Onboarding Single-Message In-Place Editing ---');
  const testChatId = 77889900;

  try {
    let replyCount = 0;
    let editMessageTextCount = 0;
    let lastEditedText = '';

    const mockCtx = {
      chat: { id: testChatId },
      from: { id: testChatId },
      config: { ...DEFAULT_CONFIG },
      callbackQuery: {
        id: 'cb_123',
        message: { message_id: 555 }
      },
      reply: async (_text: string) => {
        replyCount++;
        return { message_id: 555, chat: { id: testChatId } };
      },
      editMessageText: async (text: string) => {
        editMessageTextCount++;
        lastEditedText = text;
        return true;
      },
      answerCallbackQuery: async () => true,
      api: {
        editMessageText: async (_chatId: number, _msgId: number, text: string) => {
          editMessageTextCount++;
          lastEditedText = text;
          return true;
        }
      }
    } as unknown as BotContext;

    // 1. startOnboarding with callbackQuery edits message
    await OnboardingHandler.startOnboarding(mockCtx);
    assert.strictEqual(replyCount, 0, 'startOnboarding on callbackQuery should edit, not reply');
    assert.strictEqual(editMessageTextCount, 1, 'startOnboarding should call editMessageText');

    // 2. handleMethodSelect edits message in place, never sends a second message
    await OnboardingHandler.handleMethodSelect(mockCtx, 'api');
    assert.strictEqual(replyCount, 0, 'handleMethodSelect should edit, not send second reply message');
    assert(lastEditedText.includes('API Key'), 'Should edit prompt into same message');

    console.log('[PASS] Onboarding Single-Message In-Place Editing tests passed successfully!');
  } finally {
    BotSessionManager.clearUserSession(testChatId);
  }
}

testTelegramBotOnboarding();
await testOnboardingSingleMessageEdits();

async function testOnboardingPersistenceOfWorkspaceIds() {
  console.log('--- Running test: Onboarding Persists Workspace IDs ---');
  const testChatId = 31415926;
  const origSave = ConfigManager.save;
  const origSync = OpenclawConfigSyncer.sync;
  const origOmni = OmnirouteSync.syncProvidersToRemoteVps;

  let lastSavedConfig: any = null;
  ConfigManager.save = (c: any) => { lastSavedConfig = c; };
  OpenclawConfigSyncer.sync = async () => {};
  OmnirouteSync.syncProvidersToRemoteVps = async () => ({ success: true, syncedCount: 0 });

  try {
    const mockCtx = {
      chat: { id: testChatId },
      from: { id: testChatId },
      config: { ...DEFAULT_CONFIG },
      reply: async (_text: string) => ({ message_id: 1, chat: { id: testChatId } }),
      api: {
        editMessageText: async (_chatId: number, _msgId: number, _text: string) => true
      }
    } as unknown as BotContext;

    // 1. Daytona draft: workspace ids + slugs must be written to config
    const session = BotSessionManager.startOnboarding(testChatId);
    session.onboardingDraft = {
      ...session.onboardingDraft,
      provider: 'daytona',
      primaryMethod: 'api',
      primaryApiKey: 'daytona_key_1',
      primarySshTarget: 'dayt_tok_a@ssh.app.daytona.io',
      primaryWorkspaceId: 'ws_prim_1',
      primarySlug: 'openclaw-primary',
      secondarySshTarget: 'dayt_tok_b@ssh.app.daytona.io',
      secondaryWorkspaceId: 'ws_sec_9',
      secondarySlug: 'openclaw-llama',
      specs: { cpuCores: 4, ramGb: 8, storageGb: 10 },
      llamaTopology: 'dedicated',
      secondaryMethod: 'api',
      domainedUrlsEnabled: false,
      ingressProvider: 'none'
    };
    await OnboardingHandler.finalizeSetup(mockCtx);
    assert.strictEqual(lastSavedConfig.provider, 'daytona');
    assert.strictEqual(lastSavedConfig.daytonaApiKey, 'daytona_key_1');
    assert.strictEqual(lastSavedConfig.daytonaPrimaryWorkspaceId, 'ws_prim_1', 'Primary workspace id must persist');
    assert.strictEqual(lastSavedConfig.daytonaSecondaryWorkspaceId, 'ws_sec_9', 'Secondary workspace id must persist');
    assert.strictEqual(lastSavedConfig.primarySshTarget, 'dayt_tok_a@ssh.app.daytona.io');
    assert.strictEqual(lastSavedConfig.secondarySshTarget, 'dayt_tok_b@ssh.app.daytona.io');
    assert.strictEqual(lastSavedConfig.llama.sshTarget, 'dayt_tok_b@ssh.app.daytona.io');
    assert.strictEqual(lastSavedConfig.llama.enabled, true);
    assert.strictEqual(lastSavedConfig.llama.isSeparateVps, true);
    console.log('[PASS] Daytona onboarding persists workspace ids');

    // 2. Freestyle draft: workspace ids map to vm ids + slugs
    BotSessionManager.clearFlow(testChatId);
    const fsSession = BotSessionManager.startOnboarding(testChatId);
    fsSession.onboardingDraft = {
      ...fsSession.onboardingDraft,
      provider: 'freestyle',
      primaryMethod: 'api',
      primaryApiKey: 'fst_test_key_1',
      primarySshTarget: 'openclaw-primary:tok_a@beta-ssh.freestyle.sh',
      primaryWorkspaceId: 'vm_prim_1',
      primarySlug: 'openclaw-primary',
      secondarySshTarget: 'openclaw-llama:tok_b@beta-ssh.freestyle.sh',
      secondaryWorkspaceId: 'vm_sec_9',
      secondarySlug: 'openclaw-llama',
      specs: { cpuCores: 4, ramGb: 8, storageGb: 32 },
      llamaTopology: 'dedicated',
      secondaryMethod: 'api',
      domainedUrlsEnabled: false,
      ingressProvider: 'none'
    };
    await OnboardingHandler.finalizeSetup(mockCtx);
    assert.strictEqual(lastSavedConfig.provider, 'freestyle');
    assert.strictEqual(lastSavedConfig.freestyleApiKey, 'fst_test_key_1');
    assert.strictEqual(lastSavedConfig.freestylePrimarySlug, 'openclaw-primary');
    assert.strictEqual(lastSavedConfig.freestyleLlamaSlug, 'openclaw-llama');
    assert.strictEqual(lastSavedConfig.freestylePrimaryVmId, 'vm_prim_1', 'Freestyle vm id must map from workspace id');
    assert.strictEqual(lastSavedConfig.freestyleSecondaryVmId, 'vm_sec_9', 'Freestyle secondary vm id must map from workspace id');
    console.log('[PASS] Freestyle onboarding persists vm ids and slugs');

    console.log('[PASS] Onboarding Persists Workspace IDs tests passed successfully!');
  } finally {
    ConfigManager.save = origSave;
    OpenclawConfigSyncer.sync = origSync;
    OmnirouteSync.syncProvidersToRemoteVps = origOmni;
    BotSessionManager.clearUserSession(testChatId);
  }
}

await testOnboardingPersistenceOfWorkspaceIds();
