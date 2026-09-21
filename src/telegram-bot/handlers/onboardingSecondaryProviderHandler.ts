import { InlineKeyboard } from 'grammy';
import { BotSessionManager } from '../services/botSessionManager.js';
import { BotContext } from '../types.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingVmHandler } from './onboardingVmHandler.js';

export class OnboardingSecondaryProviderHandler {
  static async show(ctx: BotContext): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'onboarding') return;
    session.awaitingField = undefined;
    session.onboardingDraft.secondaryMethod = 'api';
    const kb = new InlineKeyboard()
      .text('Daytona Cloud', 'onboard:sec:provider:daytona').row()
      .text('Freestyle.sh', 'onboard:sec:provider:freestyle').row()
      .text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
    await OnboardingHandler.updateWizard(ctx, '*Secondary VM Cloud Provider*\n\nChoose the provider for your secondary VM:', kb);
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async select(ctx: BotContext, data: string): Promise<void> {
    const provider = data.split(':')[3];
    if (provider !== 'daytona' && provider !== 'freestyle') return;
    const session = BotSessionManager.getSession(ctx.chat!.id);
    if (session.flow !== 'onboarding') return;
    const draft = session.onboardingDraft;
    if (provider !== (draft.secondaryProvider || draft.provider)) {
      draft.secondaryApiKey = undefined;
      draft.secondarySshTarget = undefined;
      draft.secondaryWorkspaceId = undefined;
      draft.secondarySlug = undefined;
    }
    draft.secondaryProvider = provider;
    if (session.userMemory) delete session.userMemory['onboarding:workspaces:secondary'];
    session.awaitingField = undefined;
    await OnboardingVmHandler.handleSecondaryApiKeyMethod(ctx);
  }
}
