import { ControlPanelConfig, InstallationState, RemoteVpsInspection, MissingVmType, VpsDetectorAction } from './types.js';
import { VpsConfigDetector } from './vpsConfigDetector.js';

import { VmSshAutoRenewer } from './vmSshAutoRenewer.js';
import { ConfigManager } from './configManager.js';

export class VpsDetector {
  static async inspectTarget(targetSsh: string): Promise<RemoteVpsInspection> {
    const insp = await VpsConfigDetector.inspect(targetSsh);
    return {
      reachable: insp.reachable,
      openclawInstalled: insp.openclawInstalled,
      openclawToken: insp.openclawToken,
      omnirouteInstalled: insp.omnirouteInstalled,
      omnirouteActive: insp.omnirouteActive,
      railwayRelayConfigured: insp.railwayRelayConfigured,
      railwayDomain: insp.railwayDomain,
      railwayUuid: insp.railwayUuid,
      llamaInstalled: insp.llamaInstalled
    };
  }

  static async detectPrimaryInstallation(targetSsh: string): Promise<{ openclaw: boolean; omniroute: boolean }> {
    const insp = await this.inspectTarget(targetSsh);
    return { openclaw: insp.openclawInstalled, omniroute: insp.omnirouteInstalled };
  }

  static async detectLlamaInstallation(targetSsh: string): Promise<boolean> {
    const insp = await VpsConfigDetector.inspect(targetSsh);
    return insp.llamaInstalled;
  }

  static async detectExistingBotTokens(targetSsh: string): Promise<{ telegramToken?: string; discordToken?: string; discordGuildId?: string }> {
    const insp = await VpsConfigDetector.inspect(targetSsh);
    return {
      telegramToken: insp.telegramBotToken,
      discordToken: insp.discordBotToken,
      discordGuildId: insp.discordGuildId
    };
  }

  static async detectExistingLlamaSetup(
    config: ControlPanelConfig,
    primaryTarget?: string
  ): Promise<{
    found: boolean;
    summary: string;
    isSeparate: boolean;
    endpoint?: string;
    modelName?: string;
    sshTarget?: string;
    running?: boolean;
  }> {
    const lines: string[] = [];
    let isSeparate = false;
    let endpoint: string | undefined = undefined;
    let modelName: string | undefined = undefined;
    let sshTarget: string | undefined = undefined;
    let running: boolean | undefined = undefined;

    if (config.llama?.enabled || config.llama?.activeEndpointUrl || config.llama?.sshTarget || config.secondarySshTarget) {
      const cfgEndpoint = config.llama?.activeEndpointUrl || config.llama?.railwayEndpointUrl || config.llama?.freestyleDomainUrl;
      const ssh = config.llama?.sshTarget || config.secondarySshTarget;
      if (cfgEndpoint) endpoint = cfgEndpoint;
      if (ssh) sshTarget = ssh;
      if (config.llama?.modelName) modelName = config.llama.modelName;
      if (config.llama?.isSeparateVps || ssh) isSeparate = true;
      if (config.llama?.enabled) {
        lines.push(`• Status: Enabled (${isSeparate ? 'Dedicated Second VM' : 'Same VM'})`);
        if (ssh) lines.push(`• SSH Target: ${ssh}`);
        if (cfgEndpoint) lines.push(`• Endpoint: ${cfgEndpoint}`);
        if (config.llama?.modelName) lines.push(`• Model: ${config.llama.modelName}`);
      }
    }

    const primary = primaryTarget || config.primarySshTarget;
    if (primary) {
      try {
        const insp = await VpsConfigDetector.inspect(primary);
        if (insp.llamaInstalled || insp.llamaRunning || insp.llamaEndpoint || insp.llamaTopology) {
          if (insp.llamaTopology === 'second_vm' || (!insp.llamaRunning && insp.llamaEndpoint)) {
            isSeparate = true;
            lines.push(`• Primary VM: Connected to Remote LLM`);
          } else {
            const state = insp.llamaRunning ? '[RUNNING]' : insp.llamaInstalled ? '[INSTALLED]' : '[EXTERNAL CONNECTION]';
            lines.push(`• Primary VM: llama-server ${state}`);
            if (insp.llamaRunning) running = true;
          }
          if (insp.llamaModel && !modelName) modelName = insp.llamaModel;
          if (insp.llamaEndpoint && !endpoint) endpoint = insp.llamaEndpoint;
          if (insp.llamaModel && !lines.some(l => l.includes(insp.llamaModel!))) lines.push(`• Model: ${insp.llamaModel}`);
          if (insp.llamaEndpoint && !lines.some(l => l.includes(insp.llamaEndpoint!))) lines.push(`• Endpoint: ${insp.llamaEndpoint}`);
          if (insp.llamaTopology === 'second_vm') isSeparate = true;
        }
      } catch (_) {}
    }

    const secondary = sshTarget || config.llama?.sshTarget || config.secondarySshTarget;
    if (secondary && secondary !== primary) {
      try {
        const sec = await VpsConfigDetector.detectSecondaryLlama(secondary);
        if (sec.llamaInstalled || sec.llamaRunning || sec.llamaEndpoint || sec.llamaTopology) {
          isSeparate = true;
          if (sec.llamaRunning) running = true;
          if (sec.llamaModel && !modelName) modelName = sec.llamaModel;
          if (sec.llamaEndpoint && !endpoint) endpoint = sec.llamaEndpoint;
          lines.push(`• Secondary VM: llama-server ${sec.llamaRunning ? '[RUNNING]' : '[INSTALLED]'}`);
          if (sec.llamaModel && !lines.some(l => l.includes(sec.llamaModel!))) lines.push(`• Model: ${sec.llamaModel}`);
          if (sec.llamaEndpoint && !lines.some(l => l.includes(sec.llamaEndpoint!))) lines.push(`• Endpoint: ${sec.llamaEndpoint}`);
        }
      } catch (_) {}
    }

    return {
      found: lines.length > 0 || !!endpoint || !!sshTarget,
      summary: lines.join('\n'),
      isSeparate,
      endpoint,
      modelName,
      sshTarget,
      running
    };
  }

  static async inspectAll(config: ControlPanelConfig): Promise<InstallationState> {
    let primary = await this.inspectTarget(config.primarySshTarget);

    let primaryRenewed = false;
    let primaryRenewError: string | undefined;

    // Auto-renew expired SSH token for Primary VM (Daytona or Freestyle) if API key is configured
    if (!primary.reachable) {
      try {
        const renewRes = await VmSshAutoRenewer.refreshPrimaryVmSsh(config);
        if (renewRes.renewed && config.primarySshTarget) {
          primaryRenewed = true;
          primary = await this.inspectTarget(config.primarySshTarget);
        } else {
          primaryRenewError = renewRes.error || 'SSH token renewal failed';
        }
      } catch (err: unknown) {
        primaryRenewError = err instanceof Error ? err.message : String(err);
      }
    }

    let secondaryReachable: boolean | undefined = undefined;
    let secondaryLlama = false;
    let secondaryRenewed = false;
    let secondaryRenewError: string | undefined;

    if (config.llama.enabled && config.llama.isSeparateVps) {
      const llamaTarget = config.llama.sshTarget || config.secondarySshTarget;
      if (llamaTarget) {
        let llamaInsp = await this.inspectTarget(llamaTarget);
        secondaryReachable = llamaInsp.reachable;
        secondaryLlama = llamaInsp.llamaInstalled;

        // Auto-renew expired SSH token for Secondary VM (Daytona or Freestyle) if API key is configured
        if (secondaryReachable === false) {
          try {
            const secRenew = await VmSshAutoRenewer.refreshSecondaryVmSsh(config);
            if (secRenew.renewed && (config.llama.sshTarget || config.secondarySshTarget)) {
              secondaryRenewed = true;
              const newSecTarget = config.llama.sshTarget || config.secondarySshTarget!;
              llamaInsp = await this.inspectTarget(newSecTarget);
              secondaryReachable = llamaInsp.reachable;
              secondaryLlama = llamaInsp.llamaInstalled;
            } else {
              secondaryRenewError = secRenew.error || 'SSH token renewal failed for secondary VM';
            }
          } catch (err: unknown) {
            secondaryRenewError = err instanceof Error ? err.message : String(err);
          }
        }
      }
    } else if (config.llama.enabled) {
      secondaryLlama = primary.llamaInstalled;
    }

    const primaryReachable = primary.reachable;
    const isSecondaryDead = (config.llama.enabled && config.llama.isSeparateVps && secondaryReachable === false);

    let recoveryNeeded = false;
    let missingVmType: MissingVmType = 'none';

    if (!primaryReachable && isSecondaryDead) {
      recoveryNeeded = true;
      missingVmType = 'both';
    } else if (!primaryReachable) {
      recoveryNeeded = true;
      missingVmType = 'primary';
    } else if (isSecondaryDead) {
      recoveryNeeded = true;
      missingVmType = 'secondary';
    }

    if (primary.openclawToken && primary.openclawToken.length > 10) {
      config.openclawToken = primary.openclawToken;
    }
    if (primary.railwayDomain) {
      config.railwayDomain = primary.railwayDomain;
    }
    if (primary.railwayUuid) {
      config.railwayUuid = primary.railwayUuid;
    }

    const missingServices: string[] = [];
    if (!primaryReachable) missingServices.push('Primary VPS unreachable / deleted');
    if (isSecondaryDead) missingServices.push('Secondary Llama VPS unreachable / deleted');
    if (primaryReachable && !primary.openclawInstalled) missingServices.push('OpenClaw CLI & Runtime');
    if (primaryReachable && !primary.omnirouteInstalled) missingServices.push('OmniRoute Gateway');

    const isFullyConfigured = primaryReachable && primary.openclawInstalled && primary.omnirouteInstalled && !isSecondaryDead;
    const isPartiallyConfigured = primaryReachable && (primary.openclawInstalled || primary.omnirouteInstalled) && !isFullyConfigured;

    return {
      primaryReachable,
      secondaryReachable,
      primaryOpenclaw: primary.openclawInstalled,
      primaryOmniroute: primary.omnirouteInstalled,
      primaryRailwayRelay: primary.railwayRelayConfigured,
      secondaryLlama,
      isFullyConfigured,
      isPartiallyConfigured,
      recoveryNeeded,
      missingVmType,
      missingServices,
      primaryRenewed,
      primaryRenewError,
      secondaryRenewed,
      secondaryRenewError
    };
  }

  static async autoReconnect(config: ControlPanelConfig, retries = 2): Promise<InstallationState> {
    let attempt = 0;
    let state = await this.inspectAll(config);
    while (state.recoveryNeeded && attempt < retries) {
      attempt++;
      state = await this.inspectAll(config);
    }
    if (state.primaryReachable && state.primaryRenewed) {
      console.log(`[OK] Reconnected via API Key (token minted)`);
    }
    return state;
  }

  static determineAction(state: InstallationState): VpsDetectorAction {
    if (state.recoveryNeeded) {
      return 'vm_recovery';
    }
    if (state.isFullyConfigured) {
      return 'skip_to_tui';
    }
    if (state.isPartiallyConfigured) {
      return 'guided_repair';
    }
    return 'full_onboarding';
  }
}
