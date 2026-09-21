import { VpsLogFetcher, LogServiceType } from '../../control-panel/core/vpsLogFetcher.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { BotLogger } from '../services/botLogger.js';
import { BotContext } from '../types.js';

export class LogsHandler {
  static async sendLogs(ctx: BotContext, service: LogServiceType | 'bot' = 'openclaw', edit = false): Promise<void> {
    if (service === 'bot') {
      if (ctx.session) ctx.session.lastLogsService = 'bot' as LogServiceType;
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Fetching bot logs...' });
      const recent = BotLogger.getRecentLogs(30);
      const today = new Date().toISOString().slice(0, 10);
      const text = `*TELEGRAM BOT LOGS (${today})*\n\n\`\`\`text\n${recent.slice(-3000)}\n\`\`\``;
      const kb = InlineKeyboards.buildLogs('bot');
      if (edit && ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
        } catch (_) {
          await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
        }
      } else {
        await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
      }
      return;
    }

    const cfg = ctx.config;
    if (!cfg.primarySshTarget) {
      await ctx.reply('[WARN] VPS is not configured. Please run /onboard first.');
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    if (ctx.session) ctx.session.lastLogsService = service;
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: `Fetching ${service} logs...` });

    const fetchRes = await VpsLogFetcher.fetchLogs(cfg, service);
    const lastLines = fetchRes.lines.slice(-25).join('\n');
    const safeOutput = lastLines.length > 0 ? lastLines : 'No recent log entries found.';

    const text = `*VPS SERVICE LOGS: ${service.toUpperCase()}*\n` +
      `Target: \`${fetchRes.target}\`\n\n` +
      `\`\`\`text\n${safeOutput.slice(-3000)}\n\`\`\``;

    const kb = InlineKeyboards.buildLogs(service);
    if (edit && ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
      }
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
    }
  }

  static async handleView(ctx: BotContext, data: string): Promise<void> {
    const parts = data.split(':');
    const service = (parts[2] || 'openclaw') as LogServiceType;
    await this.sendLogs(ctx, service, true);
  }
}
