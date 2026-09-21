import { InlineKeyboard } from 'grammy';
import { VpsProbe } from '../../control-panel/core/vpsProbe.js';
import { VpsVerifier } from '../../control-panel/core/vpsVerifier.js';
import { InlineKeyboards } from '../keyboards/inlineKeyboards.js';
import { BotContext } from '../types.js';

export class DiagnosticsHandler {
  static async sendDiagnostics(ctx: BotContext, edit = false): Promise<void> {
    const cfg = ctx.config;
    if (!cfg.primarySshTarget) {
      await ctx.reply('[WARN] VPS is not configured. Please run /onboard first.');
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    const prim = await VpsProbe.queryVpsTelemetry(cfg.primarySshTarget, true, 'Primary VPS');
    const hw = prim.hardware;

    let text = `*VPS HARDWARE TELEMETRY & DIAGNOSTICS*\n\n` +
      `*Host*: \`${cfg.primarySshTarget}\` (${cfg.provider.toUpperCase()})\n` +
      `*Configured Specs*: ${cfg.vpsSpecs.cpuCores} vCPU | ${cfg.vpsSpecs.ramGb} GB RAM | ${cfg.vpsSpecs.storageGb} GB Disk\n\n`;

    if (hw) {
      text += `*Live Metrics*:\n` +
        `• CPU Usage: \`${hw.cpuPercent}%\` (Load: \`${hw.load1.toFixed(2)}\`)\n` +
        `• Memory: \`${(hw.ramUsedMb / 1024).toFixed(2)} GB / ${(hw.ramTotalMb / 1024).toFixed(2)} GB\` (${hw.ramPercent}%)\n` +
        `• Disk Usage: \`${(hw.diskUsedMb / 1024).toFixed(1)} GB / ${(hw.diskTotalMb / 1024).toFixed(1)} GB\` (${hw.diskPercent}%)\n\n`;
    } else {
      text += `_Live hardware metrics probe returned no data._\n\n`;
    }

    if (cfg.llama.enabled && cfg.llama.isSeparateVps && (cfg.llama.sshTarget || cfg.secondarySshTarget)) {
      const secTarget = cfg.llama.sshTarget || cfg.secondarySshTarget || '';
      const sec = await VpsProbe.queryVpsTelemetry(secTarget, false, 'Secondary Llama VPS');
      const secHw = sec.hardware;
      text += `*Secondary Llama VM* (\`${secTarget}\`):\n`;
      if (secHw) {
        text += `• CPU: \`${secHw.cpuPercent}%\` | RAM: \`${(secHw.ramUsedMb / 1024).toFixed(2)} / ${(secHw.ramTotalMb / 1024).toFixed(2)} GB\`\n\n`;
      } else {
        text += `• Reachability: ${sec.services.length > 0 ? '[ONLINE]' : '[OFFLINE]'}\n\n`;
      }
    }

    text += `*Active Daemons*:\n`;
    for (const s of prim.services) {
      text += `• \`${s.name}\`: ${s.status} ${s.uptime ? `(${s.uptime})` : ''}\n`;
    }

    const kb = InlineKeyboards.buildDiagnostics();
    if (edit && ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
    }
  }

  static async handlePing(ctx: BotContext): Promise<void> {
    const cfg = ctx.config;
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Testing API endpoints...' });

    const start = Date.now();
    const isUp = await VpsProbe.checkHttp(cfg.omniroutePort, '/v1/models', 3000);
    const latency = Date.now() - start;

    if (isUp) {
      await ctx.reply(
        `*OmniRoute Gateway Ping Result*\n\n` +
        `• Status: [ONLINE] *ONLINE & RESPONSIVE*\n` +
        `• Endpoint: \`http://127.0.0.1:${cfg.omniroutePort}/v1/models\`\n` +
        `• Latency: \`${latency} ms\`\n` +
        `• Model routes operational.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `*OmniRoute Gateway Ping Result*\n\n` +
        `• Status: [OFFLINE] *NO LOCAL RESPONSE* (timed out after ${latency} ms)\n` +
        `• Port: \`${cfg.omniroutePort}\`\n\n` +
        `_Note: Ensure SSH port-forwarding tunnel is active or start the daemon via /services._`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  static async runFullVerification(ctx: BotContext, edit = false): Promise<void> {
    const cfg = ctx.config;
    if (!cfg.primarySshTarget) {
      await ctx.reply('[WARN] VPS is not configured. Please run /onboard first.');
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    const targetMsgId = ctx.callbackQuery?.message?.message_id;
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Running 6-step diagnostics verification...' });
    }

    const waitText = `*Running OpenClaw, Channels & Relay Diagnostics...*\n` +
      `Executing \`scripts/verify_setup.sh\` checks on \`${cfg.primarySshTarget}\`...\n\n` +
      `⏳ [1/6] Supervisor Services\n` +
      `⏳ [2/6] OpenClaw Configuration\n` +
      `⏳ [3/6] Channel Status\n` +
      `⏳ [4/6] Models Catalog\n` +
      `⏳ [5/6] OmniRoute Gateway\n` +
      `⏳ [6/6] Egress Relay & Tunnel`;

    if (edit && targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, waitText, { parse_mode: 'Markdown' });
      } catch (_) {}
    } else {
      await ctx.reply(waitText, { parse_mode: 'Markdown' });
    }

    const report = await VpsVerifier.verify(cfg.primarySshTarget);
    const reportText = VpsVerifier.formatTelegramReport(report, cfg.primarySshTarget);
    const kb = new InlineKeyboard()
      .text('Re-run Verification', 'diag:verify')
      .text('Telemetry View', 'menu:diagnostics')
      .row()
      .text('< Back to Main Menu', 'menu:back');

    if (targetMsgId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, targetMsgId, reportText, { parse_mode: 'Markdown', reply_markup: kb });
        return;
      } catch (_) {}
    }
    await ctx.reply(reportText, { parse_mode: 'Markdown', reply_markup: kb });
  }
}
