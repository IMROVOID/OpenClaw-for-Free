import { InlineKeyboard } from 'grammy';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { RailwayClient } from '../../control-panel/core/railwayClient.js';
import { RailwayHelper } from '../../control-panel/core/railwayHelper.js';
import { RailwaySafetyGuard } from '../../control-panel/core/railwaySafetyGuard.js';
import { RelayDeployer } from '../../control-panel/core/relayDeployer.js';
import { EndpointResolver } from '../../control-panel/core/endpointResolver.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingIngressHandler } from './onboardingIngressHandler.js';
import { RelayKeyboards } from '../keyboards/relayKeyboards.js';
import { BotContext } from '../types.js';

export class RelaySettingsHandler {
  static async showSettings(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.flow = 'ingress_settings';
    session.awaitingField = undefined;

    const text = '*Relays & Domain Settings*\n\n' +
      'Manage cloud relays and ingress domains for your assistant:\n\n' +
      '• *1. WebUI Ingress Domain*: Public browser access for OpenClaw, OmniRoute, and LLaMA WebUIs.\n' +
      '• *2. Gateway Relay*: VLESS/WS egress tunnel on Daytona VM (Required for Discord, Telegram & AI API outbound connections).\n' +
      '• *3. LLaMA AI Relay*: High-performance OpenAI-compatible streaming proxy for remote models.\n' +
      '• *4. Railway API Token*: Shared across all Railway relays with automated anti-abuse protection.';

    await OnboardingHandler.updateWizard(ctx, text, RelayKeyboards.buildRelaySettingsMenu(ctx.config));
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleGateway(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const apiKey = (ctx.config.railwayApiKey || '').trim();

    if (!apiKey) {
      session.awaitingField = 'gatewayRailwayToken';
      await OnboardingHandler.updateWizard(ctx,
        '*Railway API Token Required*\n\n' +
        'A Railway API token is needed to automatically discover your Gateway Egress Relays.\n' +
        'Please send your token from https://railway.com/account/tokens (or type `skip` to enter a domain manually):',
        new InlineKeyboard().text('< Back', 'menu:relay-settings'));
      return;
    }

    const safety = RailwaySafetyGuard.isRestricted(apiKey);
    if (safety.restricted) {
      await OnboardingHandler.updateWizard(ctx,
        `⚠️ *Railway Safety Cooldown Active*\n\n${safety.reason || 'Restricted'}. Automated requests halted to protect your account.\n\nEnter your Gateway domain manually:`,
        new InlineKeyboard().text('< Back', 'menu:relay-settings'));
      session.awaitingField = 'gatewayDomain';
      return;
    }

    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery({ text: 'Discovering relays from Railway...' }); } catch (_) {}
    }

    const relays = await RailwayClient.listExistingRelays(apiKey);
    const candidates = relays.filter((r) => RailwayHelper.isEgressRelayCandidate(r));
    const listToShow = candidates.length > 0 ? candidates : relays;

    if (listToShow.length > 0) {
      await OnboardingHandler.updateWizard(ctx,
        '*Select Gateway (Egress) Relay*\n\n' +
        'Select a discovered relay from your Railway account, or enter a custom domain:',
        RelayKeyboards.buildRelayPickerKeyboard(listToShow, 'gateway'));
    } else {
      session.awaitingField = 'gatewayDomain';
      await OnboardingHandler.updateWizard(ctx,
        '*Enter Gateway (Egress) Relay Domain*\n\n' +
        'No active relays found in your Railway account.\n' +
        'Enter the domain (e.g. `egress-relay-production.up.railway.app`):',
        new InlineKeyboard().text('< Back', 'menu:relay-settings'));
    }
  }

  static async handleLlama(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const apiKey = (ctx.config.railwayApiKey || '').trim();

    if (!apiKey) {
      session.awaitingField = 'llamaRailwayToken';
      await OnboardingHandler.updateWizard(ctx,
        '*Railway API Token Required*\n\n' +
        'A Railway API token is needed to discover your LLaMA streaming relays.\n' +
        'Please send your token from https://railway.com/account/tokens (or type `skip` to enter a URL manually):',
        new InlineKeyboard().text('< Back', 'menu:relay-settings'));
      return;
    }

    const safety = RailwaySafetyGuard.isRestricted(apiKey);
    if (safety.restricted) {
      await OnboardingHandler.updateWizard(ctx,
        `⚠️ *Railway Safety Cooldown Active*\n\n${safety.reason || 'Restricted'}. Automated requests halted to protect your account.\n\nEnter your LLaMA relay URL manually:`,
        new InlineKeyboard().text('< Back', 'menu:relay-settings'));
      session.awaitingField = 'llamaRelayUrl';
      return;
    }

    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery({ text: 'Discovering relays from Railway...' }); } catch (_) {}
    }

    const relays = await RailwayClient.listExistingRelays(apiKey);
    const candidates = relays.filter((r) => r.isLlama);
    const listToShow = candidates.length > 0 ? candidates : relays;

    if (listToShow.length > 0) {
      await OnboardingHandler.updateWizard(ctx,
        '*Select LLaMA AI Relay*\n\n' +
        'Select a discovered relay from your Railway account, or enter a custom URL:',
        RelayKeyboards.buildRelayPickerKeyboard(listToShow, 'llama'));
    } else {
      session.awaitingField = 'llamaRelayUrl';
      await OnboardingHandler.updateWizard(ctx,
        '*Enter LLaMA AI Relay Endpoint*\n\n' +
        'Enter the full HTTPS URL or subdomain (e.g. `llama-relay.up.railway.app`):',
        new InlineKeyboard().text('< Back', 'menu:relay-settings'));
    }
  }

  static async handleToken(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.awaitingField = 'railwayToken';
    const current = (ctx.config.railwayApiKey || '').trim();
    const masked = current ? `${current.slice(0, 4)}••••••••${current.slice(-4)}` : 'None';

    await OnboardingHandler.updateWizard(ctx,
      `*Railway API Token*\n\n` +
      `Current Token: \`${masked}\`\n\n` +
      `This token is used for WebUI Ingress, Gateway Egress Relays, and LLaMA streaming proxies.\n` +
      `Send a new token from https://railway.com/account/tokens to update:`,
      new InlineKeyboard().text('< Back', 'menu:relay-settings'));
  }

  static async handlePickRelay(ctx: BotContext, type: 'gateway' | 'llama', value: string): Promise<void> {
    if (type === 'gateway') {
      const cleanDomain = value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      ctx.config.railwayDomain = cleanDomain;
      this.saveConfig(ctx);

      let deployMsg = '';
      if (ctx.config.primarySshTarget) {
        try {
          const ok = await RelayDeployer.deployEgressRelay(
            ctx.config.primarySshTarget,
            cleanDomain,
            ctx.config.railwayUuid || 'd4b8e21a-79f1-4320-a612-4c5386f91f7a'
          );
          deployMsg = ok
            ? '\n\n🚀 *Xray Egress Tunnel deployed and active on Daytona VM!* Outbound connections for Discord & Telegram are live.'
            : '\n\n⚠️ *Xray deployment attempted.* Verify VM connectivity.';
        } catch (_) {}
      }

      await OnboardingHandler.updateWizard(ctx,
        `✅ *Gateway Egress Relay Configured*\n\n• Domain: \`${cleanDomain}\`${deployMsg}`,
        new InlineKeyboard().text('Back to Relay Settings', 'menu:relay-settings'));
      return;
    }

    if (type === 'llama') {
      const normalized = RailwayHelper.normalizeRelayUrl(value);
      ctx.config.llama.railwayEndpointUrl = normalized;
      ctx.config.llama.activeEndpointUrl = EndpointResolver.normalizeV1Url(normalized);
      this.saveConfig(ctx);

      const check = await RailwayHelper.checkRelayDomain(normalized, 4000);
      const reachMsg = check.reachable
        ? `\n\n🟢 *Reachable*: ${check.message}`
        : `\n\n🟡 *Status*: ${check.message || 'Service starting up'}`;

      await OnboardingHandler.updateWizard(ctx,
        `✅ *LLaMA AI Relay Configured*\n\n• Endpoint: \`${normalized}\`${reachMsg}`,
        new InlineKeyboard().text('Back to Relay Settings', 'menu:relay-settings'));
    }
  }

  static async handleTextInput(ctx: BotContext, text: string): Promise<boolean> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const field = session.awaitingField;
    if (!field) return false;

    if (field === 'railwayToken' || field === 'gatewayRailwayToken' || field === 'llamaRailwayToken') {
      if (ctx.message) {
        try { await ctx.deleteMessage(); } catch (_) {}
      }
      const raw = text.trim();
      if (raw.toLowerCase() === 'skip') {
        if (field === 'gatewayRailwayToken') {
          session.awaitingField = 'gatewayDomain';
          await OnboardingHandler.updateWizard(ctx, 'Enter Gateway (Egress) Relay domain:');
          return true;
        }
        if (field === 'llamaRailwayToken') {
          session.awaitingField = 'llamaRelayUrl';
          await OnboardingHandler.updateWizard(ctx, 'Enter LLaMA AI Relay URL / subdomain:');
          return true;
        }
      }

      const val = await RailwayClient.validateApiKey(raw);
      if (!val.valid) {
        await OnboardingHandler.updateWizard(ctx,
          `*Railway API Token*\n\nRailway token was invalid: ${val.error || 'Unauthorized'}.\n\nPlease send a valid token:`,
          new InlineKeyboard().text('< Back', 'menu:relay-settings'));
        return true;
      }

      ctx.config.railwayApiKey = RailwayClient.sanitizeToken(raw);
      this.saveConfig(ctx);

      if (field === 'gatewayRailwayToken') {
        await this.handleGateway(ctx);
        return true;
      }
      if (field === 'llamaRailwayToken') {
        await this.handleLlama(ctx);
        return true;
      }

      await OnboardingHandler.updateWizard(ctx,
        `✅ *Railway API Token Saved*\n\nVerified for: \`${val.user || 'Railway User'}\` (${val.tokenType || 'account'}).\nIt will be reused for all Railway relays.`,
        new InlineKeyboard().text('Back to Relay Settings', 'menu:relay-settings'));
      return true;
    }

    if (field === 'gatewayDomain') {
      session.awaitingField = undefined;
      await this.handlePickRelay(ctx, 'gateway', text);
      return true;
    }

    if (field === 'llamaRelayUrl') {
      session.awaitingField = undefined;
      await this.handlePickRelay(ctx, 'llama', text);
      return true;
    }

    return false;
  }

  private static saveConfig(ctx: BotContext): void {
    if (ctx.botConfig?.isPublic && ctx.chat?.id) {
      ConfigManager.saveUserConfig(ctx.chat.id, ctx.config);
    } else {
      ConfigManager.save(ctx.config);
    }
  }
}
