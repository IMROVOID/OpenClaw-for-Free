import { InlineKeyboard } from 'grammy';
import { BotSessionManager } from '../services/botSessionManager.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingLlamaHandler } from './onboardingLlamaHandler.js';
import { DetectedVmConfig } from '../../control-panel/core/types.js';
import { BotContext } from '../types.js';

export class OnboardingChannelsHandler {
  static async showBotChannels(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 4;

    const detected = session.userMemory?.['onboarding:vm-detected'] as DetectedVmConfig | undefined;
    const hasBot = detected && (detected.telegramBotToken || detected.discordBotToken);

    if (hasBot) {
      session.awaitingField = undefined;
      const tgPart = detected.telegramBotToken
        ? `Configured (\`${detected.telegramBotToken.slice(0, 8)}...${detected.telegramBotToken.slice(-4)}\`)`
        : 'None';
      const dcPart = detected.discordBotToken ? 'Configured' : 'None';
      const text = `[Step 4/7] *Bot Messaging Channels*\n\n` +
        `*Existing Bot Tokens Found on VM:*\n` +
        `• Telegram: ${tgPart}\n` +
        `• Discord: ${dcPart}\n\n` +
        `Keep existing bot messaging channels? (Default: Keep)`;
      const kb = InlineKeyboards.buildOnboardingExistingBotChannels();
      await OnboardingHandler.updateWizard(ctx, text, kb);
      return;
    }

    session.awaitingField = 'botTokens';
    const text = `[Step 4/7] *Bot Messaging Channels*\n\n` +
      `Send your *Telegram Bot Token* (from @BotFather) or tap Skip below:`;

    const kb = new InlineKeyboard()
      .text('Skip Bot Setup', 'onboard:skip:channels')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
    await OnboardingHandler.updateWizard(ctx, text, kb);
  }

  static async handleKeepChannels(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const detected = session.userMemory?.['onboarding:vm-detected'] as DetectedVmConfig | undefined;
    if (detected) {
      if (detected.telegramBotToken) session.onboardingDraft.telegramToken = detected.telegramBotToken;
      if (detected.discordBotToken) session.onboardingDraft.discordToken = detected.discordBotToken;
      if (detected.discordGuildId) session.onboardingDraft.discordGuildId = detected.discordGuildId;
    }
    session.awaitingField = undefined;
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    await OnboardingLlamaHandler.advanceToStep5(ctx);
  }

  static async handleEnterChannels(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    session.step = 4;
    session.awaitingField = 'botTokens';
    const text = `[Step 4/7] *Bot Messaging Channels*\n\n` +
      `Please send your new *Telegram Bot Token* (from @BotFather):`;
    const kb = new InlineKeyboard().text('Skip Bot Setup', 'onboard:skip:channels').row().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
    await OnboardingHandler.updateWizard(ctx, text, kb);
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  }
}
