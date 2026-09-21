import { InlineKeyboard } from 'grammy';
import { VpsProviderFactory } from '../../control-panel/core/vpsProviderDriver.js';
import { VpsSpecs, CloudProviderType } from '../../control-panel/core/types.js';
import { DaytonaApi } from '../../control-panel/core/daytonaApi.js';
import { FreestyleApi } from '../../control-panel/core/freestyleApi.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { OnboardingSecondaryProviderHandler } from './onboardingSecondaryProviderHandler.js';
import { OnboardingLlamaHandler } from './onboardingLlamaHandler.js';
import { sanitizeErrorMessage } from '../middleware/errorMiddleware.js';
import { BotContext } from '../types.js';

type VmRole = 'primary' | 'secondary';

type WorkspaceEntry = { id: string; name: string; specs: VpsSpecs };

const WORKSPACES_MEMORY_KEY = 'onboarding:workspaces';

export class OnboardingVmHandler {
  private static roleOf = (sub: 'p' | 's'): VmRole => sub === 's' ? 'secondary' : 'primary';
  private static providerOf = (draft: { provider: CloudProviderType; secondaryProvider?: CloudProviderType }, role: VmRole): CloudProviderType =>
    role === 'secondary' && draft.secondaryProvider ? draft.secondaryProvider : draft.provider;
  private static apiKeyOf = (draft: { primaryApiKey?: string; secondaryApiKey?: string }, role: VmRole): string | undefined =>
    role === 'secondary' ? draft.secondaryApiKey || draft.primaryApiKey : draft.primaryApiKey;

  static async handleShowVmChoice(ctx: BotContext, role: VmRole): Promise<void> {
    const label = role === 'primary' ? 'Primary' : 'Secondary LLM';
    const text = `*${label} VM Setup*\n\nWould you like to *Create a New VM* or select an *Existing VM* from your account?`;
    await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildOnboardingVmChoice(role));
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleSecondaryMethod(ctx: BotContext): Promise<void> {
    const text = `*Secondary LLM VM Setup*\n\nHow would you like to connect the secondary VM?\n` +
      `1. *API Key* — auto-provision or select an existing VM.\n` +
      `2. *Direct SSH Target* — enter the secondary VM SSH string.`;
    await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildSecondaryMethod());
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async handleSecondaryApiKeyMethod(ctx: BotContext): Promise<void> {
    const session = ctx.chat ? BotSessionManager.getSession(ctx.chat.id) : undefined;
    if (!session || session.flow !== 'onboarding') return;
    const draft = session.onboardingDraft;
    draft.secondaryMethod = 'api';
    const existingKey = this.getExistingSecondaryApiKey(ctx);
    if (existingKey) {
      const secProv = draft.secondaryProvider || draft.provider;
      const driver = VpsProviderFactory.getDriver(secProv);
      const text = `*Secondary VM API Key Setup*\n\n` +
        `An existing ${driver.displayName} API key is available from your setup.\n\n` +
        `Would you like to *use the existing API key* or *enter a different API key*?\n` +
        `*(Select "Enter Different API Key" if your Secondary VM is on another account or organization)*`;
      await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildOnboardingSecondaryApiKeyChoice());
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      return;
    }
    session.awaitingField = 'secondaryApiKey';
    const secProv = draft.secondaryProvider || draft.provider;
    const driver = VpsProviderFactory.getDriver(secProv);
    const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
    await OnboardingHandler.updateWizard(ctx, `Please send your *${driver.displayName} API Key* for the secondary VM (or tap Cancel):`, kb);
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  private static getExistingSecondaryApiKey(ctx: BotContext): string | undefined {
    const session = ctx.chat ? BotSessionManager.getSession(ctx.chat.id) : undefined;
    const draft = session?.onboardingDraft;
    const secProv = draft ? (draft.secondaryProvider || draft.provider) : (ctx.config.secondaryProvider || ctx.config.provider);
    if (draft?.secondaryApiKey) return draft.secondaryApiKey;
    const primaryKey = draft?.provider === secProv ? draft.primaryApiKey : undefined;
    if (secProv === 'freestyle') {
      return ctx.config.secondaryFreestyleApiKey || primaryKey || ctx.config.freestyleApiKey;
    }
    return ctx.config.secondaryDaytonaApiKey || primaryKey || ctx.config.daytonaApiKey;
  }

  static async handleCallback(ctx: BotContext, data: string): Promise<void> {
    const session = ctx.chat ? BotSessionManager.getSession(ctx.chat.id) : undefined;
    if (!session || session.flow !== 'onboarding') return;
    const draft = session.onboardingDraft;

    if (data === 'onboard:vm:existing:p' || data === 'onboard:vm:existing:s') {
      await this.showWorkspacePicker(ctx, this.roleOf(data.slice(-1) as 'p' | 's'));
      return;
    }
    if (data === 'onboard:vm:new:p' || data === 'onboard:vm:new:s') {
      await this.createNewVm(ctx, this.roleOf(data.slice(-1) as 'p' | 's'));
      return;
    }
    if (data.startsWith('onboard:ws:')) {
      const parts = data.split(':');
      await this.selectWorkspace(ctx, this.roleOf(parts[2] as 'p' | 's'), parseInt(parts[3], 10));
      return;
    }
    if (data.startsWith('onboard:sec:provider:')) {
      await OnboardingSecondaryProviderHandler.select(ctx, data);
      return;
    }
    if (data === 'onboard:sec:method:api' || data === 'onboard:sec:conn:api') {
      await OnboardingSecondaryProviderHandler.show(ctx);
      return;
    }
    if (data === 'onboard:sec:key:existing') {
      const existingKey = this.getExistingSecondaryApiKey(ctx);
      if (existingKey) {
        draft.secondaryApiKey = existingKey;
      }
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      await this.handleShowVmChoice(ctx, 'secondary');
      return;
    }
    if (data === 'onboard:sec:key:new') {
      draft.secondaryApiKey = undefined;
      session.awaitingField = 'secondaryApiKey';
      if (session.userMemory) delete session.userMemory[`${WORKSPACES_MEMORY_KEY}:secondary`];
      const secProv = draft.secondaryProvider || draft.provider;
      const driver = VpsProviderFactory.getDriver(secProv);
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `Please send your new *${driver.displayName} API Key* for the secondary VM (or tap Cancel):`, kb);
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      return;
    }
    if (data === 'onboard:sec:method:ssh') {
      draft.secondaryMethod = 'ssh';
      session.awaitingField = 'secondarySshTarget';
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `*Secondary VM SSH Target*\n\nPlease send the SSH connection string for the secondary VM:`, kb);
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      return;
    }
  }

  static async showWorkspacePicker(ctx: BotContext, role: VmRole): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    const driver = VpsProviderFactory.getDriver(this.providerOf(draft, role) as 'freestyle' | 'daytona');

    const apiKey = this.apiKeyOf(draft, role);
    if (!apiKey) {
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `[ERROR] No API key is configured for this step. Please go back and re-enter the key.`, kb);
      return;
    }
    let workspaces: WorkspaceEntry[];
    const cacheKey = `${WORKSPACES_MEMORY_KEY}:${role}`;
    const canReusePrimary = role === 'secondary' && (!draft.secondaryApiKey || draft.secondaryApiKey === draft.primaryApiKey);
    if (role === 'secondary' && (session.userMemory?.[cacheKey]?.length || (canReusePrimary && session.userMemory?.[WORKSPACES_MEMORY_KEY]?.length))) {
      workspaces = session.userMemory[cacheKey] || session.userMemory[WORKSPACES_MEMORY_KEY];
    } else {
      await OnboardingHandler.updateWizard(ctx, `[PROBING] Fetching available VMs from ${driver.displayName}...`);
      workspaces = await driver.listExistingWorkspaces(apiKey);
      if (!session.userMemory) session.userMemory = {};
      session.userMemory[cacheKey] = workspaces;
      if (role === 'primary') session.userMemory[WORKSPACES_MEMORY_KEY] = workspaces;
    }

    let list = workspaces;
    if (role === 'secondary' && draft.primaryWorkspaceId) {
      list = list.filter((w) => w.id !== draft.primaryWorkspaceId);
    }

    const label = role === 'primary' ? 'Primary' : 'Secondary LLM';

    if (list.length === 0) {
      const kb = new InlineKeyboard()
        .text('Create a New VM', `onboard:vm:new:${role === 'primary' ? 'p' : 's'}`)
        .row()
        .text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `*No existing VMs found.*\n\nWould you like to create a New ${label} VM instead?`, kb);
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery(); } catch (_) {}
      }
      return;
    }

    const text = `*Select ${label} VM*\n\nAvailable VMs in your account:\n` +
      list.map((w, i) => `${i + 1}. ${w.name} (${w.specs.cpuCores} vCPU / ${w.specs.ramGb} GB)`).join('\n') +
      `\n\nChoose a VM below:`;
    await OnboardingHandler.updateWizard(ctx, text, InlineKeyboards.buildWorkspacePicker(list, role));
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async createNewVm(ctx: BotContext, role: VmRole): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;
    const driver = VpsProviderFactory.getDriver(this.providerOf(draft, role) as 'freestyle' | 'daytona');
    const apiKey = this.apiKeyOf(draft, role);
    if (!apiKey) {
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `[ERROR] No API key is configured for this step. Please go back and re-enter the key.`, kb);
      return;
    }

    const label = role === 'primary' ? 'Primary' : 'Secondary LLM';
    await OnboardingHandler.updateWizard(ctx, `[PROVISIONING] Creating a new ${label} VM on ${driver.displayName}...`);

    try {
      if (role === 'primary') {
        const res = await driver.provisionPrimary(apiKey, 'openclaw');
        draft.primarySshTarget = res.primarySshTarget;
        draft.primaryWorkspaceId = res.primaryWorkspaceId;
        draft.primarySlug = res.primarySlug;
        if (res.specs) draft.specs = res.specs;
        await OnboardingHandler.advanceToStep3(ctx);
      } else {
        const res = await driver.provisionSecondary(apiKey, 'openclaw');
        draft.secondarySshTarget = res.secondarySshTarget;
        draft.secondaryWorkspaceId = res.secondaryWorkspaceId;
        if (draft.skipLlamaProvisioning) await OnboardingHandler.finalizeSetup(ctx);
        else await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `[ERROR] Failed to provision VM: ${sanitizeErrorMessage(msg)}`, kb);
    }
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }

  static async selectWorkspace(ctx: BotContext, role: VmRole, idx: number): Promise<void> {
    const session = BotSessionManager.getSession(ctx.chat!.id);
    const draft = session.onboardingDraft;

    const cacheKey = `${WORKSPACES_MEMORY_KEY}:${role}`;
    const canReusePrimary = role === 'secondary' && (!draft.secondaryApiKey || draft.secondaryApiKey === draft.primaryApiKey);
    const cached = session.userMemory?.[cacheKey] || (canReusePrimary || role === 'primary' ? session.userMemory?.[WORKSPACES_MEMORY_KEY] : undefined);
    let list = (cached as WorkspaceEntry[] | undefined) || [];
    if (role === 'secondary' && draft.primaryWorkspaceId) {
      list = list.filter((w) => w.id !== draft.primaryWorkspaceId);
    }
    const ws = list[idx];
    if (!ws) {
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `[ERROR] That workspace is no longer available. Please select again.`, kb);
      return;
    }

    const apiKey = this.apiKeyOf(draft, role);
    if (!apiKey) {
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `[ERROR] No API key is configured for this step. Please go back and re-enter the key.`, kb);
      return;
    }

    const isDaytona = (this.providerOf(draft, role) as 'freestyle' | 'daytona') === 'daytona';
    await OnboardingHandler.updateWizard(ctx, `[MINTING] Creating SSH access for ${ws.name}...`);

    try {
      let sshTarget = '';
      if (isDaytona) {
        const sshAccess = await DaytonaApi.createSshAccess(apiKey, ws.id);
        if (!sshAccess.success || !sshAccess.sshTarget) throw new Error(sshAccess.error || 'Failed to create SSH access');
        sshTarget = sshAccess.sshTarget;
      } else {
        const tok = await FreestyleApi.createIdentityToken(apiKey, ws.id || ws.name);
        if (!tok.token) throw new Error(tok.error || 'Failed to mint identity token');
        sshTarget = FreestyleApi.formatSshTarget(ws.name, tok.token);
      }

      if (role === 'primary') {
        draft.primarySshTarget = sshTarget;
        draft.primaryWorkspaceId = ws.id;
        draft.primarySlug = ws.name;
        await OnboardingHandler.advanceToStep3(ctx);
      } else {
        draft.secondarySshTarget = sshTarget;
        draft.secondaryWorkspaceId = ws.id;
        draft.secondarySlug = ws.name;
        if (draft.skipLlamaProvisioning) await OnboardingHandler.finalizeSetup(ctx);
        else await OnboardingLlamaHandler.advanceFromSecondaryVm(ctx);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const kb = new InlineKeyboard().text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
      await OnboardingHandler.updateWizard(ctx, `[ERROR] Failed to create SSH access: ${sanitizeErrorMessage(msg)}`, kb);
    }
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(); } catch (_) {}
    }
  }
}