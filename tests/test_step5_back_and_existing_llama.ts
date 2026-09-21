import assert from 'assert';
import { VpsDetector } from '../src/control-panel/core/vpsDetector.js';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { BotContext } from '../src/telegram-bot/types.js';

type KbButton = { callback_data?: string; text?: string };

function flatCallbacks(kb: any): string[] {
  return (kb?.inline_keyboard ?? []).flat().map((b: KbButton) => b.callback_data || '');
}

async function testStep5BackAndExistingLlama() {
  console.log('--- Running test: Step 5 Back Navigation & Existing LLM Detection ---');

  const origInspect = VpsConfigDetector.inspect;
  const origSecondary = VpsConfigDetector.detectSecondaryLlama;
  const origFinalize = OnboardingHandler.finalizeSetup;

  const chatId = 51505050;
  let lastText = '';
  let lastKb: any = null;
  let finalizeCount = 0;

  function makeCtx(config: any): BotContext {
    return {
      chat: { id: chatId },
      from: { id: chatId },
      config,
      callbackQuery: { id: 'cb', message: { message_id: 1 } },
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

  try {
    // 1. Clean config + no VM llama -> no existing setup
    VpsConfigDetector.inspect = async () => ({ reachable: true, llamaInstalled: false, llamaRunning: false } as any);
    const clean = { ...DEFAULT_CONFIG, llama: { ...DEFAULT_CONFIG.llama } };
    const none = await VpsDetector.detectExistingLlamaSetup(clean);
    assert.strictEqual(none.found, false, 'Clean config must not report existing setup');

    // 2. Enabled dedicated config -> found + isSeparate
    const dedicated = {
      ...DEFAULT_CONFIG,
      secondarySshTarget: 'openclaw-llama:tok@beta-ssh.freestyle.sh',
      llama: {
        ...DEFAULT_CONFIG.llama,
        enabled: true,
        isSeparateVps: true,
        sshTarget: 'openclaw-llama:tok@beta-ssh.freestyle.sh',
        activeEndpointUrl: 'https://openclaw-llama.style.dev/v1',
        modelName: 'qwen7b'
      }
    };
    VpsConfigDetector.detectSecondaryLlama = async () => ({ llamaInstalled: false, llamaRunning: false } as any);
    const found = await VpsDetector.detectExistingLlamaSetup(dedicated);
    assert.strictEqual(found.found, true, 'Enabled dedicated config must report existing setup');
    assert.strictEqual(found.isSeparate, true, 'Dedicated setup must be flagged as separate VM');
    assert.strictEqual(found.endpoint, 'https://openclaw-llama.style.dev/v1', 'Dedicated setup must return endpoint');
    assert(found.summary.includes('openclaw-llama'), 'Summary must name the existing SSH target');

    // 3. Existing-setup keyboard offers keep / new with default label
    const rawKb = InlineKeyboards.buildOnboardingExistingLlama();
    const kbCbs = flatCallbacks(rawKb);
    assert(kbCbs.includes('onboard:llama:keep'), 'Keyboard must offer Use Existing');
    assert(kbCbs.includes('onboard:llama:new'), 'Keyboard must offer Set Up New');
    assert(kbCbs.includes('onboard:back'), 'Keyboard must offer Back');
    const keepBtn = (rawKb?.inline_keyboard ?? []).flat().find((b: any) => b.callback_data === 'onboard:llama:keep');
    assert(keepBtn?.text?.includes('Default'), 'Keep existing button must indicate Default option');

    // 4. advanceToStep5 with existing setup -> keep/new prompt, not topology
    BotSessionManager.startOnboarding(chatId);
    const ctx = makeCtx(dedicated);
    VpsConfigDetector.inspect = async () => ({ reachable: true, llamaInstalled: false, llamaRunning: false } as any);
    await OnboardingHandler.advanceToStep5(ctx);
    assert(lastText.includes('Detected'), 'Step 5 must show detection summary when setup exists');
    const step5Cbs = flatCallbacks(lastKb);
    assert(step5Cbs.includes('onboard:llama:keep'), 'Step 5 must offer keep-existing');
    assert(!step5Cbs.includes('onboard:topo:dedicated'), 'Step 5 must not jump straight to topology');

    // 5. Keep-existing preserves config and skips model selection
    OnboardingHandler.finalizeSetup = async () => { finalizeCount++; };
    await OnboardingHandler.handleKeepExistingLlama(ctx);
    const session = BotSessionManager.getSession(chatId);
    assert.strictEqual(finalizeCount, 1, 'Keep-existing must finalize without model selection');
    assert.strictEqual(session.onboardingDraft.llamaTopology, 'dedicated', 'Keep-existing must reuse detected topology');
    assert.strictEqual(session.onboardingDraft.skipLlamaProvisioning, true, 'Keep-existing must set skipLlamaProvisioning');

    // 6. Back from Step 5 goes to Step 4 (bot channels), NOT Step 1
    OnboardingHandler.finalizeSetup = origFinalize;
    const backSession = BotSessionManager.startOnboarding(chatId);
    backSession.step = 5;
    backSession.awaitingField = undefined;
    await OnboardingHandler.handleBack(makeCtx(clean));
    assert(lastText.includes('Bot Messaging Channels'), `Back from Step 5 must land on Step 4, got: ${lastText}`);
    assert.strictEqual(BotSessionManager.getSession(chatId).step, 4, 'Back from Step 5 must set step 4');

    // 7. Back from the method screen goes to provider (Step 1)
    BotSessionManager.startOnboarding(chatId);
    const s2 = BotSessionManager.getSession(chatId);
    s2.step = 2;
    s2.onboardingDraft.primaryMethod = 'api';
    await OnboardingHandler.handleBack(makeCtx(clean));
    assert(lastText.includes('Select Cloud VPS Provider'), `Back from Step 2 must land on Step 1, got: ${lastText}`);

    console.log('OK');
    BotSessionManager.clearFlow(chatId);
  } finally {
    VpsConfigDetector.inspect = origInspect;
    VpsConfigDetector.detectSecondaryLlama = origSecondary;
    OnboardingHandler.finalizeSetup = origFinalize;
  }
}

testStep5BackAndExistingLlama()
  .then(() => console.log('PASS'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });