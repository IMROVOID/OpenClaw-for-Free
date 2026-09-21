import { NextFunction } from 'grammy';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { BotContext, BotConfig } from '../types.js';

export function createAuthMiddleware(botConfig: BotConfig) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;

    // Public bot mode: each user is authorized to manage their own isolated instance
    if (botConfig.isPublic) {
      ctx.isOwner = true;
      return next();
    }

    // If no owner is configured yet, securely bind to the first user and persist to config
    if (!botConfig.ownerTelegramId && botConfig.allowedUserIds.length === 0) {
      if (userId !== undefined) {
        botConfig.ownerTelegramId = userId;
        ctx.config.telegramOwnerId = userId;
        ConfigManager.save(ctx.config);
      }
      ctx.isOwner = true;
      return next();
    }

    const isOwner = userId !== undefined && (
      userId === botConfig.ownerTelegramId ||
      botConfig.allowedUserIds.includes(userId)
    );

    ctx.isOwner = isOwner;

    if (!isOwner) {
      const msg = `[ACCESS DENIED] *Access Denied: Unauthorized User*\n\n` +
        `Your Telegram ID: \`${userId ?? 'unknown'}\`\n\n` +
        `You are not authorized to administer this OpenClaw VPS Assistant. ` +
        `Please contact the instance administrator or configure your Telegram ID in \`TELEGRAM_OWNER_ID\`.`;

      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: 'Access Denied: Unauthorized user.', show_alert: true });
      } else {
        await ctx.reply(msg, { parse_mode: 'Markdown' });
      }
      return;
    }

    return next();
  };
}
