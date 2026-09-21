import assert from 'assert';
import { OnboardingVmHandler } from '../src/telegram-bot/handlers/onboardingVmHandler.js';
import { OnboardingLlamaHandler } from '../src/telegram-bot/handlers/onboardingLlamaHandler.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { OnboardingFinalizer } from '../src/telegram-bot/handlers/onboardingFinalizer.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { VmSshAutoRenewer } from '../src/control-panel/core/vmSshAutoRenewer.js';
import { OnboardingExistingLlama } from '../src/control-panel/core/onboardingExistingLlama.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { FreestyleApi } from '../src/control-panel/core/freestyleApi.js';
import { BotContext } from '../src/telegram-bot/types.js';

async function runTests() {
  console.log('--- Testing Secondary VM API Key Selection & Stored Auto-Reconnect ---');

  const chatId = 88224411;
  let lastText = '';
  let lastKb: any = null;

  function makeCtx(configOverrides: any = {}): BotContext {
    return {
      chat: { id: chatId },
      from: { id: chatId },
      config: {
        ...DEFAULT_CONFIG,
        provider: 'freestyle',
        llama: { ...DEFAULT_CONFIG.llama },
        ...configOverrides
      },
      callbackQuery: { id: 'cb_test', message: { message_id: 888 } },
      answerCallbackQuery: async () => true,
      api: {
        editMessageText: async (_c: number, _m: number, text: string, opts?: any) => {
          lastText = text;
          lastKb = opts?.reply_markup ?? null;
          return true;
        }
      }
    } as unknown as BotContext;
  }

  function flatCallbacks(kb: any): string[] {
    if (!kb || !kb.inline_keyboard) return [];
    return kb.inline_keyboard.flat().map((btn: any) => btn.callback_data);
  }

  // --- Test 1: Secondary VM API method prompts for key choice when an API key is available ---
  console.log('Test 1: Secondary VM API method prompts for key choice when API key is available...');
  BotSessionManager.clearFlow(chatId);
  const session1 = BotSessionManager.startOnboarding(chatId);
  session1.onboardingDraft.provider = 'freestyle';
  session1.onboardingDraft.primaryApiKey = 'fst_primary_key_abc';
  const ctx1 = makeCtx();

  await OnboardingVmHandler.handleCallback(ctx1, 'onboard:sec:method:api');
  assert(flatCallbacks(lastKb).includes('onboard:sec:provider:daytona'));
  await OnboardingVmHandler.handleCallback(ctx1, 'onboard:sec:provider:freestyle');
  assert(lastText.includes('Secondary VM API Key Setup'), `Must prompt for Secondary VM API Key Setup, got: ${lastText}`);
  const cbs1 = flatCallbacks(lastKb);
  assert(cbs1.includes('onboard:sec:key:existing'), 'Must offer option to use existing API key');
  assert(cbs1.includes('onboard:sec:key:new'), 'Must offer option to enter different API key');
  console.log('[PASS] Test 1: Prompted for existing vs different API key');

  // --- Test 2: Selecting "Use Existing API Key" adopts primary key and proceeds to VM choice ---
  console.log('Test 2: Selecting "Use Existing API Key" proceeds to VM choice...');
  await OnboardingVmHandler.handleCallback(ctx1, 'onboard:sec:key:existing');
  assert.strictEqual(session1.onboardingDraft.secondaryApiKey, 'fst_primary_key_abc', 'Must adopt existing primary API key');
  assert(lastText.includes('Secondary LLM VM Setup') || lastText.includes('Create a New VM'), `Must show VM choice, got: ${lastText}`);
  console.log('[PASS] Test 2: Existing key adopted');

  // --- Test 3: Selecting "Enter Different API Key" prompts for input and does not overwrite primary key ---
  console.log('Test 3: Selecting "Enter Different API Key" prompts for input...');
  await OnboardingVmHandler.handleCallback(ctx1, 'onboard:sec:key:new');
  assert.strictEqual(session1.onboardingDraft.secondaryApiKey, undefined, 'Must clear secondaryApiKey');
  assert.strictEqual(session1.awaitingField, 'secondaryApiKey', 'Must await secondaryApiKey');
  assert(lastText.includes('Please send your new *Freestyle.sh API Key*'), `Must prompt for new key input, got: ${lastText}`);

  const origValidate = FreestyleApi.validateApiKey;
  try {
    FreestyleApi.validateApiKey = async (key: string) => {
      assert.strictEqual(key, 'fst_separate_account_xyz');
      return { valid: true };
    };

    const handled = await OnboardingHandler.handleTextInput(ctx1, 'fst_separate_account_xyz');
    assert.strictEqual(handled, true, 'handleTextInput must accept secondaryApiKey');
    assert.strictEqual(session1.onboardingDraft.secondaryApiKey, 'fst_separate_account_xyz', 'Must store new secondary API key');
    assert.strictEqual(session1.onboardingDraft.primaryApiKey, 'fst_primary_key_abc', 'Primary API key must remain unchanged');
    console.log('[PASS] Test 3: Different API key validated and stored separately');
  } finally {
    FreestyleApi.validateApiKey = origValidate;
  }

  // --- Test 4: FinalizeSetup persists secondary API key under distinct config field ---
  console.log('Test 4: FinalizeSetup persists secondaryFreestyleApiKey...');
  session1.onboardingDraft.domainedUrlsEnabled = false;
  session1.onboardingDraft.ingressProvider = 'none';
  const ctx4 = makeCtx();
  await OnboardingFinalizer.finalizeSetup(ctx4);
  assert.strictEqual(ctx4.config.freestyleApiKey, 'fst_primary_key_abc', 'Primary key preserved in config');
  assert.strictEqual(ctx4.config.secondaryFreestyleApiKey, 'fst_separate_account_xyz', 'Secondary key stored under secondaryFreestyleApiKey');
  console.log('[PASS] Test 4: Distinct config fields persisted');

  // --- Test 5: Telegram Bot Auto-Reconnect via stored Secondary API Key when Llama is detected ---
  console.log('Test 5: Telegram Bot auto-reconnects using stored Secondary API Key...');
  BotSessionManager.clearFlow(chatId);
  const session5 = BotSessionManager.startOnboarding(chatId);
  session5.userMemory = {
    'onboarding:llama-existing': {
      isSeparate: true,
      endpoint: 'https://llama-separate.up.railway.app/v1',
      modelName: 'Qwen 2.5 7B MTP',
      sshTarget: undefined
    }
  };

  const origRefresh = VmSshAutoRenewer.refreshSecondaryVmSsh;
  let refreshCalled = false;
  try {
    VmSshAutoRenewer.refreshSecondaryVmSsh = async (cfg) => {
      refreshCalled = true;
      cfg.secondarySshTarget = 'openclaw-llama:sec_auto_tok@beta-ssh.freestyle.sh';
      return { renewed: true, found: true, newSshTarget: cfg.secondarySshTarget };
    };

    let finalizeRan = false;
    const origFinalize = OnboardingHandler.finalizeSetup;
    OnboardingHandler.finalizeSetup = async (ctx) => {
      finalizeRan = true;
      ctx.config.secondarySshTarget = 'openclaw-llama:sec_auto_tok@beta-ssh.freestyle.sh';
    };

    const ctx5 = makeCtx({
      secondaryFreestyleApiKey: 'fst_stored_secondary_key'
    });

    await OnboardingLlamaHandler.handleKeepExistingLlama(ctx5);
    assert.strictEqual(refreshCalled, true, 'Must attempt refreshSecondaryVmSsh using stored key');
    assert.strictEqual(finalizeRan, true, 'Must finalize setup directly without prompting user');
    assert(!lastText.includes('Secondary VM Connection'), 'Must NOT show secondary connection prompt');
    console.log('[PASS] Test 5: Auto-reconnect succeeded without prompting user');
    OnboardingHandler.finalizeSetup = origFinalize;
  } finally {
    VmSshAutoRenewer.refreshSecondaryVmSsh = origRefresh;
  }

  // --- Test 6: Telegram Bot prompts when stored Secondary API key fails or is absent ---
  console.log('Test 6: Telegram Bot prompts when stored key is invalid or absent...');
  BotSessionManager.clearFlow(chatId);
  const session6 = BotSessionManager.startOnboarding(chatId);
  session6.userMemory = {
    'onboarding:llama-existing': {
      isSeparate: true,
      endpoint: 'https://llama-separate.up.railway.app/v1',
      modelName: 'Qwen 2.5 7B MTP',
      sshTarget: undefined
    }
  };

  try {
    VmSshAutoRenewer.refreshSecondaryVmSsh = async () => {
      return { renewed: false, found: false, error: 'API key invalid' };
    };

    const ctx6 = makeCtx({
      secondaryFreestyleApiKey: 'fst_invalid_key'
    });

    await OnboardingLlamaHandler.handleKeepExistingLlama(ctx6);
    assert(lastText.includes('Secondary VM Connection'), `Must show Secondary VM Connection prompt when key fails, got: ${lastText}`);
    const cbs6 = flatCallbacks(lastKb);
    assert(cbs6.includes('onboard:sec:conn:api'), 'Must offer Cloud API Key option');
    assert(cbs6.includes('onboard:sec:conn:ssh'), 'Must offer Direct SSH Target option');
    console.log('[PASS] Test 6: Fallback prompt shown when key fails');
  } finally {
    VmSshAutoRenewer.refreshSecondaryVmSsh = origRefresh;
  }

  // --- Test 7: Terminal script autoConnectSecondaryVm succeeds via stored key ---
  console.log('Test 7: Terminal script autoConnectSecondaryVm...');
  try {
    VmSshAutoRenewer.refreshSecondaryVmSsh = async (cfg) => {
      cfg.secondarySshTarget = 'openclaw-llama:terminal_tok@beta-ssh.freestyle.sh';
      return { renewed: true, found: true, newSshTarget: cfg.secondarySshTarget };
    };

    const termCfg = {
      ...DEFAULT_CONFIG,
      provider: 'freestyle' as const,
      secondaryFreestyleApiKey: 'fst_terminal_sec_key',
      llama: { ...DEFAULT_CONFIG.llama }
    };

    const ok = await OnboardingExistingLlama.autoConnectSecondaryVm(termCfg);
    assert.strictEqual(ok, true, 'autoConnectSecondaryVm must return true on successful renewal');
    assert.strictEqual(termCfg.secondarySshTarget, 'openclaw-llama:terminal_tok@beta-ssh.freestyle.sh');
    console.log('[PASS] Test 7: Terminal script auto-connect succeeded');
  } finally {
    VmSshAutoRenewer.refreshSecondaryVmSsh = origRefresh;
  }

  // --- Test 8: Terminal script autoConnectSecondaryVm returns false when no key exists ---
  console.log('Test 8: Terminal script autoConnectSecondaryVm returns false when no key exists...');
  const emptyCfg = {
    ...DEFAULT_CONFIG,
    provider: 'freestyle' as const,
    llama: { ...DEFAULT_CONFIG.llama }
  };
  const okEmpty = await OnboardingExistingLlama.autoConnectSecondaryVm(emptyCfg);
  assert.strictEqual(okEmpty, false, 'Must return false when no secondary key is configured');
  console.log('[PASS] Test 8: Correctly reported false without key');

  // --- Test 9: onboard:sec:conn:api directly prompts for API key choice (no duplicate question) ---
  console.log('Test 9: onboard:sec:conn:api directly opens API key choice...');
  BotSessionManager.clearFlow(chatId);
  const session9 = BotSessionManager.startOnboarding(chatId);
  session9.onboardingDraft.provider = 'freestyle';
  session9.onboardingDraft.primaryApiKey = 'fst_primary_key_999';
  const ctx9 = makeCtx();

  await OnboardingVmHandler.handleCallback(ctx9, 'onboard:sec:conn:api');
  assert(flatCallbacks(lastKb).includes('onboard:sec:provider:daytona'));
  assert(flatCallbacks(lastKb).includes('onboard:sec:provider:freestyle'));
  await OnboardingVmHandler.handleCallback(ctx9, 'onboard:sec:provider:daytona');
  assert.strictEqual(session9.awaitingField, 'secondaryApiKey', 'Daytona must request its own key, not offer the Freestyle primary key');
  assert(lastText.includes('Daytona'));
  await OnboardingVmHandler.handleCallback(ctx9, 'onboard:sec:provider:freestyle');
  assert(lastText.includes('Secondary VM API Key Setup'), `Must open Secondary VM API Key Setup, got: ${lastText}`);
  assert(!lastText.includes('How would you like to connect the secondary VM'), 'Must NOT ask API vs SSH again');
  const cbs9 = flatCallbacks(lastKb);
  assert(cbs9.includes('onboard:sec:key:existing'), 'Must offer existing API key option');
  assert(cbs9.includes('onboard:sec:key:new'), 'Must offer different API key option');
  console.log('[PASS] Test 9: Direct API key choice prompt verified without duplicate question');

  // --- Test 10: Workspace caching is role-scoped and does not cross-pollute ---
  console.log('Test 10: Role-scoped workspace caching prevents cache cross-pollution...');
  BotSessionManager.clearFlow(chatId);
  const session10 = BotSessionManager.startOnboarding(chatId);
  session10.onboardingDraft.provider = 'freestyle';
  session10.onboardingDraft.primaryApiKey = 'fst_primary_key_10';
  session10.onboardingDraft.secondaryApiKey = 'fst_sec_key_10';
  session10.userMemory = {
    'onboarding:workspaces:primary': [
      { id: 'primary-vm-id', name: 'primary-vm', specs: { cpuCores: 4, ramGb: 8, storageGb: 32 } }
    ]
  };

  let secondaryQueriedWithKey = '';
  const origList = FreestyleApi.validateApiKey;
  try {
    FreestyleApi.validateApiKey = async (key: string) => {
      secondaryQueriedWithKey = key;
      return {
        valid: true,
        vms: [
          { id: 'secondary-remote-vm-id', slug: 'secondary-remote-vm', state: 'running', resources: { cpu: 8, memory: 16384, storage: 32768 } }
        ]
      };
    };

    const ctx10 = makeCtx();
    await OnboardingVmHandler.showWorkspacePicker(ctx10, 'secondary');
    assert.strictEqual(secondaryQueriedWithKey, 'fst_sec_key_10', 'Must query secondary account API with secondary key');
    assert(lastText.includes('secondary-remote-vm'), `Must display secondary VM from secondary account, got: ${lastText}`);
    assert(!lastText.includes('No existing VMs found'), 'Must NOT fall back to No VMs found due to primary cache');
    console.log('[PASS] Test 10: Role-scoped workspace caching verified');
  } finally {
    FreestyleApi.validateApiKey = origList;
  }

  // --- Test 11: Auto-reconnect does not silently use primary API key if secondary key was not stored ---
  console.log('Test 11: Auto-reconnect does not silently use primary key when secondary key absent...');
  BotSessionManager.clearFlow(chatId);
  const session11 = BotSessionManager.startOnboarding(chatId);
  session11.userMemory = {
    'onboarding:llama-existing': {
      isSeparate: true,
      endpoint: 'https://llama-separate.up.railway.app/v1',
      modelName: 'Qwen 2.5 7B MTP',
      sshTarget: undefined
    }
  };

  let refreshCalledTest11 = false;
  try {
    VmSshAutoRenewer.refreshSecondaryVmSsh = async () => {
      refreshCalledTest11 = true;
      return { renewed: false, found: false };
    };

    const ctx11 = makeCtx({
      freestyleApiKey: 'fst_primary_key_only',
      secondaryFreestyleApiKey: '' // secondary key not stored
    });

    await OnboardingLlamaHandler.handleKeepExistingLlama(ctx11);
    assert.strictEqual(refreshCalledTest11, false, 'Must NOT attempt auto-reconnect using primary API key');
    assert(lastText.includes('Secondary VM Connection'), 'Must show Secondary VM Connection prompt');
    console.log('[PASS] Test 11: Did not silently use primary key');
  } finally {
    VmSshAutoRenewer.refreshSecondaryVmSsh = origRefresh;
  }

  BotSessionManager.clearFlow(chatId);
  console.log('\n[PASS] All Secondary VM API Key & Auto-Reconnect tests completed successfully!');
}

runTests().catch((err) => {
  console.error('\n[FAIL] Test failed:', err);
  process.exit(1);
});
