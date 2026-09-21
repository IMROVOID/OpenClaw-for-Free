import { BotError } from 'grammy';
import { BotContext } from '../types.js';

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(sk-[a-zA-Z0-9_-]{8,})/g, 'sk-***')
    .replace(/(token=)([a-zA-Z0-9_%-]+)/gi, '$1***')
    .replace(/([0-9]{8,10}:[a-zA-Z0-9_-]{30,})/g, '***BOT_TOKEN***');
}

export async function errorMiddleware(err: BotError<BotContext>): Promise<void> {
  const ctx = err.ctx;
  const error = err.error;
  const rawMsg = error instanceof Error ? error.message : String(error);
  const safeMsg = sanitizeErrorMessage(rawMsg);

  if (
    rawMsg.includes('message is not modified') ||
    rawMsg.includes('query is too old') ||
    rawMsg.includes('query ID is invalid')
  ) {
    try {
      if (ctx.callbackQuery && rawMsg.includes('message is not modified')) {
        await ctx.answerCallbackQuery({ text: '[STATUS] System status is up to date.' });
      }
    } catch (_) {}
    return;
  }

  console.error(`[TelegramBot Error] Update ${ctx.update.update_id}:`, safeMsg);

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: `[ERROR] Operation failed: ${safeMsg.slice(0, 150)}`,
        show_alert: true
      });
    } else {
      await ctx.reply(`[ERROR] *Operation Failed*\n\`\`\`\n${safeMsg.slice(0, 300)}\n\`\`\``, {
        parse_mode: 'Markdown'
      });
    }
  } catch (replyErr) {
    try {
      await ctx.reply(`[ERROR] *Operation Failed*\n\`\`\`\n${safeMsg.slice(0, 300)}\n\`\`\``, {
        parse_mode: 'Markdown'
      });
    } catch (_) {}
  }
}
