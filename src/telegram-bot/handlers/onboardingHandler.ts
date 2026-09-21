import crypto from 'crypto';
import { InlineKeyboard } from 'grammy';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { VpsProviderFactory } from '../../control-panel/core/vpsProviderDriver.js';
import { VpsConfigDetector } from '../../control-panel/core/vpsConfigDetector.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { OnboardingVmHandler } from './onboardingVmHandler.js';
import { OnboardingChannelsHandler } from './onboardingChannelsHandler.js';
import { OnboardingLlamaHandler } from './onboardingLlamaHandler.js';
import { OnboardingFinalizer } from './onboardingFinalizer.js';
import { OnboardingIngressHandler } from './onboardingIngressHandler.js';
import { sanitizeErrorMessage } from '../middleware/errorMiddleware.js';
import { BotContext } from '../types.js';

export class OnboardingHandler {
  static async updateWizard(ctx: BotContext, text: string, kb?: InlineKeyboard, forceNewMessage = false): Promise<void> {
    const session = ctx.chat ? BotSessionManager.getSession(ctx.chat.id) : undefined;
    const msgId = session?.lastMenuMessageId ?? ctx.callbackQuery?.message?.message_id;

    if (!forceNewMessage && msgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, msgId, text, { parse_mode: 'Markdown', reply_markup: kb });
        if (session) session.lastMenuMessageId = msgId;
        return;
      } catch (err: any) {
        if (err?.description?.includes('entities')) {
          try {
            await ctx.api.editMessageText(ctx.chat.id, msgId, text.replace(/[*_`\[\]]/g, ''), { reply_markup: kb });
            if (session) session.lastMenuMessageId = msgId;
            return;
          } catch (_) {}
        }
      }
    }

    if (!forceNewMessage && ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
        if (session) session.lastMenuMessageId = ctx.callbackQuery.message?.message_id;
        return;
      } catch (err: any) {
        if (err?.description?.includes('entities')) {
          try {
            await ctx.editMessageText(text.replace(/[*_`\[\]]/g, ''), { reply_markup: kb });
            if (session) session.lastMenuMessageId = ctx.callbackQuery.message?.message_id;
            return;
          } catch (_) {}
        }
      }
    }

    try {
      const sent = await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
      if (session) session.lastMenuMessageId = sent.message_id;
    } catch (_) {
      const sent = await ctx.reply(text.replace(/[*_`\[\]]/g, ''), { reply_markup: kb });
      if (session) session.lastMenuMessageId = sent.message_id;
    }
  }

  static async startOnboarding(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.startOnboarding(ctx.chat!.id);
    session.onboardingDraft.provider = ctx.config.provider || 'freestyle';

    const text = `*OpenClaw Multi-Cloud Onboarding Setup Assistant*\n\n` +
      `[Step 1/7] *Select Cloud VPS Provider*:\n` +
      `• *Freestyle.sh*: 32GB Storage, Unrestricted Direct Egress (Recommended)\n` +
      `• *Daytona Cloud*: 10GB Storage, Hypervisor Firewall (Requires Railway Relay)`;

    const kb = InlineKeyboards.buildOnboardingProvider();
    await this.updateWizard(ctx, text, kb);
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleProviderSelect(ctx: BotContext, provider: 'freestyle' | 'daytona'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.onboardingDraft.provider = provider;
    session.step = 2;
    session.awaitingField = undefined;

    const text = `[Step 2/7] *Primary VM Setup (${provider.toUpperCase()})*\n\n` +
      `Choose how you would like to connect:\n` +
      `1. *API Key Automation*: Auto-provision or select sandbox workspace.\n` +
      `2. *Direct SSH Target*: Enter existing SSH command or user@host.`;

    const kb = InlineKeyboards.buildOnboardingProvisionMethod();
    await this.updateWizard(ctx, text, kb);
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  }

  static async handleMethodSelect(ctx: BotContext, method: 'api' | 'ssh'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.onboardingDraft.primaryMethod = method;
    const kb = new InlineKeyboard().text('< Back', 'onboard:step:1').text('Cancel', 'onboard:cancel');

    if (method === 'api') {
      session.awaitingField = 'primaryApiKey';
      const prompt = session.onboardingDraft.provider === 'freestyle'
        ? `[Step 2/7] Please send your *Freestyle.sh API Key* (from dashboard settings):`
        : `[Step 2/7] Please send your *Daytona API Key* (from app.daytona.io/settings/keys):`;
      await this.updateWizard(ctx, prompt, kb);
    } else {
      session.awaitingField = 'primarySshTarget';
      const prompt = `[Step 2/7] Please send your *SSH connection string* (e.g. \`user@ssh.app.daytona.io\`):`;
      await this.updateWizard(ctx, prompt, kb);
    }
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  }

  static async handleTextInput(ctx: BotContext, text: string): Promise<boolean> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'onboarding' || !session.awaitingField) return false;

    if (ctx.message) {
      try { await ctx.deleteMessage(); } catch (_) {}
    }

    const field = session.awaitingField;
    const clean = text.trim();

    if (field === 'primaryApiKey') {
      const provider = session.onboardingDraft.provider;
      const driver = VpsProviderFactory.getDriver(provider);
      await this.updateWizard(ctx, `[PROBING] Validating ${provider.toUpperCase()} API key...`);

      const val = await driver.validateApiKey(clean);
      if (!val.valid) {
        const safeError = sanitizeErrorMessage(val.error || 'Invalid API Key');
        const kb = new InlineKeyboard().text('< Back', 'onboard:step:1').text('Cancel', 'onboard:cancel');
        await this.updateWizard(ctx, `[ERROR] Validation failed: ${safeError}.\n\nPlease send a valid key or tap Cancel:`, kb);
        return true;
      }
      session.onboardingDraft.primaryApiKey = clean;
      session.awaitingField = undefined;
      await OnboardingVmHandler.handleShowVmChoice(ctx, 'primary');
      return true;
    }

    if (field === 'secondaryApiKey') {
      const provider = session.onboardingDraft.secondaryProvider || session.onboardingDraft.provider;
      const driver = VpsProviderFactory.getDriver(provider);
      await this.updateWizard(ctx, `[PROBING] Validating ${provider.toUpperCase()} API key...`);

      const val = await driver.validateApiKey(clean);
      if (!val.valid) {
        const safeError = sanitizeErrorMessage(val.error || 'Invalid API Key');
        const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
        await this.updateWizard(ctx, `[ERROR] Validation failed: ${safeError}.\n\nPlease send a valid key or tap Cancel:`, kb);
        return true;
      }
      session.onboardingDraft.secondaryApiKey = clean;
      session.awaitingField = undefined;
      if (session.userMemory) delete session.userMemory['onboarding:workspaces:secondary'];
      await OnboardingVmHandler.handleShowVmChoice(ctx, 'secondary');
      return true;
    }

    if (field === 'secondarySshTarget') {
      const target = ConfigManager.parseSshTarget(clean, clean, session.onboardingDraft.secondaryProvider || session.onboardingDraft.provider);
      session.onboardingDraft.secondarySshTarget = target;
      session.awaitingField = undefined;
      if (session.onboardingDraft.skipLlamaProvisioning) {
        await OnboardingFinalizer.finalizeSetup(ctx);
      } else {
        await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx);
      }
      return true;
    }

    if (field === 'primarySshTarget') {
      const target = ConfigManager.parseSshTarget(clean, clean, session.onboardingDraft.provider);
      session.onboardingDraft.primarySshTarget = target;
      session.awaitingField = undefined;
      await this.advanceToStep3(ctx);
      return true;
    }

    if (field === 'botTokens') {
      if (clean.toLowerCase() !== 'skip') {
        session.onboardingDraft.telegramToken = clean;
      }
      session.awaitingField = undefined;
      await OnboardingLlamaHandler.advanceToStep5(ctx);
      return true;
    }

    if (field === 'customBaseDomain' || field === 'railwayApiKey') {
      return OnboardingIngressHandler.handleTextInput(ctx, clean);
    }

    return false;
  }

  static async advanceToStep3(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    session.step = 3;
    session.awaitingField = undefined;

    const target = draft.primarySshTarget;
    if (!target) {
      await this.showMethodSelect(ctx);
      return;
    }

    await this.updateWizard(ctx, `[PROBING] Connecting to VPS (${target})...\nQuerying system hardware and inspecting existing containers...`);
    const detected = await VpsConfigDetector.inspect(target);
    const driver = VpsProviderFactory.getDriver(draft.provider);
    const specs = await driver.detectHardware(target);
    session.onboardingDraft.specs = specs;

    session.userMemory = session.userMemory || {};
    session.userMemory['onboarding:vm-detected'] = detected;

    if (detected.railwayDomain) session.onboardingDraft.railwayDomain = detected.railwayDomain;
    if (detected.railwayUuid) session.onboardingDraft.railwayUuid = detected.railwayUuid;
    if (detected.openclawToken) {
      session.onboardingDraft.openclawToken = detected.openclawToken;
    } else if (!ctx.config.openclawToken) {
      session.onboardingDraft.openclawToken = crypto.randomBytes(24).toString('hex');
    }

    const openclawStatus = detected.openclawInstalled ? 'DETECTED' : 'NEEDED (Fresh Install)';
    const omnirouteStatus = detected.omnirouteInstalled ? 'DETECTED' : 'NEEDED (Fresh Install)';
    const relayStatus = detected.railwayRelayConfigured ? '• *Railway Relay*: DETECTED\n' : '';

    const text = `[Step 3/7] *Hardware Probe & Service Discovery*\n\n` +
      `• *Specs*: ${specs.cpuCores} vCPU | ${specs.ramGb} GB RAM | ${specs.storageGb} GB Disk\n` +
      `• *OpenClaw*: ${openclawStatus}\n` +
      `• *OmniRoute*: ${omnirouteStatus}\n` +
      relayStatus +
      `\nReady to configure messaging channels.`;

    const kb = new InlineKeyboard()
      .text('Continue to Step 4 >', 'onboard:step3:next')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');

    await this.updateWizard(ctx, text, kb);
  }

  static async handleBack(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }

    const field = session.awaitingField;
    if (draft.secondaryOnly && session.step <= 6) {
      session.step = 6;
      session.awaitingField = undefined;
      await OnboardingVmHandler.handleSecondaryMethod(ctx);
      return;
    }
    if (field === 'primaryApiKey' || field === 'primarySshTarget') {
      await this.showMethodSelect(ctx);
      return;
    }
    if (field === 'secondaryApiKey' || field === 'secondarySshTarget') {
      if (draft.skipLlamaProvisioning) {
        await OnboardingLlamaHandler.handleKeepExistingLlama(ctx);
        return;
      }
      await OnboardingVmHandler.handleSecondaryMethod(ctx);
      return;
    }
    if (field === 'botTokens' || session.step === 4) {
      await this.advanceToStep3(ctx);
      return;
    }
    if (session.step === 3) {
      await this.showMethodSelect(ctx);
      return;
    }
    if (session.step === 5) {
      await OnboardingChannelsHandler.showBotChannels(ctx);
      return;
    }
    if (session.step === 6) {
      await OnboardingLlamaHandler.showLlamaTopology(ctx);
      return;
    }
    if (session.step === 7) {
      await OnboardingLlamaHandler.showModelSelection(ctx);
      return;
    }
    if (session.step === 2 && (draft.primaryApiKey || draft.primarySshTarget)) {
      await this.showMethodSelect(ctx);
      return;
    }
    await this.showProviderSelect(ctx);
  }

  static async showProviderSelect(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.flow = 'onboarding';
    session.step = 1;
    session.awaitingField = undefined;
    session.onboardingDraft.provider = session.onboardingDraft.provider || ctx.config.provider || 'freestyle';

    const text = `*OpenClaw Multi-Cloud Onboarding Setup Assistant*\n\n` +
      `[Step 1/7] *Select Cloud VPS Provider*:\n` +
      `• *Freestyle.sh*: 32GB Storage, Unrestricted Direct Egress (Recommended)\n` +
      `• *Daytona Cloud*: 10GB Storage, Hypervisor Firewall (Requires Railway Relay)`;

    await this.updateWizard(ctx, text, InlineKeyboards.buildOnboardingProvider());
  }

  static async showMethodSelect(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 2;
    session.awaitingField = undefined;
    const provider = session.onboardingDraft.provider || 'freestyle';

    const text = `[Step 2/7] *Primary VM Setup (${provider.toUpperCase()})*\n\n` +
      `Choose how you would like to connect:\n` +
      `1. *API Key Automation*: Auto-provision or select sandbox workspace.\n` +
      `2. *Direct SSH Target*: Enter existing SSH command or user@host.`;

    await this.updateWizard(ctx, text, InlineKeyboards.buildOnboardingProvisionMethod());
  }

  static advanceToStep5: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingLlamaHandler.advanceToStep5(ctx);
  static showLlamaTopology: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingLlamaHandler.showLlamaTopology(ctx);
  static detectExistingLlama = (ctx: BotContext) => OnboardingLlamaHandler.detectExistingLlama(ctx);
  static handleKeepExistingLlama: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingLlamaHandler.handleKeepExistingLlama(ctx);
  static promptSecondarySsh: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingLlamaHandler.promptSecondarySsh(ctx);
  static handleTopologySelect: (ctx: BotContext, topo: 'dedicated' | 'same_vm' | 'cloud_only') => Promise<void> = (ctx, t) => OnboardingLlamaHandler.handleTopologySelect(ctx, t);
  static showModelSelection: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingLlamaHandler.showModelSelection(ctx);
  static handleModelSelect: (ctx: BotContext, model: 'qwen7b' | 'qwen14b' | 'custom') => Promise<void> = (ctx, m) => OnboardingLlamaHandler.handleModelSelect(ctx, m);
  static showBotChannels: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingChannelsHandler.showBotChannels(ctx);
  static handleKeepChannels: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingChannelsHandler.handleKeepChannels(ctx);
  static handleEnterChannels: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingChannelsHandler.handleEnterChannels(ctx);
  static finalizeSetup: (ctx: BotContext) => Promise<void> = (ctx) => OnboardingFinalizer.finalizeSetup(ctx);
}

