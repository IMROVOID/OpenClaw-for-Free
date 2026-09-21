import crypto from 'crypto';
import { InlineKeyboard } from 'grammy';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { RemoteProvisioner } from '../../control-panel/core/remoteProvisioner.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { sanitizeErrorMessage } from '../middleware/errorMiddleware.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingIngressHandler } from './onboardingIngressHandler.js';
import { BotContext } from '../types.js';

export class OnboardingFinalizer {
  static async finalizeSetup(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;

    if (session.flow === 'ingress_settings') {
      await OnboardingIngressHandler.complete(ctx);
      return;
    }

    if (!draft.secondaryOnly && draft.domainedUrlsEnabled &&
        (!OnboardingIngressHandler.normalizeDomain(draft.publicBaseDomain) ||
         !draft.ingressProvider || draft.ingressProvider === 'none' ||
         (draft.ingressProvider === 'railway' && !(draft.railwayApiKey || ctx.config.railwayApiKey || '').trim()))) {
      await OnboardingIngressHandler.complete(ctx);
      return;
    }

    if (!draft.secondaryOnly && draft.domainedUrlsEnabled === undefined) {
      await OnboardingIngressHandler.showIngressChoice(ctx);
      return;
    }

    await OnboardingHandler.updateWizard(ctx, `*Finalizing Setup & Bootstrapping Services...*\nApplying configuration and permissions...`);

    ctx.config.provider = draft.provider;
    if (draft.primarySshTarget) {
      ctx.config.primarySshTarget = draft.primarySshTarget;
      if (draft.primarySshTarget.includes(':')) {
        ctx.config.freestylePrimarySlug = draft.primarySshTarget.split(':')[0].replace(/^ssh\s+/i, '').trim();
      }
    }
    if (draft.primaryWorkspaceId) {
      if (draft.provider === 'daytona') ctx.config.daytonaPrimaryWorkspaceId = draft.primaryWorkspaceId;
      else ctx.config.freestylePrimaryVmId = draft.primaryWorkspaceId;
    }
    if (draft.primarySlug) {
      ctx.config.freestylePrimarySlug = draft.primarySlug;
    }
    if (draft.secondarySshTarget) {
      ctx.config.secondarySshTarget = draft.secondarySshTarget;
      ctx.config.llama.sshTarget = draft.secondarySshTarget;
      if (draft.secondarySshTarget.includes(':')) {
        ctx.config.freestyleLlamaSlug = draft.secondarySshTarget.split(':')[0].replace(/^ssh\s+/i, '').trim();
      }
    }
    const secProvider = draft.secondaryProvider || draft.provider;
    if (draft.secondaryWorkspaceId) {
      if (secProvider === 'daytona') ctx.config.daytonaSecondaryWorkspaceId = draft.secondaryWorkspaceId;
      else ctx.config.freestyleSecondaryVmId = draft.secondaryWorkspaceId;
    }
    if (draft.secondarySlug) {
      ctx.config.freestyleLlamaSlug = draft.secondarySlug;
    }
    if (draft.secondaryProvider) {
      ctx.config.secondaryProvider = draft.secondaryProvider;
    }
    if (draft.primaryApiKey) {
      if (draft.provider === 'freestyle') ctx.config.freestyleApiKey = draft.primaryApiKey;
      else ctx.config.daytonaApiKey = draft.primaryApiKey;
    }
    if (draft.secondaryApiKey) {
      if (secProvider === 'freestyle') ctx.config.secondaryFreestyleApiKey = draft.secondaryApiKey;
      else ctx.config.secondaryDaytonaApiKey = draft.secondaryApiKey;
    }
    if (draft.specs) ctx.config.vpsSpecs = draft.specs;
    if (draft.telegramToken) ctx.config.telegramBotToken = draft.telegramToken;
    if (draft.discordToken) ctx.config.discordBotToken = draft.discordToken;
    if (draft.railwayDomain) ctx.config.railwayDomain = draft.railwayDomain;
    if (draft.railwayUuid) ctx.config.railwayUuid = draft.railwayUuid;
    if (draft.railwayApiKey?.trim()) ctx.config.railwayApiKey = draft.railwayApiKey.trim();
    if (draft.domainedUrlsEnabled !== undefined) ctx.config.domainedUrlsEnabled = draft.domainedUrlsEnabled;
    if (draft.ingressProvider) ctx.config.ingressProvider = draft.ingressProvider;
    if (draft.publicBaseDomain) ctx.config.publicBaseDomain = draft.publicBaseDomain;
    if (draft.openclawToken) {
      ctx.config.openclawToken = draft.openclawToken;
    } else if (!ctx.config.openclawToken && ctx.config.primarySshTarget) {
      ctx.config.openclawToken = crypto.randomBytes(24).toString('hex');
    }

    ctx.config.llama.enabled = draft.llamaTopology !== 'cloud_only';
    ctx.config.llama.isSeparateVps = draft.llamaTopology === 'dedicated';
    if (draft.activeEndpointUrl) {
      ctx.config.llama.activeEndpointUrl = draft.activeEndpointUrl;
    }
    if (draft.modelName) {
      ctx.config.llama.modelName = draft.modelName;
    }

    ConfigManager.save(ctx.config, ctx.from?.id);

    let syncWarning: string | undefined;
    if (ctx.config.primarySshTarget && !draft.secondaryOnly) {
      try {
        const provRes = await RemoteProvisioner.execute(ctx.config, {
          skipLlamaProvisioning: draft.skipLlamaProvisioning,
          onProgress: async (_stage, detail) => {
            if (detail) {
              await OnboardingHandler.updateWizard(ctx, `*Finalizing Setup & Bootstrapping Services...*\n${detail}`);
            }
          }
        });
        if (!provRes.success || provRes.warnings.length > 0) {
          syncWarning = provRes.warnings.join('; ');
        }
      } catch (syncErr: unknown) {
        syncWarning = syncErr instanceof Error ? syncErr.message : String(syncErr);
        console.warn('[Onboarding Sync Warning]', syncWarning);
      }
    }

    BotSessionManager.clearFlow(ctx.chat!.id);

    const warnNotice = syncWarning
      ? `\n⚠️ *Sync Notice*: Daemon sync encountered a warning: \`${sanitizeErrorMessage(syncWarning)}\`\nYou can retry daemon sync from Service Manager.\n`
      : '';

    const doneText = `*OpenClaw Onboarding Complete!*\n\n` +
      `• *Provider*: ${ctx.config.provider.toUpperCase()}\n` +
      `• *Target*: \`${ctx.config.primarySshTarget}\`\n` +
      `• *Local LLM*: ${ctx.config.llama.enabled ? 'Enabled' : 'Cloud APIs Only'}\n` +
      warnNotice + `\n` +
      `All services are configured. Tap below to launch your Main Menu dashboard:`;

    const kb = new InlineKeyboard().text('Go to Main Menu', 'menu:back');
    await OnboardingHandler.updateWizard(ctx, doneText, kb);
  }
}
