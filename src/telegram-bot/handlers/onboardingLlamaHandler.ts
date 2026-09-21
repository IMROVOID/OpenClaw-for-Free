import { InlineKeyboard } from 'grammy';
import { VpsDetector } from '../../control-panel/core/vpsDetector.js';
import { VpsConfigDetector } from '../../control-panel/core/vpsConfigDetector.js';
import { VmSshAutoRenewer } from '../../control-panel/core/vmSshAutoRenewer.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { DetectedVmConfig } from '../../control-panel/core/types.js';
import { BotContext } from '../types.js';

export class OnboardingLlamaHandler {
  static async advanceToStep5(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 5;
    session.awaitingField = undefined;

    const existing = await this.detectExistingLlama(ctx);
    if (existing) {
      session.userMemory = session.userMemory || {};
      session.userMemory['onboarding:llama-existing'] = existing;
      const text = `[Step 5/7] *Local LLM Topology & Deployment*\n\n` +
        `[Detected] *Existing LLM setup / connection found:*\n` +
        `${existing.summary}\n\n` +
        `Keep existing LLM setup (skip deployment)? (Default: Yes)`;
      await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildOnboardingExistingLlama());
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      return;
    }

    await this.showLlamaTopology(ctx);
  }

  static async showLlamaTopology(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 5;
    session.awaitingField = undefined;

    const text = `[Step 5/7] *Local LLM Topology & Deployment*\n\n` +
      `1. *Dedicated Second VM* (Recommended — Zero agent RAM interference)\n` +
      `2. *Same VM* (Co-locate on Primary VM)\n` +
      `3. *Cloud APIs Only* (Disable local llama-server)`;

    await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildOnboardingTopology());
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async detectExistingLlama(ctx: BotContext): Promise<{
    summary: string;
    isSeparate: boolean;
    endpoint?: string;
    modelName?: string;
    sshTarget?: string;
  } | undefined> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const cached = session.userMemory?.['onboarding:vm-detected'] as DetectedVmConfig | undefined;

    if (cached && (cached.llamaInstalled || cached.llamaRunning || cached.llamaEndpoint || cached.llamaTopology)) {
      const isSeparate = cached.llamaTopology === 'second_vm';
      const lines: string[] = [];
      const state = cached.llamaRunning ? '[RUNNING]' : cached.llamaInstalled ? '[INSTALLED]' : '[EXTERNAL CONNECTION]';
      lines.push(`• Status: ${state} (${isSeparate ? 'Dedicated Second VM' : 'Same VM'})`);
      if (cached.llamaEndpoint) lines.push(`• Endpoint: ${cached.llamaEndpoint}`);
      if (cached.llamaModel) lines.push(`• Model: ${cached.llamaModel}`);

      const knownSsh = ctx.config.secondarySshTarget || ctx.config.llama?.sshTarget;
      return {
        summary: lines.join('\n'),
        isSeparate,
        endpoint: cached.llamaEndpoint,
        modelName: cached.llamaModel,
        sshTarget: knownSsh || undefined
      };
    }

    const primaryTarget = session.onboardingDraft.primarySshTarget || ctx.config.primarySshTarget;
    const existing = await VpsDetector.detectExistingLlamaSetup(ctx.config, primaryTarget);
    if (!existing.found) return undefined;
    return {
      summary: existing.summary.split('\n').map((l) => l.startsWith('•') ? l : `• ${l}`).join('\n'),
      isSeparate: existing.isSeparate,
      endpoint: existing.endpoint,
      modelName: existing.modelName,
      sshTarget: existing.sshTarget
    };
  }

  static async detectSecondaryLlama(
    ctx: BotContext,
    secondaryTarget: string
  ): Promise<{ summary: string; endpoint?: string; modelName?: string; running: boolean } | undefined> {
    if (!secondaryTarget) return undefined;

    await OnboardingHandler.updateWizard(ctx, `[PROBING] Inspecting Secondary VM (${secondaryTarget}) for existing llama.cpp setup...`);

    const sec = await VpsConfigDetector.inspect(secondaryTarget);
    if (!sec.llamaInstalled && !sec.llamaRunning) return undefined;

    const running = sec.llamaRunning;
    const endpoint = sec.llamaEndpoint || (running ? 'http://127.0.0.1:8080/v1' : undefined);
    const modelName = sec.llamaModel || sec.llamaModelFile || (endpoint ? 'qwen7b' : undefined);

    const lines: string[] = [];
    const state = running ? '[RUNNING]' : '[INSTALLED — not started]';
    lines.push(`• Status: ${state} (Dedicated Second VM)`);
    if (modelName) lines.push(`• Model: ${modelName}`);
    if (endpoint) lines.push(`• Endpoint: ${endpoint}`);

    return {
      summary: lines.join('\n'),
      endpoint,
      modelName,
      running
    };
  }

  static async advanceFromSecondaryVm(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    const secondaryTarget = draft.secondarySshTarget;

    if (draft.skipLlamaProvisioning) {
      await OnboardingHandler.finalizeSetup(ctx);
      return;
    }

    if (!secondaryTarget) {
      await OnboardingHandler.showModelSelection(ctx);
      return;
    }

    const detected = await this.detectSecondaryLlama(ctx, secondaryTarget);
    if (!detected || !detected.running) {
      await OnboardingHandler.showModelSelection(ctx);
      return;
    }

    session.userMemory = session.userMemory || {};
    session.userMemory['onboarding:llama-existing'] = {
      summary: detected.summary,
      isSeparate: true,
      endpoint: detected.endpoint,
      modelName: detected.modelName,
      sshTarget: secondaryTarget
    };

    draft.llamaTopology = 'dedicated';
    draft.skipLlamaProvisioning = true;
    if (detected.endpoint) draft.activeEndpointUrl = detected.endpoint;
    if (detected.modelName) draft.modelName = detected.modelName;

    const text = `[Step 6/7] *Secondary VM Already Running*\n\n` +
      `Detected an existing llama.cpp setup on the Secondary VM:\n` +
      `${detected.summary}\n\n` +
      `Keep the existing setup and skip provisioning? (Default: Yes)`;
    await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildOnboardingSecondaryLlamaKeep());
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleKeepSecondaryLlama(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }

    if (draft.secondaryOnly) {
      await OnboardingHandler.finalizeSetup(ctx);
      return;
    }
    const { OnboardingIngressHandler } = await import('./onboardingIngressHandler.js');
    await OnboardingIngressHandler.showIngressChoice(ctx);
  }

  static async handleReconfigureSecondaryLlama(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    draft.skipLlamaProvisioning = false;
    draft.modelName = undefined;
    draft.activeEndpointUrl = undefined;
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
    await OnboardingHandler.showModelSelection(ctx);
  }

  static async handleKeepExistingLlama(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const detected = session.userMemory?.['onboarding:llama-existing'] as {
      isSeparate: boolean;
      endpoint?: string;
      modelName?: string;
      sshTarget?: string;
    } | undefined;
    session.onboardingDraft.llamaTopology = detected?.isSeparate ? 'dedicated' : 'same_vm';
    session.onboardingDraft.skipLlamaProvisioning = true;
    if (detected?.endpoint) {
      session.onboardingDraft.activeEndpointUrl = detected.endpoint;
    }
    if (detected?.modelName) {
      session.onboardingDraft.modelName = detected.modelName;
    }
    if (detected?.sshTarget) {
      session.onboardingDraft.secondarySshTarget = detected.sshTarget;
    }
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }

    if (detected?.isSeparate && !session.onboardingDraft.secondarySshTarget) {
      const secProv = ctx.config.secondaryProvider || ctx.config.provider;
      const storedSecKey = secProv === 'freestyle'
        ? ctx.config.secondaryFreestyleApiKey
        : ctx.config.secondaryDaytonaApiKey;

      if (storedSecKey) {
        await OnboardingHandler.updateWizard(ctx, `[PROBING] Connecting to Secondary VM using stored API key...`);
        const renewRes = await VmSshAutoRenewer.refreshSecondaryVmSsh(ctx.config);
        if (renewRes.renewed && ctx.config.secondarySshTarget) {
          session.onboardingDraft.secondarySshTarget = ctx.config.secondarySshTarget;
          session.onboardingDraft.secondaryProvider = ctx.config.secondaryProvider || secProv;
          session.onboardingDraft.secondaryApiKey = storedSecKey;
          if (ctx.config.freestyleSecondaryVmId || ctx.config.daytonaSecondaryWorkspaceId) {
            session.onboardingDraft.secondaryWorkspaceId = ctx.config.freestyleSecondaryVmId || ctx.config.daytonaSecondaryWorkspaceId;
          }
          if (ctx.config.freestyleLlamaSlug) {
            session.onboardingDraft.secondarySlug = ctx.config.freestyleLlamaSlug;
          }
          await OnboardingHandler.finalizeSetup(ctx);
          return;
        }
      }

      const text = `[Step 5/7] *Secondary VM Connection*\n\n` +
        `Llama is configured on a dedicated separate VM (\`${detected.endpoint || 'Remote Endpoint'}\`).\n` +
        `To enable local port forwarding (port 8080) and Control Panel terminal management, ` +
        `would you like to connect the Secondary VM?\n\n` +
        `1. *Cloud API Key* (Freestyle / Daytona)\n` +
        `2. *Direct SSH Target*\n` +
        `3. *Skip SSH* (Keep endpoint-only remote relay)`;
      const kb = InlineKeyboards.buildOnboardingSecondaryConnection();
      await OnboardingHandler.updateWizard(ctx, text, kb);
      return;
    }

    await OnboardingHandler.finalizeSetup(ctx);
  }

  static async promptSecondarySsh(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.awaitingField = 'secondarySshTarget';
    const text = `[Step 5/7] *Secondary VM SSH Target*\n\n` +
      `Please send your Secondary VM SSH connection string (e.g. \`openclaw-llama:token@beta-ssh.freestyle.sh\` or \`user@ssh.app.daytona.io\`):`;
    const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
    await OnboardingHandler.updateWizard(ctx, text, kb);
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleTopologySelect(ctx: BotContext, topo: 'dedicated' | 'same_vm' | 'cloud_only'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    draft.llamaTopology = topo;
    session.step = 6;

    if (topo === 'cloud_only') {
      draft.secondarySshTarget = '';
      draft.secondaryProvider = undefined;
      draft.secondaryWorkspaceId = undefined;
      draft.secondarySlug = undefined;
      draft.secondaryApiKey = undefined;
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      await OnboardingHandler.finalizeSetup(ctx);
      return;
    }

    if (topo === 'same_vm') {
      draft.secondarySshTarget = '';
      draft.secondaryProvider = undefined;
      draft.secondaryWorkspaceId = undefined;
      draft.secondarySlug = undefined;
      draft.secondaryApiKey = undefined;
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      await this.showModelSelection(ctx);
      return;
    }

    // dedicated topology
    if (draft.secondarySshTarget) {
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      await this.advanceFromSecondaryVm(ctx);
      return;
    }

    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
    const { OnboardingVmHandler } = await import('./onboardingVmHandler.js');
    await OnboardingVmHandler.handleSecondaryMethod(ctx);
  }

  static async showModelSelection(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 6;
    session.awaitingField = undefined;

    const text = `[Step 6/7] *Local LLM Inference Model*\n\n` +
      `Select a quantized GGUF model for llama-server:\n` +
      `1. *Qwen 2.5 7B MTP* (Recommended — 25-35 tok/s, 32k context, AVX-512)\n` +
      `2. *Qwen 2.5 14B Q4_0* (Requires 32GB Freestyle Disk)\n` +
      `3. *Custom Model* (Hugging Face Repo / GGUF URL)`;

    const kb = InlineKeyboards.buildOnboardingModel();
    await OnboardingHandler.updateWizard(ctx, text, kb);
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleModelSelect(ctx: BotContext, model: 'qwen7b' | 'qwen14b' | 'custom'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.onboardingDraft.modelType = model;
    session.step = 7;
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
    if (session.onboardingDraft.secondaryOnly) {
      await OnboardingHandler.finalizeSetup(ctx);
      return;
    }
    const { OnboardingIngressHandler } = await import('./onboardingIngressHandler.js');
    await OnboardingIngressHandler.showIngressChoice(ctx);
  }
}
