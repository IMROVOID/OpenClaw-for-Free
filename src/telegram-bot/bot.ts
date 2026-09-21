import { Bot, InlineKeyboard } from 'grammy';
import { BotContext, BotConfig } from './types.js';
import { ConfigManager } from '../control-panel/core/configManager.js';
import { createAuthMiddleware } from './middleware/authMiddleware.js';
import { errorMiddleware } from './middleware/errorMiddleware.js';
import { BotSessionManager } from './services/botSessionManager.js';
import { MenuHandler } from './handlers/menuHandler.js';
import { ServiceHandler } from './handlers/serviceHandler.js';
import { DiagnosticsHandler } from './handlers/diagnosticsHandler.js';
import { LogsHandler } from './handlers/logsHandler.js';
import { OnboardingHandler } from './handlers/onboardingHandler.js';
import { OnboardingChannelsHandler } from './handlers/onboardingChannelsHandler.js';
import { OnboardingLlamaHandler } from './handlers/onboardingLlamaHandler.js';
import { OnboardingFinalizer } from './handlers/onboardingFinalizer.js';
import { OnboardingVmHandler } from './handlers/onboardingVmHandler.js';
import { OnboardingIngressHandler } from './handlers/onboardingIngressHandler.js';
import { RelaySettingsHandler } from './handlers/relaySettingsHandler.js';
import { RecoveryHandler } from './handlers/recoveryHandler.js';

export function createTelegramBot(botConfig: BotConfig): Bot<BotContext> {
  const bot = new Bot<BotContext>(botConfig.botToken);

  // 1. Context injection middleware
  bot.use(async (ctx, next) => {
    ctx.botConfig = botConfig;
    const userId = ctx.from?.id ?? ctx.chat?.id;
    if (botConfig.isPublic) {
      if (userId) {
        ctx.config = ConfigManager.loadForUser(userId);
        ctx.config._userId = userId;
        ctx.session = BotSessionManager.getSession(userId);
      } else {
        ctx.config = ConfigManager.load();
      }
    } else {
      ctx.config = ConfigManager.load();
      if (userId) {
        ctx.session = BotSessionManager.getSession(userId);
      }
    }
    await next();
  });

  // 2. Auth & error handling
  bot.use(createAuthMiddleware(botConfig));
  bot.catch(errorMiddleware);

  // 3. Command routes
  bot.command(['start', 'menu'], async (ctx) => {
    if (ctx.chat) {
      BotSessionManager.getSession(ctx.chat.id).lastMenuMessageId = undefined;
    }
    await MenuHandler.sendMainMenu(ctx);
  });

  bot.command(['onboard', 'setup'], async (ctx) => {
    if (ctx.chat) {
      BotSessionManager.getSession(ctx.chat.id).lastMenuMessageId = undefined;
    }
    await OnboardingHandler.startOnboarding(ctx);
  });

  bot.command('recovery', async (ctx) => {
    await RecoveryHandler.startRecovery(ctx);
  });

  bot.command('services', async (ctx) => {
    await ServiceHandler.sendServiceManager(ctx);
  });

  bot.command('diagnostics', async (ctx) => {
    await DiagnosticsHandler.sendDiagnostics(ctx);
  });

  bot.command('logs', async (ctx) => {
    await LogsHandler.sendLogs(ctx);
  });

  bot.command('ping', async (ctx) => {
    await DiagnosticsHandler.handlePing(ctx);
  });

  bot.command('verify', async (ctx) => {
    await DiagnosticsHandler.runFullVerification(ctx);
  });

  bot.command(['syncmodels', 'sync_models'], async (ctx) => {
    await ServiceHandler.handleSyncModels(ctx);
  });

  bot.command('cancel', async (ctx) => {
    if (ctx.chat) BotSessionManager.clearFlow(ctx.chat.id);
    await ctx.reply('Operation cancelled.');
    if (ctx.config.primarySshTarget && ctx.config.primarySshTarget.trim()) {
      await MenuHandler.sendMainMenu(ctx);
    } else {
      await ctx.reply('Setup is not complete yet. Send /onboard when you are ready to configure your VPS.');
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `*OpenClaw Assistant Bot Commands*\n\n` +
      `• /menu or /start — Main dashboard with live status\n` +
      `• /onboard — 7-step onboarding wizard for Daytona/Freestyle\n` +
      `• /recovery — Virtual machine recovery & repair\n` +
      `• /services — Remote daemon manager (start/stop/restart)\n` +
      `• /diagnostics — Hardware specs, CPU/RAM telemetry\n` +
      `• /verify — Run full 6-step health verification (verify_setup.sh)\n` +
      `• /sync_models — Synchronize OpenClaw model catalog with OmniRoute\n` +
      `• /logs — Tail live logs for OpenClaw, OmniRoute, Llama\n` +
      `• /ping — Quick latency ping for model router\n` +
      `• /cancel — Cancel active wizard step and return to menu`,
      { parse_mode: 'Markdown' }
    );
  });

  // 4. Callback Query Dispatcher
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    const ingressSettings = ctx.chat && BotSessionManager.getSession(ctx.chat.id).flow === 'ingress_settings';
    if (ingressSettings && (data === 'onboard:back' || data === 'onboard:cancel')) {
      await OnboardingIngressHandler.handleSettingsNavigation(ctx, data === 'onboard:back' ? 'back' : 'cancel');
      return;
    }
    if (ingressSettings && data.startsWith('menu:') && ctx.chat) BotSessionManager.clearFlow(ctx.chat.id);
    if (ingressSettings && data.startsWith('onboard:') &&
        !data.startsWith('onboard:ingress:') && !data.startsWith('onboard:dom:')) return;
    if (data === 'menu:relay-settings' || data === 'menu:webui-settings') await RelaySettingsHandler.showSettings(ctx);
    else if (data === 'relay:webui') await OnboardingIngressHandler.startSettings(ctx);
    else if (data === 'relay:gateway') await RelaySettingsHandler.handleGateway(ctx);
    else if (data === 'relay:llama') await RelaySettingsHandler.handleLlama(ctx);
    else if (data === 'relay:token') await RelaySettingsHandler.handleToken(ctx);
    else if (data.startsWith('relay:pick:')) {
      const parts = data.split(':');
      const type = parts[2] as 'gateway' | 'llama';
      const target = parts.slice(3).join(':');
      await RelaySettingsHandler.handlePickRelay(ctx, type, target);
    } else if (data.startsWith('relay:custom:')) {
      const type = data.split(':')[2];
      const session = BotSessionManager.getSession(ctx.chat!.id);
      if (type === 'gateway') {
        session.awaitingField = 'gatewayDomain';
        await ctx.reply('Enter custom Gateway (Egress) Relay domain (e.g. `egress-relay.up.railway.app`):');
      } else {
        session.awaitingField = 'llamaRelayUrl';
        await ctx.reply('Enter custom LLaMA AI Relay URL or subdomain (e.g. `llama-relay.up.railway.app`):');
      }
      if (ctx.callbackQuery) { try { await ctx.answerCallbackQuery(); } catch (_) {} }
    }
    else if (data === 'menu:openclaw') await MenuHandler.handleWebUiAction(ctx, 'openclaw');
    else if (data === 'menu:approve_device') await MenuHandler.handleApproveDevice(ctx);
    else if (data === 'menu:omniroute') await MenuHandler.handleWebUiAction(ctx, 'omniroute');
    else if (data === 'menu:llama') await MenuHandler.handleWebUiAction(ctx, 'llama');
    else if (data === 'menu:services') await ServiceHandler.sendServiceManager(ctx, true);
    else if (data === 'menu:diagnostics') await DiagnosticsHandler.sendDiagnostics(ctx, true);
    else if (data === 'diag:verify') await DiagnosticsHandler.runFullVerification(ctx, true);
    else if (data === 'diag:sync_models') await ServiceHandler.handleSyncModels(ctx);
    else if (data === 'menu:logs') await LogsHandler.sendLogs(ctx, 'openclaw', true);
    else if (data === 'menu:terminal') await MenuHandler.handleTerminalInfo(ctx);
    else if (data === 'menu:onboard') await OnboardingHandler.startOnboarding(ctx);
    else if (data === 'menu:recovery') await RecoveryHandler.startRecovery(ctx);
    else if (data === 'menu:ping') await DiagnosticsHandler.handlePing(ctx);
    else if (data === 'menu:refresh' || data === 'menu:back') await MenuHandler.sendMainMenu(ctx, true);
    else if (data === 'menu:logout') await MenuHandler.handleLogout(ctx);
    else if (data.startsWith('svc:')) await ServiceHandler.handleAction(ctx, data);
    else if (data.startsWith('logs:')) await LogsHandler.handleView(ctx, data);
    else if (data.startsWith('onboard:provider:')) {
      const p = data.split(':')[2] as 'freestyle' | 'daytona';
      await OnboardingHandler.handleProviderSelect(ctx, p);
    } else if (data.startsWith('onboard:method:')) {
      const m = data.split(':')[2] as 'api' | 'ssh';
      await OnboardingHandler.handleMethodSelect(ctx, m);
    } else if (data.startsWith('onboard:topo:')) {
      const t = data.split(':')[2] as 'dedicated' | 'same_vm' | 'cloud_only';
      await OnboardingLlamaHandler.handleTopologySelect(ctx, t);
    } else if (data.startsWith('onboard:model:')) {
      const md = data.split(':')[2] as 'qwen7b' | 'qwen14b' | 'custom';
      await OnboardingLlamaHandler.handleModelSelect(ctx, md);
    } else if (data.startsWith('onboard:ingress:')) {
      const mode = data.split(':')[2] as 'port_forward' | 'domained';
      await OnboardingIngressHandler.handleIngressSelect(ctx, mode);
    } else if (data === 'onboard:dom:railway:use_saved') {
      await OnboardingIngressHandler.handleRailwayKeyChoice(ctx, 'use_saved');
    } else if (data === 'onboard:dom:railway:enter_new') {
      await OnboardingIngressHandler.handleRailwayKeyChoice(ctx, 'enter_new');
    } else if (data.startsWith('onboard:dom:pick:')) {
      const pickedSubdomain = data.slice('onboard:dom:pick:'.length);
      await OnboardingIngressHandler.handlePickDomain(ctx, pickedSubdomain);
    } else if (data.startsWith('onboard:dom:redeploy:')) {
      const redeployDomain = data.slice('onboard:dom:redeploy:'.length);
      await OnboardingIngressHandler.handleRedeployDomain(ctx, redeployDomain);
    } else if (data.startsWith('onboard:dom:')) {
      const prov = data.split(':')[2] as 'freestyle' | 'railway';
      await OnboardingIngressHandler.handleDomainProviderSelect(ctx, prov);
    } else if (data.startsWith('onboard:vm:') || data.startsWith('onboard:ws:') || data.startsWith('onboard:sec:method:') || data.startsWith('onboard:sec:key:') || data.startsWith('onboard:sec:provider:')) {
      await OnboardingVmHandler.handleCallback(ctx, data);
    } else if (data === 'onboard:step3:next') {
      await OnboardingChannelsHandler.showBotChannels(ctx);
    } else if (data === 'onboard:skip:channels') {
      await OnboardingLlamaHandler.advanceToStep5(ctx);
    } else if (data === 'onboard:keep:channels') {
      await OnboardingChannelsHandler.handleKeepChannels(ctx);
    } else if (data === 'onboard:enter:channels') {
      await OnboardingChannelsHandler.handleEnterChannels(ctx);
    } else if (data === 'onboard:sec:conn:api') {
      await OnboardingVmHandler.handleCallback(ctx, data);
    } else if (data === 'onboard:sec:conn:ssh') {
      await OnboardingLlamaHandler.promptSecondarySsh(ctx);
    } else if (data === 'onboard:sec:conn:skip') {
      await OnboardingFinalizer.finalizeSetup(ctx);
    } else if (data === 'onboard:back') {
      await OnboardingHandler.handleBack(ctx);
    } else if (data === 'onboard:llama:keep') {
      await OnboardingLlamaHandler.handleKeepExistingLlama(ctx);
    } else if (data === 'onboard:llama:keep-sec') {
      await OnboardingLlamaHandler.handleKeepSecondaryLlama(ctx);
    } else if (data === 'onboard:llama:reconf-sec') {
      await OnboardingLlamaHandler.handleReconfigureSecondaryLlama(ctx);
    } else if (data === 'onboard:llama:new') {
      await OnboardingLlamaHandler.showLlamaTopology(ctx);
    } else if (data === 'onboard:step:1') {
      await OnboardingHandler.startOnboarding(ctx);
    } else if (data === 'onboard:cancel') {
      if (ctx.chat) BotSessionManager.clearFlow(ctx.chat.id);
      const restartKb = new InlineKeyboard().text('Start Setup', 'onboard:step:1');
      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText('Onboarding cancelled. Send /onboard or tap below anytime to start setup.', { reply_markup: restartKb });
          await ctx.answerCallbackQuery();
          return;
        } catch (_) {}
      }
      await ctx.reply('Onboarding cancelled. Send /onboard anytime to start setup.', { reply_markup: restartKb });
    } else if (data.startsWith('rec:')) {
      await RecoveryHandler.handleAction(ctx, data);
    }
  });

  // 5. Text message handler for wizard text inputs
  bot.on([':photo', ':video', ':document', ':sticker', ':voice', ':audio', ':animation'], async (ctx) => {
    await ctx.reply(
      'This bot only accepts text input. Images and other media files are not supported — please send your answer as text.'
    );
  });

  bot.on('message:text', async (ctx) => {
    const session = ctx.chat ? BotSessionManager.getSession(ctx.chat.id) : undefined;
    const isSensitive = session?.awaitingField === 'railwayApiKey' ||
      session?.awaitingField === 'railwayToken' ||
      session?.awaitingField === 'gatewayRailwayToken' ||
      session?.awaitingField === 'llamaRailwayToken' ||
      session?.awaitingField === 'primaryApiKey' ||
      session?.awaitingField === 'secondaryApiKey' ||
      session?.awaitingField === 'botTokens';
    if (isSensitive && ctx.message) {
      try { await ctx.deleteMessage(); } catch (_) {}
    }

    const handled = await RelaySettingsHandler.handleTextInput(ctx, ctx.message.text) ||
      await OnboardingIngressHandler.handleTextInput(ctx, ctx.message.text) ||
      await OnboardingHandler.handleTextInput(ctx, ctx.message.text);
    if (!handled) {
      await ctx.reply('Type /menu to view the dashboard or /help for command list.');
    }
  });

  return bot;
}
