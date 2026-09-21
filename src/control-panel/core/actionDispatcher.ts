import { ActionContext, MenuActions } from './menuActions.js';
import { ServiceManagerView } from '../tui/serviceManagerView.js';
import { LogsView } from '../tui/logsView.js';
import { SshTerminalLauncher } from './sshTerminalLauncher.js';
import { LogServiceType } from './vpsLogFetcher.js';
import { ActiveTab } from './types.js';
import { DomainedUrlResolver } from './domainedUrlResolver.js';

export interface DispatcherHost {
  activeTab: ActiveTab;
  selectedMenuIndex: number;
  selectedServiceIndex: number;
  menuHitboxKeys: string[];
  activeLogService: LogServiceType;
  createActionContext(): ActionContext;
  setActiveTab(tab: ActiveTab): void;
  setSelectedServiceIndex(idx: number): void;
  loadLogs(service: LogServiceType): Promise<void>;
  refreshTelemetry(): Promise<void>;
  navigateSelection(delta: number): void;
  render(): void;
  shutdown(): void;
  logout(): void;
  launchSetupAssistant?(): Promise<void>;
}

export class ActionDispatcher {
  static async triggerMenuAction(actionKey: string, host: DispatcherHost): Promise<void> {
    const ctx = host.createActionContext();
    const key = actionKey.toUpperCase();
    if (key === '1') {
      if (ctx.status.openclaw !== true) {
        ctx.setStatusMessage(ctx.status.openclaw === 'detecting'
          ? '[!] OpenClaw service status is still detecting. Please wait...'
          : '[!] OpenClaw service is INACTIVE. Start it via Service Manager [4] before launching browser.');
        host.render();
        return;
      }
      await MenuActions.openOpenClaw(ctx);
    }
    else if (key === '2') {
      if (ctx.status.omniroute !== true) {
        ctx.setStatusMessage(ctx.status.omniroute === 'detecting'
          ? '[!] OmniRoute service status is still detecting. Please wait...'
          : '[!] OmniRoute service is INACTIVE. Start it via Service Manager [4] before launching browser.');
        host.render();
        return;
      }
      await MenuActions.openOmniRoute(ctx);
    }
    else if (key === '3') {
      if (ctx.status.llama !== true) {
        ctx.setStatusMessage(ctx.status.llama === 'detecting'
          ? '[!] Llama AI service status is still detecting. Please wait...'
          : '[!] Llama AI service is INACTIVE. Start it via Service Manager [4] before launching browser.');
        host.render();
        return;
      }
      await MenuActions.openLlama(ctx);
    }
    else if (key === '4') { host.setActiveTab('service_manager'); ctx.setStatusMessage(''); host.refreshTelemetry().then(() => host.render()); }
    else if (key === '5') { host.setActiveTab('diagnostics'); ctx.setStatusMessage(''); host.refreshTelemetry().then(() => host.render()); }
    else if (key === '6') { host.setActiveTab('logs'); host.loadLogs(host.activeLogService); }
    else if (key === '7') {
      const cfg = ctx.config;
      const hasSecondary = !!(cfg.secondarySshTarget || (cfg.llama.enabled && cfg.llama.isSeparateVps && cfg.llama.sshTarget));
      if (hasSecondary) {
        host.setActiveTab('ssh_select');
      } else {
        await MenuActions.openTerminal(ctx);
      }
    }
    else if (key === '8') {
      if (host.launchSetupAssistant) {
        await host.launchSetupAssistant();
        return;
      }
    }
    else if (key === '9') await MenuActions.pingOmniRoute(ctx);
    else if (key === 'L') host.logout();
    else if (key === 'Q') host.shutdown();
    host.render();
  }

  static handleKeyboard(key: string, host: DispatcherHost): void {
    if (key === '\u0003' || (key.toLowerCase() === 'q' && host.activeTab === 'main_menu')) {
      host.shutdown();
      return;
    }
    if (key.toLowerCase() === 'l' && host.activeTab === 'main_menu') {
      host.logout();
      return;
    }

    if (host.activeTab === 'ssh_select') {
      const ctx = host.createActionContext();
      if (key === '\u001b' || key.toLowerCase() === 'b') {
        host.setActiveTab('main_menu');
      } else if (key === '1') {
        const ok = SshTerminalLauncher.launchPrimary(ctx.config);
        ctx.setStatusMessage(ok ? '[OK] Launched Primary VM SSH terminal in a new window.' : '[WARN] Failed to spawn SSH terminal.');
        host.setActiveTab('main_menu');
      } else if (key === '2') {
        const ok = SshTerminalLauncher.launchSecondary(ctx.config);
        ctx.setStatusMessage(ok ? '[OK] Launched Secondary VM SSH terminal in a new window.' : '[WARN] Failed to spawn SSH terminal.');
        host.setActiveTab('main_menu');
      }
      host.render();
      return;
    }

    if (host.activeTab === 'service_manager') {
      this.handleServiceManagerInput(key, host);
      return;
    }

    if (host.activeTab === 'diagnostics') {
      if (key === '\u001b' || key.toLowerCase() === 'b') {
        host.setActiveTab('main_menu');
      } else if (key.toLowerCase() === 'r') {
        const ctx = host.createActionContext();
        ctx.setStatusMessage('Refreshing telemetry...');
        host.render();
        host.refreshTelemetry().then(() => { ctx.setStatusMessage(''); host.render(); });
        return;
      } else if (key.toLowerCase() === 's' || key === '4') {
        host.setActiveTab('service_manager');
      }
      host.render();
      return;
    }

    if (host.activeTab === 'logs') {
      const ctx = host.createActionContext();
      const tabs = LogsView.getTabs(ctx.config.provider);
      const currIdx = tabs.findIndex((t) => t.id === host.activeLogService);

      if (key === '\u001b' || key.toLowerCase() === 'b') {
        host.setActiveTab('main_menu');
      } else if (key === '\u001b[D') {
        const nextIdx = (currIdx - 1 + tabs.length) % tabs.length;
        host.loadLogs(tabs[nextIdx].id);
        return;
      } else if (key === '\u001b[C') {
        const nextIdx = (currIdx + 1) % tabs.length;
        host.loadLogs(tabs[nextIdx].id);
        return;
      } else if (['1', '2', '3', '4'].includes(key)) {
        const matched = tabs.find((t) => t.num === key);
        if (matched) {
          host.loadLogs(matched.id);
          return;
        }
      } else if (key.toLowerCase() === 'r') {
        host.loadLogs(host.activeLogService);
        return;
      }
      host.render();
      return;
    }

    if (key === '\u001b[A') {
      host.navigateSelection(-1);
    } else if (key === '\u001b[B') {
      host.navigateSelection(1);
    } else if (key === '\r' || key === '\n') {
      const currentKey = host.menuHitboxKeys[host.selectedMenuIndex];
      if (currentKey) this.triggerMenuAction(currentKey, host);
    } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9', 'L', 'l', 'Q', 'q'].includes(key)) {
      this.triggerMenuAction(key, host);
    }
  }

  private static handleServiceManagerInput(key: string, host: DispatcherHost): void {
    const ctx = host.createActionContext();
    const nextIdx = MenuActions.handleServiceManagerKey(
      key,
      host.selectedServiceIndex,
      ServiceManagerView.services.length,
      ServiceManagerView.services,
      ctx,
      () => { host.refreshTelemetry().then(() => host.render()); }
    );
    if (nextIdx === -1) {
      host.setActiveTab('main_menu');
    } else {
      host.setSelectedServiceIndex(nextIdx);
    }
    host.render();
  }
}
