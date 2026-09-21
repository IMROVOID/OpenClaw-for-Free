import assert from 'assert';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';
import { OnboardingLlamaHandler } from '../src/telegram-bot/handlers/onboardingLlamaHandler.js';
import { OnboardingIngressHandler } from '../src/telegram-bot/handlers/onboardingIngressHandler.js';
import { OnboardingFinalizer } from '../src/telegram-bot/handlers/onboardingFinalizer.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { BotContext } from '../src/telegram-bot/types.js';

type KbButton = { callback_data?: string; text?: string };

function flatCallbacks(kb: any): string[] {
  return (kb?.inline_keyboard ?? []).flat().map((b: KbButton) => b.callback_data || '');
}

const chatId = 61616161;
let lastText = '';
let lastKb: any = null;

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

async function testSecondaryLlamaAutodetect() {
  console.log('--- Running test: Secondary VM Llama Auto-Detect Before Model Selection ---');

  const origSecondary = VpsConfigDetector.inspect;
  const origInspect = VpsConfigDetector.inspect;
  const origIngress = OnboardingIngressHandler.showIngressChoice;

  try {
    // 1. Fresh secondary VM (no llama installed) -> falls through to model selection
    BotSessionManager.startOnboarding(chatId);
    const ctx = makeCtx({ llama: {} });
    const draft = BotSessionManager.getSession(chatId).onboardingDraft;
    draft.secondarySshTarget = 'openclaw-llama:tok@beta-ssh.freestyle.sh';
    draft.llamaTopology = 'dedicated';

    VpsConfigDetector.inspect = async () =>
      ({ reachable: true, llamaInstalled: false, llamaRunning: false } as any);

    await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx);
    assert(lastText.includes('Local LLM Inference Model'), `Fresh VM must show model selection, got: ${lastText}`);
    assert(flatCallbacks(lastKb).includes('onboard:model:qwen7b'), 'Fresh VM must offer model buttons');

    // 2. Running llama on secondary -> shows keep/reconfigure, NOT model selection
    BotSessionManager.startOnboarding(chatId);
    const ctx2 = makeCtx({ llama: {} });
    const draft2 = BotSessionManager.getSession(chatId).onboardingDraft;
    draft2.secondarySshTarget = 'openclaw-llama:tok@beta-ssh.freestyle.sh';
    draft2.llamaTopology = 'dedicated';

    VpsConfigDetector.inspect = async () =>
      ({
        reachable: true,
        llamaInstalled: true,
        llamaRunning: true,
        llamaEndpoint: 'https://openclaw-llama.style.dev/v1',
        llamaModel: 'qwen2.5-7b-instruct-q5_k_m.gguf'
      } as any);

    await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx2);
    assert(lastText.includes('Already Running'), `Running setup must show keep screen, got: ${lastText}`);
    assert(lastText.includes('RUNNING'), 'Keep screen must report RUNNING state');
    assert(flatCallbacks(lastKb).includes('onboard:llama:keep-sec'), 'Must offer keep-existing');
    assert(flatCallbacks(lastKb).includes('onboard:llama:reconf-sec'), 'Must offer reconfigure');
    assert(!flatCallbacks(lastKb).includes('onboard:model:qwen7b'), 'Must NOT offer model selection');

    const kept = BotSessionManager.getSession(chatId).onboardingDraft;
    assert.strictEqual(kept.skipLlamaProvisioning, true, 'Draft must skip provisioning');
    assert.strictEqual(kept.llamaTopology, 'dedicated', 'Draft must keep dedicated topology');
    assert.strictEqual(kept.activeEndpointUrl, 'https://openclaw-llama.style.dev/v1', 'Draft must store endpoint');
    assert.strictEqual(kept.modelName, 'qwen2.5-7b-instruct-q5_k_m.gguf', 'Draft must store detected model');

    // 3. Keep-existing lands on ingress step (full onboarding), not finalize
    let ingressCount = 0;
    OnboardingIngressHandler.showIngressChoice = async () => { ingressCount++; };
    await OnboardingLlamaHandler.handleKeepSecondaryLlama(ctx2);
    assert.strictEqual(ingressCount, 1, 'Keep must advance to ingress choice');

    // 4. Reconfigure resets skip flag and returns to model selection
    OnboardingIngressHandler.showIngressChoice = origIngress;
    await OnboardingLlamaHandler.handleReconfigureSecondaryLlama(ctx2);
    const reconf = BotSessionManager.getSession(chatId).onboardingDraft;
    assert.strictEqual(reconf.skipLlamaProvisioning, false, 'Reconfigure must clear skip flag');
    assert.strictEqual(reconf.modelName, undefined, 'Reconfigure must clear detected model');
    assert(lastText.includes('Local LLM Inference Model'), 'Reconfigure must show model selection');

    // 5. secondaryOnly flow -> keep goes straight to finalize, never ingress
    BotSessionManager.startOnboarding(chatId);
    const ctx3 = makeCtx({ llama: {} });
    const draft3 = BotSessionManager.getSession(chatId).onboardingDraft;
    draft3.secondaryOnly = true;
    draft3.secondarySshTarget = 'openclaw-llama:tok@beta-ssh.freestyle.sh';
    VpsConfigDetector.inspect = async () =>
      ({ reachable: true, llamaInstalled: true, llamaRunning: true, llamaEndpoint: 'http://127.0.0.1:8080/v1' } as any);

    let finalizeCount = 0;
    const origFin = OnboardingFinalizer.finalizeSetup;
    OnboardingFinalizer.finalizeSetup = async () => { finalizeCount++; };
    await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx3);
    assert(lastText.includes('Already Running'), 'secondaryOnly flow must still probe the secondary VM');
    await OnboardingLlamaHandler.handleKeepSecondaryLlama(ctx3);
    assert.strictEqual(finalizeCount, 1, 'secondaryOnly keep must finalize, not go to ingress');
    assert.strictEqual(ingressCount, 1, 'secondaryOnly keep must not call ingress again');
    OnboardingFinalizer.finalizeSetup = origFin;

    // 6. Missing secondary SSH target -> straight to model selection, no probe
    BotSessionManager.startOnboarding(chatId);
    const ctx4 = makeCtx({ llama: {} });
    let probeCalls = 0;
    VpsConfigDetector.inspect = async () => { probeCalls++; return { llamaInstalled: false, llamaRunning: false } as any; };
    await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx4);
    assert.strictEqual(probeCalls, 0, 'Must not probe when no secondary SSH target is known');
    assert(lastText.includes('Local LLM Inference Model'), 'No-target path must show model selection');

    // 7. Keyboard layout sanity
    const kb = InlineKeyboards.buildOnboardingSecondaryLlamaKeep();
    const cbs = flatCallbacks(kb);
    assert(cbs.includes('onboard:llama:keep-sec'), 'Keyboard keep button');
    assert(cbs.includes('onboard:llama:reconf-sec'), 'Keyboard reconfigure button');
    assert(cbs.includes('onboard:back'), 'Keyboard back button');
    const keepBtn = (kb?.inline_keyboard ?? []).flat().find((b: any) => b.callback_data === 'onboard:llama:keep-sec');
    assert(keepBtn?.text?.includes('Default'), 'Keep button must be marked Default');

    console.log('OK');
    BotSessionManager.clearFlow(chatId);
  } finally {
    VpsConfigDetector.inspect = origInspect;
    OnboardingIngressHandler.showIngressChoice = origIngress;
  }
}

testSecondaryLlamaAutodetect()
  .then(() => console.log('PASS'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
