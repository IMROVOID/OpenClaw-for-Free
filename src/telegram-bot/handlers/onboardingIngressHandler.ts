import crypto from 'crypto';
import { InlineKeyboard } from 'grammy';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { RailwayClient } from '../../control-panel/core/railwayClient.js';
import { RailwayHelper } from '../../control-panel/core/railwayHelper.js';
import { RailwayDomainManager } from '../../control-panel/core/railwayDomainManager.js';
import { WebIngressDeployer } from '../../control-panel/core/webIngressDeployer.js';
import { OpenclawConfigSyncer } from '../../control-panel/core/openclawConfigSyncer.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingFinalizer } from './onboardingFinalizer.js';
import { BotContext } from '../types.js';

export class OnboardingIngressHandler {
  static async startSettings(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.flow = 'ingress_settings';
    session.onboardingDraft = {
      provider: ctx.config.provider,
      primarySlug: ctx.config.freestylePrimarySlug,
      railwayApiKey: ctx.config.railwayApiKey
    };
    await this.showIngressChoice(ctx);
  }

  static async handleSettingsNavigation(ctx: BotContext, action: 'back' | 'cancel'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'ingress_settings') return;
    BotSessionManager.clearFlow(ctx.chat!.id);
    await OnboardingHandler.updateWizard(ctx,
      action === 'cancel' ? 'WebUI Access Settings cancelled. No changes saved.' : 'WebUI Access Settings closed. No changes saved.',
      new InlineKeyboard().text('Main Menu', 'menu:back'));
  }

  static normalizeDomain(value?: string, defaultSuffix?: string): string | undefined {
    return RailwayDomainManager.normalizeDomain(value, defaultSuffix);
  }

  static async showIngressChoice(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 7;
    session.awaitingField = undefined;
    const text = '*WebUI Access Settings*\n\n' +
      'Choose a configured domain or port forwarding for your WebUIs.\n' +
      'Railway domains will be automatically deployed with the unified web-relay service.';
    await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildOnboardingIngressChoice());
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleIngressSelect(ctx: BotContext, mode: 'port_forward' | 'domained'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'onboarding' && session.flow !== 'ingress_settings') return;
    if (mode !== 'port_forward' && mode !== 'domained') return;
    const draft = session.onboardingDraft;
    session.awaitingField = undefined;
    delete draft.publicBaseDomain;
    delete draft.ingressProvider;
    delete draft.railwayApiKey;
    draft.domainedUrlsEnabled = mode === 'domained';
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
    if (mode === 'port_forward') {
      draft.ingressProvider = 'none';
      await this.complete(ctx);
      return;
    }
    await OnboardingHandler.updateWizard(ctx,
      '*Select Ingress Domain Provider*\n\nChoose the hosting provider for your configured domain. No domain will be provisioned or verified.',
      InlineKeyboards.buildOnboardingDomainProvider(draft.provider === 'freestyle' ? 'freestyle' : 'daytona'));
  }

  static async handleDomainProviderSelect(ctx: BotContext, provider: 'freestyle' | 'railway'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'onboarding' && session.flow !== 'ingress_settings') return;
    const draft = session.onboardingDraft;
    if (!draft.domainedUrlsEnabled || (provider !== 'freestyle' && provider !== 'railway')) return;
    if (provider === 'freestyle' && draft.provider !== 'freestyle') return;
    draft.ingressProvider = provider;
    delete draft.publicBaseDomain;
    delete draft.railwayApiKey;
    if (provider !== 'railway') {
      if (session.flow === 'onboarding' && provider === 'freestyle') {
        const domain = this.normalizeDomain(draft.primarySlug ? `${draft.primarySlug}.style.dev` : undefined);
        if (domain) {
          draft.publicBaseDomain = domain;
          await this.complete(ctx);
          return;
        }
      }
      session.awaitingField = 'customBaseDomain';
      await this.promptDomain(ctx);
      return;
    }

    const savedKey = (draft.railwayApiKey || ctx.config.railwayApiKey || '').trim();
    if (savedKey) {
      const masked = savedKey.slice(0, 4) + '••••••••' + savedKey.slice(-4);
      const kb = new InlineKeyboard()
        .text('Use Saved Key', 'onboard:dom:railway:use_saved')
        .text('Enter New Key', 'onboard:dom:railway:enter_new')
        .row()
        .text('< Back', 'onboard:back')
        .text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx,
        `*Railway API Token*\n\nSaved Railway API token found:\n\`${masked}\`\n\nWould you like to use this token or enter a new one?`,
        kb);
      return;
    }

    session.awaitingField = 'railwayApiKey';
    await OnboardingHandler.updateWizard(ctx,
      '*Railway API Token*\n\nSend the Railway API token from https://railway.com/account/tokens. ' +
      'It is used to automatically deploy and configure the Web Relay service in your Railway account.');
  }

  static async handleRailwayKeyChoice(ctx: BotContext, choice: 'use_saved' | 'enter_new'): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (choice === 'use_saved') {
      session.onboardingDraft.railwayApiKey = ctx.config.railwayApiKey;
      await this.promptDomain(ctx);
    } else {
      session.awaitingField = 'railwayApiKey';
      await OnboardingHandler.updateWizard(ctx,
        '*Railway API Token*\n\nSend the new Railway API token from https://railway.com/account/tokens.');
    }
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async promptDomain(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    const apiKey = (draft.railwayApiKey || ctx.config.railwayApiKey || '').trim();
    if (draft.ingressProvider === 'railway' && !apiKey) {
      session.awaitingField = 'railwayApiKey';
      await OnboardingHandler.updateWizard(ctx,
        '*Railway API Token*\n\nSend the Railway API token from https://railway.com/account/tokens. ' +
        'It is used to fetch the public Web Relay domain already connected to this account. ' +
        'This step does not create Railway resources.');
      return;
    }
    const connected = await this.resolveConnectedWebRelay(ctx);
    if (connected.suggestedDomain && !draft.publicBaseDomain) {
      draft.publicBaseDomain = connected.suggestedDomain;
    }
    session.awaitingField = 'customBaseDomain';

    let egressNotice = '';
    if (connected.onlyEgressFound) {
      egressNotice = `\n\n⚠️ *No Web Relay Found*: Found only Egress Relay (\`${connected.egressDomain}\`), which cannot serve WebUI (returns 404). Please deploy \`relay/railway-web-relay\` or enter a Web Relay domain.`;
    }

    const example = connected.suggestedDomain
      ? `\n\nConnected Railway domain default: \`${connected.suggestedDomain}\`\nExample: \`${connected.suggestedDomain}\` or \`web-relay\``
      : '\n\nExample: `web-relay` or `web-relay.up.railway.app`';
    await OnboardingHandler.updateWizard(ctx,
      `*WebUI Domain*\n\nEnter the Web Relay subdomain or domain (e.g. \`web-relay\` or \`web-relay.up.railway.app\`). The bot will verify availability and automatically deploy the unified web-relay service.${egressNotice}${example}`,
      new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel'));
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handlePickDomain(ctx: BotContext, subdomain: string): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'ingress_settings' && session.flow !== 'onboarding') return;
    const domain = this.normalizeDomain(subdomain, 'up.railway.app');
    if (!domain) return;
    session.onboardingDraft.publicBaseDomain = domain;
    session.awaitingField = undefined;
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
    await this.complete(ctx);
  }

  static async handleRedeployDomain(ctx: BotContext, domain: string): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'ingress_settings' && session.flow !== 'onboarding') return;
    const cleanDomain = this.normalizeDomain(domain);
    if (!cleanDomain) return;
    session.onboardingDraft.publicBaseDomain = cleanDomain;
    session.awaitingField = undefined;
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
    await this.complete(ctx);
  }

  static async resolveConnectedWebRelay(ctx: BotContext): Promise<{ suggestedDomain?: string; onlyEgressFound?: boolean; egressDomain?: string }> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    const apiKey = (draft.railwayApiKey || ctx.config.railwayApiKey || '').trim();
    if (!apiKey) return {};
    const [validation, relays] = await Promise.all([
      RailwayHelper.validateApiKey(apiKey),
      RailwayClient.listExistingRelays(apiKey)
    ]);
    if (!validation.valid) return {};
    const webRelay = RailwayHelper.findWebRelay(relays);
    const egressRelay = relays.find(r => RailwayHelper.isEgressRelayCandidate(r));
    return {
      suggestedDomain: webRelay?.domain,
      onlyEgressFound: !webRelay && !!egressRelay,
      egressDomain: egressRelay?.domain
    };
  }

  static async handleTextInput(ctx: BotContext, text: string): Promise<boolean> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'ingress_settings' && session.flow !== 'onboarding') return false;
    if (session.awaitingField === 'railwayApiKey') {
      if (ctx.message) {
        try { await ctx.deleteMessage(); } catch (_) {}
      }
      const apiKey = text.trim();
      if (!apiKey) {
        await OnboardingHandler.updateWizard(ctx,
          '*Railway API Token*\n\nA Railway API token is required before entering the Web Relay domain. ' +
          'Send the token from https://railway.com/account/tokens.');
        return true;
      }
      const validation = await RailwayHelper.validateApiKey(apiKey);
      if (!validation.valid) {
        await OnboardingHandler.updateWizard(ctx,
          `*Railway API Token*\n\nRailway token was invalid${validation.error ? `: ${validation.error}` : ''}. Send another token.`);
        return true;
      }
      session.onboardingDraft.railwayApiKey = apiKey;
      ctx.config.railwayApiKey = apiKey;
      await this.promptDomain(ctx);
      return true;
    }
    if (session.awaitingField !== 'customBaseDomain') return false;
    const defaultSuffix = session.onboardingDraft.ingressProvider === 'freestyle' ? 'style.dev' : 'up.railway.app';
    const domain = this.normalizeDomain(text, defaultSuffix);
    if (!domain) {
      await OnboardingHandler.updateWizard(ctx,
        'Invalid domain format. Enter a valid subdomain or hostname (e.g. `web-relay` or `web-relay.up.railway.app`):',
        new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel'),
        true);
      return true;
    }
    if (/egress/i.test(domain)) {
      await OnboardingHandler.updateWizard(ctx,
        `⚠️ *Cannot use Egress Relay for WebUI*\n\n\`${domain}\` is an Egress Relay. Egress Relays only proxy outbound traffic and return 404 for WebUI requests.\n\nPlease enter the Web Relay domain (or deploy \`relay/railway-web-relay\` on Railway):`,
        new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel'),
        true);
      return true;
    }

    const apiKey = (session.onboardingDraft.railwayApiKey || ctx.config.railwayApiKey || '').trim();
    if (session.onboardingDraft.ingressProvider === 'railway' && apiKey) {
      const avail = await RailwayDomainManager.checkDomainAvailability(apiKey, domain);
      const currentDomain = RailwayDomainManager.normalizeDomain(ctx.config.publicBaseDomain);
      const isCurrentDomain = Boolean(currentDomain && domain === currentDomain);
      if (avail.isOccupied && !isCurrentDomain && !avail.isUserOwned) {
        const recs = await RailwayDomainManager.getAvailableRecommendations(apiKey, domain, 3);
        const kb = new InlineKeyboard();
        kb.text(`🔄 Redeploy to ${domain}`, `onboard:dom:redeploy:${domain}`).row();
        for (const rec of recs) {
          const sub = RailwayDomainManager.extractSubdomain(rec);
          kb.text(`👉 ${sub}`, `onboard:dom:pick:${sub}`).row();
        }
        kb.text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');

        const recList = recs.map((r, i) => `${i + 1}. \`${r}\``).join('\n');
        await OnboardingHandler.updateWizard(ctx,
          `⚠️ *Domain Registered on Railway*\n\n\`${domain}\` is currently registered on Railway.\n\nIf this is your existing Web Relay, tap *Redeploy* below to update it. Otherwise, enter another subdomain or choose one of these available recommendations:\n\n${recList}`,
          kb,
          true);
        return true;
      }
    }

    session.onboardingDraft.publicBaseDomain = domain;
    session.awaitingField = undefined;
    if (session.onboardingDraft.ingressProvider === 'railway' && !apiKey) {
      session.awaitingField = 'railwayApiKey';
      await OnboardingHandler.updateWizard(ctx,
        '*Railway API Token*\n\nSend the Railway API token from https://railway.com/account/tokens before saving this Web Relay domain.',
        undefined,
        true);
      return true;
    }
    await this.complete(ctx);
    return true;
  }

  static async complete(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    if (draft.domainedUrlsEnabled === undefined) {
      await this.showIngressChoice(ctx);
      return;
    }
    const domain = this.normalizeDomain(draft.publicBaseDomain);
    if (draft.domainedUrlsEnabled && (!domain || !draft.ingressProvider || draft.ingressProvider === 'none')) {
      if (!draft.ingressProvider || draft.ingressProvider === 'none') await this.handleIngressSelect(ctx, 'domained');
      else await this.promptDomain(ctx);
      return;
    }
    if (session.flow === 'onboarding') {
      await OnboardingFinalizer.finalizeSetup(ctx);
      return;
    }
    if (session.flow !== 'ingress_settings') return;
    const config = {
      ...ctx.config,
      domainedUrlsEnabled: draft.domainedUrlsEnabled,
      ingressProvider: draft.domainedUrlsEnabled ? draft.ingressProvider : 'none' as const
    };
    const railwayApiKey = draft.railwayApiKey?.trim() || ctx.config.railwayApiKey;
    if (railwayApiKey) config.railwayApiKey = railwayApiKey;
    else delete config.railwayApiKey;
    delete config.customOpenclawUrl;
    delete config.customOmnirouteUrl;
    delete config.customLlamaUrl;
    if (draft.domainedUrlsEnabled) config.publicBaseDomain = domain;
    else delete config.publicBaseDomain;

    if (!config.openclawToken && config.primarySshTarget) {
      config.openclawToken = crypto.randomBytes(24).toString('hex');
    }

    ConfigManager.save(config, ctx.from?.id);
    ctx.config = config;
    BotSessionManager.clearFlow(ctx.chat!.id);

    let statusText = 'WebUI Access Settings saved.';
    if (draft.domainedUrlsEnabled && domain) {
      if (draft.ingressProvider === 'freestyle' && config.primarySshTarget) {
        const deployRes = await WebIngressDeployer.deploy(config.primarySshTarget, domain);
        statusText += deployRes.success
          ? `\n\n• *Domain*: \`${domain}\`\n• *Ingress*: Caddy deployed and active on VPS.`
          : `\n\n• *Domain*: \`${domain}\`\n• *Ingress Notice*: ${deployRes.message}`;
      } else if (draft.ingressProvider === 'railway') {
        if (railwayApiKey) {
          try {
            await OnboardingHandler.updateWizard(ctx,
              `⏳ *Deploying / Redeploying Railway Web Relay...*\nConfiguring upstream routes and deploying \`relay/railway-web-relay\` to Railway...`,
              undefined,
              true);
            const deployRes = await WebIngressDeployer.deployRailwayWebRelay({
              apiKey: railwayApiKey,
              domain,
              primaryWorkspaceId: config.daytonaPrimaryWorkspaceId,
              secondaryWorkspaceId: config.daytonaSecondaryWorkspaceId,
              forceRedeploy: true
            });
            if (deployRes.success) {
              await new Promise(r => setTimeout(r, 2000));
              const recheck = await WebIngressDeployer.verify(domain, '/health');
              statusText += `\n\n• *Domain*: \`${domain}\`\n• *Railway Deployment*: 🟢 Deployed/Redeployed successfully.\n• *Status*: ${recheck.reachable ? '🟢 Verified & Reachable' : '🟡 Initializing (DNS/TLS propagating)'}`;
            } else {
              statusText += `\n\n• *Domain*: \`${domain}\`\n• *Railway Deployment Notice*: ${deployRes.message}`;
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            statusText += `\n\n• *Domain*: \`${domain}\`\n• *Railway Deployment Warning*: \`${msg}\``;
          }
        } else {
          const v = await WebIngressDeployer.verify(domain, '/health');
          statusText += `\n\n• *Domain*: \`${domain}\`\n• *Verification*: ${v.reachable ? '🟢 Verified & Reachable' : `🔴 Unreachable (${v.message || 'Check domain routing'})`}`;
        }
      }
    } else {
      statusText += '\n\n• *Mode*: Local SSH Port Forwarding.\nRun `ssh -N -L 18789:127.0.0.1:18789 <vps>` and open `http://127.0.0.1:18789` in your browser.';
    }

    await OnboardingHandler.updateWizard(ctx,
      statusText,
      new InlineKeyboard().text('Main Menu', 'menu:back'),
      true);
  }
}
