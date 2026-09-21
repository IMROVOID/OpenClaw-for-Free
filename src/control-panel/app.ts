import { ControlPanelConfig, ServiceStatus, ActiveTab } from './core/types.js';
import { ConfigManager } from './core/configManager.js';
import { SshTunnelManager } from './core/sshTunnelManager.js';
import { VpsProbe, RemoteServiceHealth } from './core/vpsProbe.js';
import { VpsLiveHardware } from './core/hardwareTelemetry.js';
import { RailwayHelper } from './core/railwayHelper.js';
import { Screen } from './tui/screen.js';
import { extractMouseEvents, MouseEvent } from './tui/mouse.js';
import { MenuView, MenuItemHitbox } from './tui/menuView.js';
import { DiagnosticsView } from './tui/diagnosticsView.js';
import { LogsView, LogTabHitbox } from './tui/logsView.js';
import { SshSelectView, SshSelectHitbox } from './tui/sshSelectView.js';
import { SshTerminalLauncher } from './core/sshTerminalLauncher.js';
import { ServiceManagerView } from './tui/serviceManagerView.js';
import { VpsLogFetcher, LogServiceType } from './core/vpsLogFetcher.js';
import { ActionContext } from './core/menuActions.js';
import { ActionDispatcher, DispatcherHost } from './core/actionDispatcher.js';
import { VmRecoveryHandler } from './core/vmRecoveryHandler.js';
import { VmSshAutoRenewer } from './core/vmSshAutoRenewer.js';
import { RailwayIngressVerifier } from './core/railwayIngressVerifier.js';

export class ControlPanelApp implements DispatcherHost {
  private config: ControlPanelConfig;
  private tunnelMgr: SshTunnelManager;
  activeTab: ActiveTab = 'main_menu';
  selectedMenuIndex = 0;
  selectedServiceIndex = 0;
  private isRunning = true;
  private status: ServiceStatus = {
    openclaw: 'detecting',
    omniroute: 'detecting',
    llama: 'detecting',
    egressRelay: 'detecting',
    primarySsh: 'detecting'
  };
  private remoteServices: RemoteServiceHealth[] = [];
  private liveHardware: { primary: VpsLiveHardware | null; secondary: VpsLiveHardware | null } = {
    primary: null,
    secondary: null
  };
  private egressInfo: { active: boolean; response?: string } = { active: false, response: '' };
  private menuHitboxes: MenuItemHitbox[] = [];
  private logHitboxes: LogTabHitbox[] = [];
  private sshHitboxes: SshSelectHitbox[] = [];
  private statusMessage = '';
  activeLogService: LogServiceType = 'openclaw';
  private logLines: string[] = [];
  private logTarget = '';

  constructor() {
    this.config = ConfigManager.load();
    this.tunnelMgr = new SshTunnelManager(this.config);
  }

  async start(): Promise<void> {
    process.stdout.write(Screen.enterAltBuffer + Screen.hideCursor);
    await RailwayIngressVerifier.autoDetectAndVerify(this.config);

    VpsProbe.testSshReachability(this.config.primarySshTarget, 12).then(async (sshCheck) => {
      let ok = sshCheck.success;
      if (!ok) {
        const renewed = await VmSshAutoRenewer.refreshPrimaryVmSsh(this.config);
        if (renewed.renewed && this.config.primarySshTarget) {
          ok = (await VpsProbe.testSshReachability(this.config.primarySshTarget, 12)).success;
        }
      }
      this.status.primarySsh = ok;
      if (!ok && this.status.egressRelay === 'detecting') this.status.egressRelay = false;
      await this.refreshTelemetry();
      this.render();
    }).catch(() => {
      this.status.primarySsh = false;
      this.render();
    });

    this.tunnelMgr.startAllTunnels().then(() => this.refreshTelemetry()).then(() => this.render()).catch(() => {});
    this.setupInputHandling();
    this.render();

    const timer = setInterval(() => {
      if (!this.isRunning) { clearInterval(timer); return; }
      this.refreshTelemetry().then(() => this.render()).catch(() => {});
    }, 5000);
  }

  private ensureRawMode(): void {
    if (process.stdin.isTTY && !process.stdin.isRaw) {
      try { process.stdin.setRawMode(true); } catch (_) {}
    }
  }

  async refreshTelemetry(): Promise<void> {
    const tunnels = await this.tunnelMgr.ensureTunnelsRunning();

    if (this.status.primarySsh === true) {
      const prim = await VpsProbe.queryVpsTelemetry(this.config.primarySshTarget, true, 'Primary VPS');
      this.remoteServices = [...prim.services];
      this.liveHardware.primary = prim.hardware;

      if (this.config.llama.enabled && this.config.llama.isSeparateVps) {
        let secTarget = this.config.llama.sshTarget || this.config.secondarySshTarget;
        if (secTarget) {
          let sec = await VpsProbe.queryVpsTelemetry(secTarget, false, 'Secondary Llama VPS');
          if (sec.services.length === 0) {
            const renewed = await VmSshAutoRenewer.refreshSecondaryVmSsh(this.config);
            if (renewed.renewed) {
              secTarget = this.config.llama.sshTarget || this.config.secondarySshTarget || '';
              if (secTarget) {
                sec = await VpsProbe.queryVpsTelemetry(secTarget, false, 'Secondary Llama VPS');
              }
            }
          }
          this.remoteServices.push(...sec.services);
          this.liveHardware.secondary = sec.hardware;
        }
      }
      if (this.config.provider === 'freestyle') {
        this.status.egressRelay = this.status.primarySsh === true;
      } else {
        this.egressInfo = await RailwayHelper.testVpsEgressTunnel(this.config.primarySshTarget);
        this.status.egressRelay = this.egressInfo.active;
      }
    } else if (this.status.primarySsh === false) {
      this.status.egressRelay = false;
    }

    const ocRemote = this.remoteServices.some((s) => s.name.toLowerCase().includes('openclaw') && s.status === 'RUNNING');
    const orRemote = this.remoteServices.some((s) => s.name.toLowerCase().includes('omniroute') && s.status === 'RUNNING');
    const lmRemote = this.remoteServices.some((s) => s.name.toLowerCase().includes('llama') && s.status === 'RUNNING');

    this.status.openclaw = tunnels.openclawActive || ocRemote;
    this.status.omniroute = tunnels.omnirouteActive || orRemote;
    this.status.llama = tunnels.llamaActive || lmRemote;
  }

  render(): void {
    if (!this.isRunning) return;
    this.ensureRawMode();
    const width = process.stdout.columns || 90;

    let outputLines: string[] = [];
    if (this.activeTab === 'main_menu') {
      const res = MenuView.render(this.config, this.status, this.selectedMenuIndex, width);
      outputLines = res.lines;
      this.menuHitboxes = res.hitboxes;
    } else if (this.activeTab === 'service_manager') {
      outputLines = ServiceManagerView.render(this.config, this.remoteServices, this.selectedServiceIndex, width);
    } else if (this.activeTab === 'diagnostics') {
      outputLines = DiagnosticsView.render(
        this.config, this.remoteServices,
        { openclaw: this.status.openclaw === true, omniroute: this.status.omniroute === true, llama: this.status.llama === true, proxy: this.status.egressRelay === true },
        this.egressInfo, this.config.vpsSpecs, width, this.liveHardware
      );
    } else if (this.activeTab === 'logs') {
      const res = LogsView.render(this.activeLogService, this.logTarget || this.config.primarySshTarget, this.logLines, width, this.config.provider);
      outputLines = res.lines;
      this.logHitboxes = res.hitboxes;
    } else if (this.activeTab === 'ssh_select') {
      const res = SshSelectView.render(this.config, width);
      outputLines = res.lines;
      this.sshHitboxes = res.hitboxes;
    }

    if (this.statusMessage) outputLines.push(`\n[*] ${this.statusMessage}`);
    process.stdout.write(Screen.clear + outputLines.join('\n'));
  }

  private setupInputHandling(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (raw: string) => {
      this.ensureRawMode();
      const { events, remainingText } = extractMouseEvents(raw);

      for (const ev of events) {
        if (ev.type === 'press') {
          if (ev.button === 2) this.handleRightClick();
          else if (ev.button === 0) this.handleMouseClick(ev);
          else if (ev.button === 64) this.navigateSelection(-1);
          else if (ev.button === 65) this.navigateSelection(1);
        }
      }

      if (remainingText) this.handleKeyboard(remainingText);
    });
  }

  navigateSelection(delta: number): void {
    if (this.activeTab === 'main_menu') {
      const len = this.menuHitboxes.length;
      if (len > 0) {
        let next = this.selectedMenuIndex;
        for (let i = 0; i < len; i++) {
          next = (next + delta + len) % len;
          if (!this.menuHitboxes[next]?.disabled) { this.selectedMenuIndex = next; break; }
        }
      }
    } else if (this.activeTab === 'service_manager') {
      this.selectedServiceIndex = Math.max(0, Math.min(ServiceManagerView.services.length - 1, this.selectedServiceIndex + delta));
    }
    this.render();
  }

  private handleRightClick(): void {
    if (this.activeTab !== 'main_menu') { this.activeTab = 'main_menu'; this.statusMessage = ''; this.render(); }
  }

  private handleMouseClick(ev: MouseEvent): void {
    if (this.activeTab === 'main_menu') {
      const hit = this.menuHitboxes.find((h) => ev.row === h.row && ev.col >= h.colStart && ev.col <= h.colEnd);
      if (hit) {
        if (hit.disabled) {
          this.statusMessage = `[!] Option [${hit.key}] is disabled while service is inactive.`;
          this.render();
          return;
        }
        this.selectedMenuIndex = hit.index;
        ActionDispatcher.triggerMenuAction(hit.key, this);
      }
    } else if (this.activeTab === 'logs') {
      const tabHit = this.logHitboxes.find((h) => ev.row === h.row && ev.col >= h.colStart && ev.col <= h.colEnd);
      if (tabHit) this.loadLogs(tabHit.id);
    } else if (this.activeTab === 'ssh_select') {
      const sshHit = this.sshHitboxes.find((h) => ev.row === h.row && ev.col >= h.colStart && ev.col <= h.colEnd);
      if (sshHit) {
        const ok = sshHit.targetType === 'primary'
          ? SshTerminalLauncher.launchPrimary(this.config)
          : SshTerminalLauncher.launchSecondary(this.config);
        this.statusMessage = ok ? `[OK] Launched ${sshHit.targetType} VM SSH terminal.` : '[WARN] Failed to spawn terminal.';
        this.activeTab = 'main_menu';
        this.render();
      }
    }
  }

  async loadLogs(service: LogServiceType): Promise<void> {
    this.activeLogService = service;
    this.statusMessage = `Fetching ${service} logs from remote VPS...`;
    this.render();
    const res = await VpsLogFetcher.fetchLogs(this.config, service);
    this.logLines = res.lines;
    this.logTarget = res.target;
    this.statusMessage = '';
    this.render();
  }

  get menuHitboxKeys(): string[] { return this.menuHitboxes.map((h) => h.key); }
  setActiveTab(tab: ActiveTab): void { this.activeTab = tab; }
  setSelectedServiceIndex(idx: number): void { this.selectedServiceIndex = idx; }
  private handleKeyboard(key: string): void { ActionDispatcher.handleKeyboard(key, this); }

  createActionContext(): ActionContext {
    return {
      config: this.config,
      status: this.status,
      tunnelMgr: this.tunnelMgr,
      setStatusMessage: (msg: string) => { this.statusMessage = msg; },
      render: () => { this.render(); }
    };
  }

  logout(): void {
    this.isRunning = false;
    this.tunnelMgr.stopAll();
    ConfigManager.clear();
    process.stdout.write(Screen.exitAltBuffer + Screen.showCursor);
    console.log('\n====================================================\n  Successfully logged out.\n  Local configuration and session tokens cleared.\n====================================================\n');
    process.exit(0);
  }

  async launchSetupAssistant(): Promise<void> {
    this.tunnelMgr.stopAll();
    process.stdout.write(Screen.exitAltBuffer + Screen.showCursor);
    try {
      await VmRecoveryHandler.showSetupAssistantMenu(this.config);
      this.config = ConfigManager.load();
      this.tunnelMgr = new SshTunnelManager(this.config);
    } finally {
      process.stdout.write(Screen.enterAltBuffer + Screen.hideCursor);
      this.ensureRawMode();
      this.tunnelMgr.startAllTunnels().then(() => this.refreshTelemetry()).then(() => this.render()).catch(() => {});
      this.render();
    }
  }

  shutdown(): void {
    this.isRunning = false;
    this.tunnelMgr.stopAll();
    process.stdout.write(Screen.exitAltBuffer + Screen.showCursor);
    process.exit(0);
  }
}
