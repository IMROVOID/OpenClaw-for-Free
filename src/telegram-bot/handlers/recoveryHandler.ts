import { InlineKeyboard } from 'grammy';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { VpsDetector } from '../../control-panel/core/vpsDetector.js';
import { PrimaryVault } from '../../control-panel/core/primaryVault.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingVmHandler } from './onboardingVmHandler.js';
import { BotContext } from '../types.js';

export class RecoveryHandler {
  static async startRecovery(ctx: BotContext, edit = false, messageIdToEdit?: number): Promise<void> {
    const cfg = ctx.config;
    const canEdit = edit || messageIdToEdit !== undefined;
    const targetMsgId = messageIdToEdit ?? ctx.callbackQuery?.message?.message_id;

    if (canEdit && targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, '[PROBING] Probing VM reachability and checking service health...', {
          parse_mode: 'Markdown'
        });
      } catch (_) {}
    } else {
      await ctx.reply('[PROBING] Probing VM reachability and checking service health...');
    }

    const inspectRes = await VpsDetector.inspectAll(cfg);
    if (!inspectRes.missingVmType || inspectRes.missingVmType === 'none') {
      const okMsg = '[OK] *All VMs Operational*\nBoth primary and secondary virtual machines are online and responsive. Ephemeral SSH keys were automatically renewed via your API Key if needed. No recovery needed.';
      if (canEdit && targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, okMsg, { parse_mode: 'Markdown' });
          return;
        } catch (_) {}
      }
      await ctx.reply(okMsg, { parse_mode: 'Markdown' });
      return;
    }

    const missing: 'primary' | 'secondary' | 'both' = inspectRes.missingVmType;
    BotSessionManager.startRecovery(ctx.chat!.id, missing);

    let renewNote = '';
    if (inspectRes.primaryRenewError) renewNote += `\n• Renewal failed: ${inspectRes.primaryRenewError}`;
    if (inspectRes.secondaryRenewError) renewNote += `\n• Secondary renewal failed: ${inspectRes.secondaryRenewError}`;

    const primStatus = inspectRes.primaryReachable ? '[ONLINE]' : '[UNREACHABLE]';
    const secTarget = cfg.llama.enabled && cfg.llama.isSeparateVps
      ? (cfg.llama.sshTarget || cfg.secondarySshTarget || 'none')
      : 'N/A';
    const secStatus = inspectRes.secondaryReachable ? '[ONLINE]' : (secTarget !== 'N/A' ? '[UNREACHABLE]' : '[N/A]');

    const text = `*VIRTUAL MACHINE RECOVERY ASSISTANT*\n\n` +
      `• Primary VM (\`${cfg.primarySshTarget || 'none'}\`): ${primStatus}\n` +
      `• Secondary VM (\`${secTarget}\`): ${secStatus}\n\n` +
      `*Issue Detected*: ${missing === 'both' ? 'Both VMs are unreachable.' : missing === 'secondary' ? 'Secondary Llama VM is unreachable.' : 'Primary VM is unreachable.'}${renewNote}\n\n` +
      `Select a recovery option below:`;

    const kb = InlineKeyboards.buildRecoveryMenu(missing);
    if (canEdit && targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, text, { parse_mode: 'Markdown', reply_markup: kb });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }

  static async handleAction(ctx: BotContext, action: string): Promise<void> {
    const cfg = ctx.config;
    const targetMsgId = ctx.callbackQuery?.message?.message_id;

    if (action === 'rec:retry') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Retrying connection to VPS...' });
      if (targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, '[PROBING] Retrying connection to VPS...', { parse_mode: 'Markdown' });
        } catch (_) {}
      }
      const retryState = await VpsDetector.inspectAll(cfg);

      const menuKb = new InlineKeyboard().text('Go to Main Menu', 'menu:back');
      if (retryState.primaryReachable && retryState.secondaryReachable !== false) {
        const okMsg = `[OK] *VM Connection Restored!*\nAll configured VMs are now reachable.`;
        BotSessionManager.clearFlow(ctx.chat!.id);
        if (targetMsgId && ctx.chat) {
          try {
            await ctx.api.editMessageText(ctx.chat.id, targetMsgId, okMsg, { parse_mode: 'Markdown', reply_markup: menuKb });
            return;
          } catch (_) {}
        }
        await ctx.reply(okMsg, { parse_mode: 'Markdown', reply_markup: menuKb });
      } else {
        const failMsg = `[FAILED] *Still Unreachable*\nCould not establish connection to the remote instances. Please select an alternate recovery option:`;
        const missing = (retryState.missingVmType && retryState.missingVmType !== 'none') ? retryState.missingVmType : 'primary';
        const recKb = InlineKeyboards.buildRecoveryMenu(missing);
        if (targetMsgId && ctx.chat) {
          try {
            await ctx.api.editMessageText(ctx.chat.id, targetMsgId, failMsg, { parse_mode: 'Markdown', reply_markup: recKb });
            return;
          } catch (_) {}
        }
        await ctx.reply(failMsg, { parse_mode: 'Markdown', reply_markup: recKb });
      }
      return;
    }

    if (action === 'rec:disable_secondary') {
      cfg.llama.isSeparateVps = false;
      cfg.llama.sshTarget = cfg.primarySshTarget;
      cfg.secondarySshTarget = '';
      ConfigManager.save(cfg, ctx.from?.id);
      BotSessionManager.clearFlow(ctx.chat!.id);

      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Secondary VM disabled.' });
      const menuKb = new InlineKeyboard().text('Go to Main Menu', 'menu:back');
      const text = `[OK] *Secondary VM Disabled*\nLlama AI is now configured to run on the Primary VM or via Cloud APIs.`;
      if (targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, text, { parse_mode: 'Markdown', reply_markup: menuKb });
          return;
        } catch (_) {}
      }
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: menuKb });
      return;
    }

    if (action === 'rec:restore') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Restoring configuration from Primary VM vault...' });
      if (targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, '[RESTORE] Pulling credential vault from Primary VM...', { parse_mode: 'Markdown' });
        } catch (_) {}
      }

      if (!cfg.primarySshTarget) {
        const noTarget = '[FAILED] No Primary VM target configured.\nSet your primary SSH target first, then restore from the vault.';
        PrimaryVault.capture('auth', 'vault restore attempted without a configured primary target');
        const kb = new InlineKeyboard().text('Go to Main Menu', 'menu:back');
        await ctx.reply(noTarget, { parse_mode: 'Markdown', reply_markup: kb });
        return;
      }

      const pullRes = await PrimaryVault.pullSnapshot(cfg.primarySshTarget);
      if (!pullRes.success || !pullRes.snapshot) {
        const failText = `[FAILED] *Vault Restore Unavailable*\n\`${pullRes.error || 'vault not found on primary'}\`\nOnboard the Primary VM first — the vault is created automatically during provisioning.`;
        PrimaryVault.capture('auth', `vault restore failed: ${pullRes.error || 'not found'}`);
        const kb = InlineKeyboards.buildRecoveryMenu('primary');
        await ctx.reply(failText, { parse_mode: 'Markdown', reply_markup: kb });
        return;
      }

      const restored = PrimaryVault.applySnapshotToLocal(pullRes.snapshot, cfg);
      ConfigManager.save(restored, ctx.from?.id);
      BotSessionManager.clearFlow(ctx.chat!.id);
      PrimaryVault.capture('auth', 'configuration restored from primary vault to this device');

      const okText = `[OK] *Configuration Restored*\n• Primary VM: \`${restored.primarySshTarget}\`\n• Secondary VM and credentials are stored only in the Primary VM vault.\n• Re-run recovery if a VM is still unreachable.`;
      const menuKb = new InlineKeyboard().text('Go to Main Menu', 'menu:back');
      if (targetMsgId && ctx.chat) {
        try {
          await ctx.api.editMessageText(ctx.chat.id, targetMsgId, okText, { parse_mode: 'Markdown', reply_markup: menuKb });
          return;
        } catch (_) {}
      }
      await ctx.reply(okText, { parse_mode: 'Markdown', reply_markup: menuKb });
      return;
    }

    if (action === 'rec:secondary') {
      const session = BotSessionManager.startOnboarding(ctx.chat!.id);
      session.onboardingDraft.provider = cfg.provider;
      session.onboardingDraft.secondaryProvider = cfg.secondaryProvider || cfg.provider;
      session.onboardingDraft.llamaTopology = 'dedicated';
      session.onboardingDraft.primarySshTarget = cfg.primarySshTarget;
      session.onboardingDraft.primaryWorkspaceId = cfg.provider === 'daytona'
        ? cfg.daytonaPrimaryWorkspaceId
        : cfg.freestylePrimaryVmId;
      session.onboardingDraft.secondaryOnly = true;
      session.step = 6;
      BotSessionManager.saveSession(ctx.chat!.id);
      await OnboardingVmHandler.handleSecondaryMethod(ctx);
      return;
    }

    if (action === 'rec:both' || action === 'rec:primary') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Starting setup wizard...' });
      await OnboardingHandler.startOnboarding(ctx);
    }
  }
}
