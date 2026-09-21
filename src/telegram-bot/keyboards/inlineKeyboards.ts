import { InlineKeyboard } from 'grammy';
import { ControlPanelConfig, ServiceStatus, VpsSpecs } from '../../control-panel/core/types.js';

export class InlineKeyboards {
  static buildMainMenu(config: ControlPanelConfig, _status?: ServiceStatus): InlineKeyboard {
    const kb = new InlineKeyboard();

    // Row 1: WebUI options
    kb.text('OpenClaw WebUI', 'menu:openclaw')
      .text('OmniRoute WebUI', 'menu:omniroute')
      .row();

    // Row 2: Llama & Service Manager
    if (config.llama.enabled) {
      kb.text('Llama AI WebUI', 'menu:llama');
    }
    kb.text('Service Manager', 'menu:services').row();
    kb.text('Relays & Domain Settings', 'menu:webui-settings').row();

    // Row 3: Diagnostics & Logs
    kb.text('Diagnostics & Telemetry', 'menu:diagnostics')
      .text('Service Logs', 'menu:logs')
      .row();

    // Row 4: Terminal & Quick Ping
    kb.text('SSH Terminal Info', 'menu:terminal')
      .text('API / Model Ping', 'menu:ping')
      .row();

    // Row 5: Setup & Recovery
    kb.text('Setup Assistant', 'menu:onboard')
      .text('VM Recovery', 'menu:recovery')
      .row();

    // Row 6: Refresh & Logout
    kb.text('Refresh Status', 'menu:refresh')
      .text('Reset / Logout', 'menu:logout');

    return kb;
  }

  static buildServiceManager(): InlineKeyboard {
    return new InlineKeyboard()
      .text('Start OpenClaw', 'svc:start:openclaw')
      .text('Stop', 'svc:stop:openclaw')
      .text('Restart', 'svc:restart:openclaw')
      .row()
      .text('Start OmniRoute', 'svc:start:omniroute')
      .text('Stop', 'svc:stop:omniroute')
      .text('Restart', 'svc:restart:omniroute')
      .row()
      .text('Start Llama', 'svc:start:llama')
      .text('Stop', 'svc:stop:llama')
      .text('Restart', 'svc:restart:llama')
      .row()
      .text('Restart All Services', 'svc:restart:all')
      .text('Update Services', 'svc:update:all')
      .row()
      .text('Sync Models (OmniRoute -> OpenClaw)', 'svc:sync_models')
      .row()
      .text('< Back to Main Menu', 'menu:back');
  }

  static buildDiagnostics(): InlineKeyboard {
    return new InlineKeyboard()
      .text('Refresh Telemetry', 'menu:diagnostics')
      .text('Quick API Ping', 'menu:ping')
      .row()
      .text('Run Full Verification (verify_setup.sh)', 'diag:verify')
      .row()
      .text('Sync Models with OmniRoute', 'diag:sync_models')
      .row()
      .text('< Back to Main Menu', 'menu:back');
  }

  static buildLogs(active = 'openclaw'): InlineKeyboard {
    const kb = new InlineKeyboard();
    const services = [
      { id: 'openclaw', label: 'OpenClaw' },
      { id: 'omniroute', label: 'OmniRoute' },
      { id: 'llama', label: 'Llama' },
      { id: 'xray', label: 'Xray Relay' },
      { id: 'bot', label: 'Bot' }
    ];

    for (const s of services) {
      const prefix = s.id === active ? '[*] ' : '';
      kb.text(`${prefix}${s.label}`, `logs:view:${s.id}`);
    }
    kb.row();
    kb.text('Refresh Log', `logs:view:${active}`)
      .text('< Back to Main Menu', 'menu:back');
    return kb;
  }

  static buildOnboardingProvider(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Freestyle.sh (32GB, Direct Egress) [Recommended]', 'onboard:provider:freestyle')
      .row()
      .text('2. Daytona Cloud (10GB, Relay)', 'onboard:provider:daytona')
      .row()
      .text('Cancel Setup', 'onboard:cancel');
  }

  static buildOnboardingProvisionMethod(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. API Key (Auto Provision / Select Workspace)', 'onboard:method:api')
      .row()
      .text('2. Direct SSH Target (user@host)', 'onboard:method:ssh')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingExistingBotChannels(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Keep Existing Channels (Skip) [Default]', 'onboard:keep:channels')
      .row()
      .text('2. Configure New Bot Token', 'onboard:enter:channels')
      .row()
      .text('3. Skip Bot Setup', 'onboard:skip:channels')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingSecondaryConnection(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Connect via Cloud API Key [Default]', 'onboard:sec:conn:api')
      .row()
      .text('2. Enter Direct SSH Target', 'onboard:sec:conn:ssh')
      .row()
      .text('3. Skip SSH (Endpoint-Only Remote Relay)', 'onboard:sec:conn:skip')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingSecondaryApiKeyChoice(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Use Existing API Key (Default)', 'onboard:sec:key:existing')
      .row()
      .text('2. Enter Different API Key', 'onboard:sec:key:new')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingExistingLlama(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Keep Existing Setup (Skip) [Default]', 'onboard:llama:keep')
      .row()
      .text('2. Reconfigure / Set Up New LLM', 'onboard:llama:new')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingTopology(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Dedicated 2nd VM [Recommended]', 'onboard:topo:dedicated')
      .row()
      .text('2. Same VM (Co-locate on Primary)', 'onboard:topo:same_vm')
      .row()
      .text('3. Cloud APIs Only (Disable Llama)', 'onboard:topo:cloud_only')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingModel(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Qwen 2.5 7B MTP [Recommended — Fast]', 'onboard:model:qwen7b')
      .row()
      .text('2. Qwen 2.5 14B Q4_0 (Freestyle 32GB)', 'onboard:model:qwen14b')
      .row()
      .text('3. Custom Model (Hugging Face / GGUF)', 'onboard:model:custom')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingSecondaryLlamaKeep(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Keep Existing Setup (Skip) [Default]', 'onboard:llama:keep-sec')
      .row()
      .text('2. Reconfigure / Set Up New LLM', 'onboard:llama:reconf-sec')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingVmChoice(role: 'primary' | 'secondary'): InlineKeyboard {
    const p = role === 'primary' ? 'p' : 's';
    return new InlineKeyboard()
      .text('Create a New VM', `onboard:vm:new:${p}`)
      .row()
      .text('Select Existing VM', `onboard:vm:existing:${p}`)
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildWorkspacePicker(
    workspaces: Array<{ id: string; name: string; specs: VpsSpecs }>,
    role: 'primary' | 'secondary'
  ): InlineKeyboard {
    const p = role === 'primary' ? 'p' : 's';
    const kb = new InlineKeyboard();
    for (let i = 0; i < Math.min(workspaces.length, 10); i++) {
      const ws = workspaces[i];
      kb.text(`${ws.name} (${ws.specs.cpuCores} vCPU / ${ws.specs.ramGb} GB)`, `onboard:ws:${p}:${i}`).row();
    }
    kb.text('< Back', 'onboard:back').text('Cancel', 'onboard:cancel');
    return kb;
  }

  static buildSecondaryMethod(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. API Key (Create New or Select Existing)', 'onboard:sec:method:api')
      .row()
      .text('2. Direct SSH Target', 'onboard:sec:method:ssh')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildRecoveryMenu(missing: 'primary' | 'secondary' | 'both'): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (missing === 'both') {
      kb.text('1. Setup Both New Primary & Secondary VMs', 'rec:both')
        .row()
        .text('2. Setup Primary VM Only', 'rec:primary')
        .row()
        .text('3. Setup Secondary VM Only', 'rec:secondary');
    } else if (missing === 'secondary') {
      kb.text('1. Setup New Secondary VM (Dedicated Llama)', 'rec:secondary')
        .row()
        .text('2. Disable Secondary VM (Use Primary/Cloud)', 'rec:disable_secondary')
        .row()
        .text('3. Setup Both VMs', 'rec:both');
    } else {
      kb.text('1. Setup New Primary VM (OpenClaw & OmniRoute)', 'rec:primary')
        .row()
        .text('2. Setup Both VMs', 'rec:both');
    }
    kb.row()
      .text('Retry Connection', 'rec:retry')
      .row()
      .text('Restore Config from Vault', 'rec:restore')
      .row()
      .text('< Back to Main Menu', 'menu:back');
    return kb;
  }

  static buildOnboardingIngressChoice(): InlineKeyboard {
    return new InlineKeyboard()
      .text('1. Permanent Domained URL (Default)', 'onboard:ingress:domained')
      .row()
      .text('2. Port Forwarding Only', 'onboard:ingress:port_forward')
      .row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
  }

  static buildOnboardingDomainProvider(provider: 'freestyle' | 'daytona'): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (provider === 'freestyle') {
      kb.text('1. Freestyle Native Domain (<slug>.style.dev) [Default]', 'onboard:dom:freestyle')
        .row()
        .text('2. Railway Edge Relay Domain', 'onboard:dom:railway');
    } else {
      kb.text('1. Railway Edge Relay Domain [Required for Daytona]', 'onboard:dom:railway');
    }
    kb.row()
      .text('< Back', 'onboard:back')
      .text('Cancel', 'onboard:cancel');
    return kb;
  }
}
