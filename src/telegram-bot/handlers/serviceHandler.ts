import { InlineKeyboard } from 'grammy';
import { ServiceController, ManagedService, ServiceAction } from '../../control-panel/core/serviceController.js';
import { VpsProbe } from '../../control-panel/core/vpsProbe.js';
import { OmnirouteSync } from '../../control-panel/core/omnirouteSync.js';
import { EndpointResolver } from '../../control-panel/core/endpointResolver.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { BotContext } from '../types.js';

export class ServiceHandler {
  static async sendServiceManager(ctx: BotContext, edit = false): Promise<void> {
    const cfg = ctx.config;
    if (!cfg.primarySshTarget) {
      await ctx.reply('[WARN] VPS is not configured. Please run /onboard first.');
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    const prim = await VpsProbe.queryVpsTelemetry(cfg.primarySshTarget, true, 'Primary VPS');
    const rows = prim.services.map((s) => {
      const isUp = s.status.toLowerCase() === 'running';
      const badge = isUp ? '[RUNNING]' : '[STOPPED]';
      const uptime = s.uptime ? `(${s.uptime})` : '';
      return `• *${s.name}* : ${badge} ${uptime}`;
    });

    const text = `*REMOTE SERVICE MANAGER*\n\n` +
      `Host: \`${cfg.primarySshTarget}\`\n\n` +
      `*Supervisord Daemons:*\n` +
      (rows.length > 0 ? rows.join('\n') : '_No services detected on supervisor_') + '\n\n' +
      `Use the controls below to start, stop, or restart services:`;

    const kb = InlineKeyboards.buildServiceManager();
    if (edit && ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
    }
  }

  static async handleAction(ctx: BotContext, data: string): Promise<void> {
    if (data === 'svc:sync_models') {
      await this.handleSyncModels(ctx);
      return;
    }
    const parts = data.split(':');
    const action = parts[1] as ServiceAction | 'update';
    const target = parts[2] as ManagedService | 'all';
    const targetMsgId = ctx.callbackQuery?.message?.message_id;
    const kb = new InlineKeyboard().text('< Back to Services', 'menu:services').text('Main Menu', 'menu:back');

    await ctx.answerCallbackQuery({ text: `Executing ${action} for ${target}...` });
    if (targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, `[EXECUTING] *Executing action...*\n\`${action.toUpperCase()} ${target}\``, {
          parse_mode: 'Markdown'
        });
      } catch (_) {}
    }

    try {
      let resultText = '';
      if (action === 'restart' && target === 'all') {
        const res = await ServiceController.restartAll(ctx.config);
        resultText = res.success ? `[OK] *All Services Restarted Successfully*\n${res.message}` : `[WARN] *Restart Failed*\n${res.message}`;
      } else if (action === 'update') {
        const res = await ServiceController.updateService(ctx.config, target === 'all' ? 'openclaw' : target);
        resultText = res.success ? `[OK] *Update Completed*\n${res.message}` : `[WARN] *Update Failed*\n${res.message}`;
      } else {
        const res = await ServiceController.executeServiceAction(ctx.config, target, action as ServiceAction);
        resultText = res.success ? `[OK] *Action Succeeded*\n${res.message}` : `[WARN] *Action Failed*\n${res.message}`;
      }

      if (targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, resultText, { parse_mode: 'Markdown', reply_markup: kb });
          return;
        } catch (_) {}
      }
      await ctx.reply(resultText, { parse_mode: 'Markdown', reply_markup: kb });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, `[ERROR] *Service Execution Error*\n\`${errMsg}\``, { parse_mode: 'Markdown', reply_markup: kb });
          return;
        } catch (_) {}
      }
      await ctx.reply(`[ERROR] *Service Execution Error*\n\`${errMsg}\``, { parse_mode: 'Markdown', reply_markup: kb });
    }
  }

  static async handleSyncModels(ctx: BotContext): Promise<void> {
    const cfg = ctx.config;
    if (!cfg.primarySshTarget) {
      await ctx.reply('[WARN] VPS is not configured. Please run /onboard first.');
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    const targetMsgId = ctx.callbackQuery?.message?.message_id;
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Syncing models with OmniRoute...' });
    }

    const waitText = `🔄 *Syncing OpenClaw Models with Connected OmniRoute...*\n\n` +
      `Host: \`${cfg.primarySshTarget}\` (${cfg.provider.toUpperCase()})\n` +
      `• Querying live OmniRoute gateway (Port ${cfg.omniroutePort})\n` +
      `• Reading customModels & aliases from SQLite\n` +
      `• Updating \`openclaw.json\` and reloading gateway daemon...`;

    if (targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, waitText, { parse_mode: 'Markdown' });
      } catch (_) {}
    } else {
      await ctx.reply(waitText, { parse_mode: 'Markdown' });
    }

    const llamaOpts = cfg.llama.enabled
      ? {
          enabled: true,
          endpointUrl: EndpointResolver.resolveBaseUrl(cfg),
          modelName: cfg.llama.modelName || 'Qwen 2.5 7B'
        }
      : { enabled: false };

    const res = await OmnirouteSync.syncOmnirouteModelsToOpenClaw(
      cfg.primarySshTarget,
      cfg.omniroutePort,
      cfg.omnirouteApiKey,
      llamaOpts
    );

    const kb = new InlineKeyboard()
      .text('Sync Again', 'svc:sync_models')
      .text('Services', 'menu:services')
      .row()
      .text('< Back to Main Menu', 'menu:back');

    let resultText = '';
    if (res.success) {
      const previewList = res.models.slice(0, 10).map((m) => `• \`${m}\``).join('\n');
      const moreCount = res.models.length - 10;
      const moreText = moreCount > 0 ? `\n_...and ${moreCount} more models_` : '';
      resultText = `✅ *Models Synced Successfully!*\n\n` +
        `• *Total Models Registered*: \`${res.modelCount}\`\n` +
        `• *Gateway Service*: [RELOADED]\n\n` +
        `*Active Model Catalog Preview*:\n${previewList}${moreText}\n\n` +
        `_You can switch active models in OpenClaw using \`/model\` or the WebUI._`;
    } else {
      const safeErr = (res.error || 'Failed to communicate with OmniRoute').replace(/[`\\]/g, '');
      resultText = `⚠️ *Model Synchronization Warning*\n\n` +
        `\`${safeErr.slice(0, 400)}\`\n\n` +
        `_Ensure OmniRoute daemon is running via /services._`;
    }

    if (targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, resultText, { parse_mode: 'Markdown', reply_markup: kb });
        return;
      } catch (_) {}
    }
    await ctx.reply(resultText, { parse_mode: 'Markdown', reply_markup: kb });
  }
}
