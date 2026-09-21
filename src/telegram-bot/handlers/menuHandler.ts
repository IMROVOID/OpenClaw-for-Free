import crypto from 'crypto';
import { InlineKeyboard } from 'grammy';
import { ControlPanelConfig, ServiceStatus, StatusState } from '../../control-panel/core/types.js';
import { VpsProbe, RemoteServiceHealth } from '../../control-panel/core/vpsProbe.js';
import { RailwayHelper } from '../../control-panel/core/railwayHelper.js';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { VmSshAutoRenewer } from '../../control-panel/core/vmSshAutoRenewer.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { BotSessionManager } from '../services/botSessionManager.js';
import { OnboardingHandler } from './onboardingHandler.js';
import { RecoveryHandler } from './recoveryHandler.js';
import { DomainedUrlResolver } from '../../control-panel/core/domainedUrlResolver.js';
import { OpenclawConfigSyncer } from '../../control-panel/core/openclawConfigSyncer.js';
import { BotContext } from '../types.js';

export class MenuHandler {
  static getStatusBullet(val: StatusState): string {
    if (val === 'detecting') return '🟡';
    return val ? '🟢' : '🔴';
  }

  static getBadge(val: StatusState, activeBadge = 'ONLINE', inactiveBadge = 'INACTIVE'): string {
    if (val === 'detecting') return 'DETECTING...';
    return val ? activeBadge : inactiveBadge;
  }

  private static async probeLlama(config: ControlPanelConfig, primServices: RemoteServiceHealth[]): Promise<boolean> {
    if (!config.llama.enabled) return false;
    if (!config.llama.isSeparateVps) {
      const lm = primServices.find((s) => s.name.toLowerCase().includes('llama'));
      return lm ? lm.status.toLowerCase() === 'running' : false;
    }

    let secTarget = config.llama.sshTarget || config.secondarySshTarget;
    if (!secTarget) return false;

    const cmd = 'pgrep -f llama-server >/dev/null && echo RUNNING || echo STOPPED';
    let check = await VpsProbe.execRemote(secTarget, cmd, 6);

    if (check.code !== 0) {
      const renewed = await VmSshAutoRenewer.refreshSecondaryVmSsh(config);
      if (renewed.renewed && renewed.newSshTarget) {
        secTarget = renewed.newSshTarget;
        check = await VpsProbe.execRemote(secTarget, cmd, 6);
      }
    }

    return check.stdout.includes('RUNNING');
  }

  static async probeStatus(config: ControlPanelConfig): Promise<ServiceStatus> {
    const status: ServiceStatus = {
      openclaw: 'detecting',
      omniroute: 'detecting',
      llama: 'detecting',
      egressRelay: 'detecting',
      primarySsh: 'detecting'
    };

    if (!config.primarySshTarget) {
      return { openclaw: false, omniroute: false, llama: false, egressRelay: false, primarySsh: false };
    }

    let sshOk = (await VpsProbe.testSshReachability(config.primarySshTarget, 8)).success;
    if (!sshOk) {
      const renewed = await VmSshAutoRenewer.refreshPrimaryVmSsh(config);
      if (renewed.renewed && config.primarySshTarget) {
        sshOk = (await VpsProbe.testSshReachability(config.primarySshTarget, 8)).success;
      }
    }
    status.primarySsh = sshOk;

    if (!sshOk) {
      return { openclaw: false, omniroute: false, llama: false, egressRelay: false, primarySsh: false };
    }

    const prim = await VpsProbe.queryVpsTelemetry(config.primarySshTarget, true, 'Primary VPS');
    const oc = prim.services.find((s) => s.name.toLowerCase().includes('openclaw'));
    const or = prim.services.find((s) => s.name.toLowerCase().includes('omniroute'));

    status.openclaw = oc ? oc.status.toLowerCase() === 'running' : false;
    status.omniroute = or ? or.status.toLowerCase() === 'running' : false;
    status.llama = await this.probeLlama(config, prim.services);

    if (config.provider === 'daytona') {
      const egress = await RailwayHelper.testVpsEgressTunnel(config.primarySshTarget);
      status.egressRelay = egress.active;
    } else {
      status.egressRelay = true;
    }

    return status;
  }

  static formatMenuText(config: ControlPanelConfig, status: ServiceStatus): string {
    const isFreestyle = config.provider === 'freestyle';
    const title = isFreestyle
      ? '*OPENCLAW & FREESTYLE CONTROL PANEL*'
      : '*OPENCLAW & DAYTONA CONTROL PANEL*';

    const pTarget = config.primarySshTarget || 'Not Configured (Run Setup Assistant)';
    const secTarget = config.llama.enabled && config.llama.isSeparateVps
      ? (config.llama.sshTarget || config.secondarySshTarget || 'N/A')
      : 'Co-located / Disabled';

    const sshBullet = this.getStatusBullet(status.primarySsh);
    const sshBadge = this.getBadge(status.primarySsh, 'REACHABLE', 'UNREACHABLE');

    const ocBullet = this.getStatusBullet(status.openclaw);
    const ocBadge = this.getBadge(status.openclaw, 'ONLINE', 'INACTIVE');

    const orBullet = this.getStatusBullet(status.omniroute);
    const orBadge = this.getBadge(status.omniroute, 'ONLINE', 'INACTIVE');

    const lmBullet = !config.llama.enabled ? '⚪' : this.getStatusBullet(status.llama);
    const lmBadge = !config.llama.enabled ? 'DISABLED' : this.getBadge(status.llama, 'ONLINE', 'INACTIVE');

    const egressLabel = isFreestyle ? 'Network Egress' : 'Railway Egress Relay';
    const egressBullet = isFreestyle ? (status.primarySsh ? '🟢' : '🔴') : this.getStatusBullet(status.egressRelay);
    const egressBadge = isFreestyle
      ? (status.primarySsh ? 'DIRECT (32GB)' : 'OFFLINE')
      : this.getBadge(status.egressRelay, 'ONLINE', 'OFFLINE');

    return `${title}\n\n` +
      `*Primary Target*:\n\`${pTarget}\`\n` +
      `*Secondary Target*:\n\`${secTarget}\`\n\n` +
      `*SYSTEM STATUS*\n` +
      `${sshBullet} Primary SSH Reachability : ${sshBadge}\n` +
      `${ocBullet} OpenClaw (Port ${config.openclawPort}) : ${ocBadge}\n` +
      `${orBullet} OmniRoute (Port ${config.omniroutePort}) : ${orBadge}\n` +
      `${lmBullet} Llama AI (Port ${config.llamaPort}) : ${lmBadge}\n` +
      `${egressBullet} ${egressLabel} : ${egressBadge}\n\n` +
      `_Select an action below:_`;
  }

  static isConfigured(config: ControlPanelConfig): boolean {
    if (!config.primarySshTarget || !config.primarySshTarget.trim()) return false;
    const target = config.primarySshTarget.trim().toLowerCase();
    if (target.includes('not configured') || target === 'none' || target === 'n/a') return false;
    return true;
  }

  static async sendMainMenu(ctx: BotContext, edit = false): Promise<void> {
    if (!this.isConfigured(ctx.config)) {
      await OnboardingHandler.startOnboarding(ctx);
      return;
    }

    if (edit && ctx.callbackQuery) {
      try {
        await ctx.editMessageText('[STATUS] Refreshing system telemetry and checking daemons...', {
          parse_mode: 'Markdown'
        });
      } catch (_) {}

      const status = await this.probeStatus(ctx.config);
      const hasDedicatedSec = Boolean(ctx.config.llama.enabled && ctx.config.llama.isSeparateVps);
      const isSecDead = hasDedicatedSec && !status.llama;

      if (!status.primarySsh || isSecDead) {
        await RecoveryHandler.startRecovery(ctx, true);
        try {
          await ctx.answerCallbackQuery();
        } catch (_) {}
        return;
      }

      const text = this.formatMenuText(ctx.config, status);
      const keyboard = InlineKeyboards.buildMainMenu(ctx.config, status);

      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('message is not modified')) {
          console.warn('[MainMenu Edit Warning]', msg);
        }
      }
      try {
        await ctx.answerCallbackQuery();
      } catch (_) {}
    } else {
      const loadingMsg = await ctx.reply('[STATUS] Loading system telemetry and checking daemons...', {
        parse_mode: 'Markdown'
      });
      const status = await this.probeStatus(ctx.config);
      const hasDedicatedSec = Boolean(ctx.config.llama.enabled && ctx.config.llama.isSeparateVps);
      const isSecDead = hasDedicatedSec && !status.llama;

      if (!status.primarySsh || isSecDead) {
        await RecoveryHandler.startRecovery(ctx, true, loadingMsg.message_id);
        return;
      }

      const text = this.formatMenuText(ctx.config, status);
      const keyboard = InlineKeyboards.buildMainMenu(ctx.config, status);

      try {
        await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      }
    }
  }

  static async handleWebUiAction(ctx: BotContext, type: 'openclaw' | 'omniroute' | 'llama'): Promise<void> {
    const cfg = ctx.config;
    let text = '';
    if (type === 'openclaw') {
      if (cfg.primarySshTarget) {
        try {
          let liveToken = await OpenclawConfigSyncer.fetchLiveToken(cfg.primarySshTarget);
          if (!liveToken) {
            const renewRes = await VmSshAutoRenewer.refreshPrimaryVmSsh(cfg);
            if (renewRes.renewed && cfg.primarySshTarget) {
              liveToken = await OpenclawConfigSyncer.fetchLiveToken(cfg.primarySshTarget);
            }
          }
          if (liveToken && liveToken !== cfg.openclawToken) {
            cfg.openclawToken = liveToken;
            ConfigManager.save(cfg, ctx.from?.id);
          }
        } catch (_) {}
      }
      if (!cfg.openclawToken && cfg.primarySshTarget) {
        cfg.openclawToken = crypto.randomBytes(24).toString('hex');
        ConfigManager.save(cfg, ctx.from?.id);
        OpenclawConfigSyncer.sync(cfg.primarySshTarget, cfg.openclawToken, cfg.telegramBotToken).catch(() => {});
      }
      const resolved = DomainedUrlResolver.resolveOpenclawUrl(cfg);
      const token = cfg.openclawToken || 'No token found';
      const urlLabel = resolved.isDomained ? '• *Permanent Public URL*' : '• *Local Tunnel URL*';
      const note = resolved.isDomained ? '\n_(Zero port forwarding required — accessible directly via browser & Telegram WebApp)_\n' : '\n';
      text = `*OpenClaw Gateway Access*\n\n` +
        `${urlLabel}: [${resolved.url}](${resolved.url})\n` +
        `• *Local Port*: \`${cfg.openclawPort}\`\n` +
        `• *Gateway Secret (Access Token)*: \`${token}\`${note}\n` +
        `_Note: When prompted for "Gateway secret", paste the token above._\n\n` +
        `_Forward port via SSH (Optional):_\n\`${resolved.portForwardCmd}\``;
    } else if (type === 'omniroute') {
      const resolved = DomainedUrlResolver.resolveOmnirouteUrl(cfg);
      const pwd = cfg.omniroutePassword || 'CHANGEME';
      const urlLabel = resolved.isDomained ? '• *Permanent Public URL*' : '• *Dashboard URL*';
      const note = resolved.isDomained ? '\n_(Zero port forwarding required — accessible directly via browser & Telegram WebApp)_\n' : '\n';
      text = `*OmniRoute AI Gateway Dashboard*\n\n` +
        `${urlLabel}: [${resolved.url}](${resolved.url})\n` +
        `• *Local Port*: \`${cfg.omniroutePort}\`\n` +
        `• *Admin Password*: \`${pwd}\`${note}\n` +
        `_Forward port via SSH (Optional):_\n\`${resolved.portForwardCmd}\``;
    } else if (type === 'llama') {
      const resolved = DomainedUrlResolver.resolveLlamaUrl(cfg);
      const urlLabel = resolved.isDomained ? '• *Permanent Public URL*' : '• *Endpoint*';
      const note = resolved.isDomained ? '\n_(Zero port forwarding required — accessible directly via browser & Telegram WebApp)_\n' : '\n';
      text = `*Llama AI Inference Service*\n\n` +
        `• *Model*: \`${cfg.llama.modelName || 'Qwen 2.5 7B'}\`\n` +
        `• *Quantization*: \`${cfg.llama.quantization || 'Q4_0'}\`\n` +
        `• *Context Size*: \`${cfg.llama.contextSize || 32768}\` tokens\n` +
        `${urlLabel}: [${resolved.url}](${resolved.url})${note}\n` +
        `_Forward port via SSH (Optional):_\n\`${resolved.portForwardCmd}\``;
    }
    const kb = new InlineKeyboard();
    if (type === 'openclaw') {
      kb.text('✅ Approve Connected Browser', 'menu:approve_device').row();
    }
    kb.text('< Back to Menu', 'menu:back');
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
        await ctx.answerCallbackQuery();
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }

  static async handleApproveDevice(ctx: BotContext): Promise<void> {
    const cfg = ctx.config;
    if (!cfg.primarySshTarget) {
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery({ text: 'SSH target not configured.', show_alert: true }); } catch (_) {}
      }
      return;
    }
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery({ text: 'Approving browser device...' }); } catch (_) {}
    }
    try {
      const approveCmd = `python3 -c "import json, subprocess
try:
  data = json.loads(subprocess.check_output('/usr/local/share/nvm/current/bin/openclaw devices list --json 2>/dev/null || openclaw devices list --json 2>/dev/null', shell=True))
  for p in data.get('pending', []):
    subprocess.call(f'/usr/local/share/nvm/current/bin/openclaw devices approve {p[\\"requestId\\"]} 2>/dev/null || openclaw devices approve {p[\\"requestId\\"]} 2>/dev/null', shell=True)
except Exception:
  pass" 2>/dev/null || true`;
      let res = await VpsProbe.execRemote(cfg.primarySshTarget, approveCmd, 15);
      if (res.code !== 0) {
        const renewRes = await VmSshAutoRenewer.refreshPrimaryVmSsh(cfg);
        if (renewRes.renewed && cfg.primarySshTarget) {
          await VpsProbe.execRemote(cfg.primarySshTarget, approveCmd, 15);
        }
      }
      await ctx.reply(
        '✅ *Browser Device Approved!*\n\n' +
        'Your browser pairing request has been approved. The page will connect automatically.',
        { parse_mode: 'Markdown' }
      );
    } catch (err: any) {
      await ctx.reply(`⚠️ Failed to approve device: ${err.message || 'Unknown error'}`);
    }
  }

  static async handleTerminalInfo(ctx: BotContext): Promise<void> {
    const cfg = ctx.config;
    const text = `*Remote Terminal (SSH Shell) Commands*\n\n` +
      `*Primary VM (${cfg.provider})*:\n` +
      `\`ssh ${cfg.primarySshTarget || '<not-configured>'}\`\n\n` +
      (cfg.llama.enabled && cfg.llama.isSeparateVps ? `*Secondary VM (Llama)*:\n\`ssh ${cfg.llama.sshTarget || cfg.secondarySshTarget || '<not-configured>'}\`\n\n` : '') +
      `*Full Port Forwarding Tunnel*:\n` +
      `\`ssh -N -L ${cfg.openclawPort}:127.0.0.1:${cfg.openclawPort} -L ${cfg.omniroutePort}:127.0.0.1:${cfg.omniroutePort} ${cfg.primarySshTarget}\``;

    const kb = new InlineKeyboard().text('< Back to Menu', 'menu:back');
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
        await ctx.answerCallbackQuery();
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }

  static async handleLogout(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id ?? ctx.chat?.id;
    if (userId) {
      ConfigManager.clearUserConfig(userId);
      BotSessionManager.clearUserSession(userId);
      ctx.config = ConfigManager.loadForUser(userId);
    }
    if (!ctx.botConfig?.isPublic) {
      ConfigManager.clear();
      ctx.config = ConfigManager.load();
    }
    const text = `*Configuration Reset*\n\nLocal configuration has been cleared. Remote VPS containers remain running. Tap below or run /onboard to reconfigure anytime.`;
    const kb = new InlineKeyboard().text('Start Setup', 'onboard:step:1');
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
        await ctx.answerCallbackQuery();
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }
}
