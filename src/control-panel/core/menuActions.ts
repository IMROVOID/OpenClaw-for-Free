import { ControlPanelConfig, ServiceStatus } from './types.js';
import { SshTunnelManager } from './sshTunnelManager.js';
import { SshTerminalLauncher } from './sshTerminalLauncher.js';
import { VpsProbe } from './vpsProbe.js';
import { ServiceController, ManagedService, ServiceAction } from './serviceController.js';
import { EndpointResolver } from './endpointResolver.js';
import { DomainedUrlResolver, ResolvedUrlResult } from './domainedUrlResolver.js';
import { OmnirouteSync } from './omnirouteSync.js';

export interface ActionContext {
  config: ControlPanelConfig;
  status: ServiceStatus;
  tunnelMgr: SshTunnelManager;
  setStatusMessage: (msg: string) => void;
  render: () => void;
}

export class MenuActions {
  private static openPublicUrl(ctx: ActionContext, resolved: ResolvedUrlResult, credential?: string): boolean {
    if (!resolved.isDomained) return false;
    if (credential) SshTunnelManager.copyToClipboard(credential);
    SshTunnelManager.openBrowser(resolved.url);
    ctx.setStatusMessage('Public URL sent to browser; service availability has not been verified.');
    ctx.render();
    return true;
  }

  static async openOpenClaw(ctx: ActionContext): Promise<void> {
    const resolved = DomainedUrlResolver.resolveOpenclawUrl(ctx.config);
    if (MenuActions.openPublicUrl(ctx, resolved, ctx.config.openclawToken)) return;
    ctx.setStatusMessage('Connecting OpenClaw & OmniRoute tunnels...');
    ctx.render();
    const ok = await ctx.tunnelMgr.startPrimaryTunnel();
    const token = ctx.config.openclawToken || '';
    if (token) {
      SshTunnelManager.copyToClipboard(token);
    }
    const tokenParam = token ? encodeURIComponent(token) : '';
    const openclawUrl = tokenParam
      ? `http://127.0.0.1:${ctx.config.openclawPort}/?token=${tokenParam}#token=${tokenParam}`
      : `http://127.0.0.1:${ctx.config.openclawPort}/`;
    SshTunnelManager.openBrowser(openclawUrl);
    ctx.status.openclaw = ok;
    ctx.setStatusMessage(ok ? '[OK] OpenClaw launched with auto-auth token!' : '[WARN] OpenClaw tunnel connection failed.');
    ctx.render();
  }

  static async openOmniRoute(ctx: ActionContext): Promise<void> {
    const resolved = DomainedUrlResolver.resolveOmnirouteUrl(ctx.config);
    if (MenuActions.openPublicUrl(ctx, resolved, ctx.config.omniroutePassword || 'CHANGEME')) return;
    ctx.setStatusMessage('Connecting OmniRoute tunnel...');
    ctx.render();
    const ok = await ctx.tunnelMgr.startPrimaryTunnel();
    ctx.status.omniroute = ok;
    const pwd = ctx.config.omniroutePassword || 'CHANGEME';
    SshTunnelManager.copyToClipboard(pwd);
    SshTunnelManager.openBrowser(`http://127.0.0.1:${ctx.config.omniroutePort}/dashboard`);
    ctx.setStatusMessage(ok ? '[OK] OmniRoute opened! Admin password copied to clipboard.' : '[WARN] OmniRoute tunnel connection failed.');
    ctx.render();
  }

  static async openLlama(ctx: ActionContext): Promise<void> {
    const resolved = DomainedUrlResolver.resolveLlamaUrl(ctx.config);
    if (MenuActions.openPublicUrl(ctx, resolved, resolved.url)) return;
    ctx.setStatusMessage('Connecting Llama WebUI tunnel...');
    ctx.render();
    const ok = await ctx.tunnelMgr.startSecondaryTunnel();
    ctx.status.llama = ok;

    if (ok) {
      SshTunnelManager.copyToClipboard(`http://127.0.0.1:${ctx.config.llamaPort}`);
      SshTunnelManager.openBrowser(`http://127.0.0.1:${ctx.config.llamaPort}`);
      ctx.setStatusMessage('[OK] Llama WebUI opened!');
    } else {
      const endpoint = ctx.config.llama.activeEndpointUrl || EndpointResolver.resolveBaseUrl(ctx.config);
      if (endpoint) {
        const probe = await EndpointResolver.probeEndpoint(endpoint, 2500);
        if (probe.ok) {
          ctx.status.llama = true;
          const webUrl = endpoint.replace(/\/v1\/?$/i, '');
          SshTunnelManager.copyToClipboard(webUrl);
          SshTunnelManager.openBrowser(webUrl);
          ctx.setStatusMessage('[OK] Llama Cloud/Relay WebUI opened in browser!');
        } else {
          ctx.setStatusMessage('[WARN] Llama tunnel failed and remote endpoint unreachable.');
        }
      } else {
        ctx.setStatusMessage('[WARN] Llama tunnel failed to start.');
      }
    }
    ctx.render();
  }

  static async pingOmniRoute(ctx: ActionContext): Promise<void> {
    ctx.setStatusMessage('Sending quick inference ping through OmniRoute...');
    ctx.render();
    const ok = await VpsProbe.checkHttp(ctx.config.omniroutePort, '/v1/models', 2500);
    ctx.setStatusMessage(ok ? '[OK] OmniRoute is responsive and operational!' : '[WARN] OmniRoute did not respond on local port.');
    ctx.render();
  }

  static async openTerminal(ctx: ActionContext): Promise<void> {
    const ok = SshTerminalLauncher.launchPrimary(ctx.config);
    if (ok) {
      ctx.setStatusMessage('[OK] Launched interactive SSH terminal in a new window.');
    } else {
      ctx.setStatusMessage('[WARN] Failed to spawn terminal window. Verify OpenSSH client is installed.');
    }
    ctx.render();
  }

  static async handleServiceAction(
    ctx: ActionContext,
    service: ManagedService,
    action: ServiceAction
  ): Promise<void> {
    ctx.setStatusMessage(`Issuing ${action.toUpperCase()} for ${service}...`);
    ctx.render();
    const res = await ServiceController.executeServiceAction(ctx.config, service, action);
    ctx.setStatusMessage(res.success ? `[OK] ${res.message}` : `[WARN] ${res.message}`);
    ctx.render();
  }

  static async handleServiceUpdate(
    ctx: ActionContext,
    service: ManagedService
  ): Promise<void> {
    ctx.setStatusMessage(`Updating ${service} to latest release on remote VPS...`);
    ctx.render();
    const res = await ServiceController.updateService(ctx.config, service);
    ctx.setStatusMessage(res.success ? `[OK] ${res.message}` : `[WARN] ${res.message}`);
    ctx.render();
  }

  static async handleRestartAll(ctx: ActionContext): Promise<void> {
    ctx.setStatusMessage('Restarting all remote VPS services...');
    ctx.render();
    const res = await ServiceController.restartAll(ctx.config);
    ctx.setStatusMessage(res.success ? `[OK] ${res.message}` : `[WARN] ${res.message}`);
    ctx.render();
  }

  static async handleReconnectTunnels(ctx: ActionContext): Promise<void> {
    ctx.setStatusMessage('Reconnecting local SSH port-forwarding tunnels...');
    ctx.render();
    const state = await ctx.tunnelMgr.restartAllTunnels();
    ctx.status.openclaw = state.openclawActive;
    ctx.status.omniroute = state.omnirouteActive;
    ctx.status.llama = state.llamaActive;
    ctx.setStatusMessage('[OK] Tunnels reconnected successfully.');
    ctx.render();
  }

  static handleServiceManagerKey(
    key: string,
    curIdx: number,
    totalServices: number,
    services: Array<{ id: ManagedService }>,
    ctx: ActionContext,
    onTelemetryChange: () => void
  ): number {
    if (key === '\u001b' || key.toLowerCase() === 'b') return -1; // return to main menu
    if (key === '\u001b[A') return Math.max(0, curIdx - 1);
    if (key === '\u001b[B') return Math.min(totalServices - 1, curIdx + 1);
    if (['1', '2', '3', '4'].includes(key)) return parseInt(key, 10) - 1;

    const cur = services[curIdx];
    if (!cur) return curIdx;

    if (key.toLowerCase() === 's') {
      this.handleServiceAction(ctx, cur.id, 'start').then(() => onTelemetryChange());
    } else if (key.toLowerCase() === 'x') {
      this.handleServiceAction(ctx, cur.id, 'stop').then(() => onTelemetryChange());
    } else if (key.toLowerCase() === 'r') {
      this.handleServiceAction(ctx, cur.id, 'restart').then(() => onTelemetryChange());
    } else if (key.toLowerCase() === 'u') {
      this.handleServiceUpdate(ctx, cur.id).then(() => onTelemetryChange());
    } else if (key.toLowerCase() === 'a') {
      this.handleRestartAll(ctx).then(() => onTelemetryChange());
    } else if (key.toLowerCase() === 't') {
      this.handleReconnectTunnels(ctx);
    } else if (key.toLowerCase() === 'm') {
      this.syncModels(ctx);
    }
    return curIdx;
  }

  static async syncModels(ctx: ActionContext): Promise<void> {
    if (!ctx.config.primarySshTarget) {
      ctx.setStatusMessage('[WARN] VPS is not configured. Please complete setup first.');
      ctx.render();
      return;
    }
    ctx.setStatusMessage('Syncing OpenClaw models with connected OmniRoute...');
    ctx.render();
    const llamaOpts = ctx.config.llama.enabled
      ? {
          enabled: true,
          endpointUrl: EndpointResolver.resolveBaseUrl(ctx.config),
          modelName: ctx.config.llama.modelName || 'Qwen 2.5 7B'
        }
      : { enabled: false };

    const res = await OmnirouteSync.syncOmnirouteModelsToOpenClaw(
      ctx.config.primarySshTarget,
      ctx.config.omniroutePort,
      ctx.config.omnirouteApiKey,
      llamaOpts
    );
    if (res.success) {
      ctx.setStatusMessage(`[OK] Successfully synced ${res.modelCount} models with OpenClaw!`);
    } else {
      ctx.setStatusMessage(`[WARN] Model sync failed: ${res.error || 'Unknown error'}`);
    }
    ctx.render();
  }
}
