import { ControlPanelConfig } from './types.js';
import { VpsConfigDetector } from './vpsConfigDetector.js';
import { OnboardingSteps } from './onboardingSteps.js';
import { RelayDeployer } from './relayDeployer.js';
import { VpsProbe } from './vpsProbe.js';
import { EndpointResolver } from './endpointResolver.js';
import { OmnirouteSync } from './omnirouteSync.js';
import { WebIngressDeployer } from './webIngressDeployer.js';
import { PrimaryVault } from './primaryVault.js';

export type ProvisioningProgressCallback = (stage: string, detail?: string) => void | Promise<void>;

export interface ProvisionOptions {
  skipLlamaProvisioning?: boolean;
  onProgress?: ProvisioningProgressCallback;
}

export interface ProvisionResult {
  success: boolean;
  warnings: string[];
}

function sanitizeError(msg: string): string {
  return msg.replace(/(?:Bearer\s+|token[=:]\s*|key[=:]\s*|password[=:]\s*)[a-zA-Z0-9_.-]+/gi, '[REDACTED]');
}

export class RemoteProvisioner {
  /**
   * Unified idempotent provisioning pipeline used by both Control Panel TUI and Telegram Bot.
   */
  static async execute(config: ControlPanelConfig, options?: ProvisionOptions): Promise<ProvisionResult> {
    const warnings: string[] = [];
    const progress = options?.onProgress || (() => {});

    const cleanTarget = config.primarySshTarget ? config.primarySshTarget.trim() : '';
    if (!cleanTarget || (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+(:[0-9]+)?$/.test(cleanTarget) && !/^[a-zA-Z0-9_.-]+$/.test(cleanTarget))) {
      return { success: false, warnings: ['Invalid or missing primary SSH target format.'] };
    }

    try {
      // 1. Inspect Primary VM; bootstrap if fresh
      await progress('inspect_primary', 'Inspecting Primary VM services...');
      const isPrimaryExisting = await VpsConfigDetector.inspect(config.primarySshTarget);

      if (!isPrimaryExisting.openclawInstalled) {
        await progress('bootstrap_primary', 'Bootstrapping OpenClaw runtime and dependencies on Primary VM...');
        const ingressDomain = config.ingressProvider === 'freestyle' && config.publicBaseDomain
          ? config.publicBaseDomain.replace(/^https?:\/\//, '')
          : undefined;
        await OnboardingSteps.runRemoteProvisioning(
          config.primarySshTarget,
          undefined,
          config.provider,
          false,
          undefined,
          ingressDomain
        );
      } else {
        await progress('preserve_primary', 'Existing OpenClaw installation detected on Primary VM.');
      }

      // 2. Daytona Egress Relay Deployment
      if (config.provider === 'daytona' && config.railwayDomain && config.railwayUuid) {
        await progress('deploy_relay', 'Deploying Daytona Egress Relay via Railway...');
        PrimaryVault.capture('relay', `deploying egress relay via railway domain=${config.railwayDomain}`);
        const relayOk = await RelayDeployer.deployEgressRelay(config.primarySshTarget, config.railwayDomain, config.railwayUuid);
        if (!relayOk) {
          PrimaryVault.capture('relay', 'egress relay deployment reported non-zero status or warning');
          warnings.push('Egress Relay deployment reported non-zero status or warning.');
        }
      }

      // 3. Secondary LLaMA VM Provisioning
      if (!options?.skipLlamaProvisioning && config.llama.enabled && config.llama.isSeparateVps && config.secondarySshTarget) {
        await progress('inspect_secondary', 'Inspecting Secondary VM for LLaMA service...');
        PrimaryVault.capture('secondary', `inspecting secondary VM ${config.secondarySshTarget} for llama service`);
        const secLlama = await VpsConfigDetector.detectSecondaryLlama(config.secondarySshTarget);

        if (secLlama.llamaInstalled) {
          await progress('restart_secondary_llama', 'Ensuring llama-server is active on Secondary VM...');
          PrimaryVault.capture('secondary', 'llama-server already installed; ensuring it is active');
          await VpsProbe.execRemote(
            config.secondarySshTarget,
            'sudo supervisorctl restart llama 2>/dev/null || tmux new-session -d -s llama "bash ~/start-server.sh" 2>/dev/null || (nohup bash ~/start-server.sh >/dev/null 2>&1 &) || true',
            10
          );
        } else {
          await progress('bootstrap_secondary_llama', 'Bootstrapping dedicated LLaMA AVX-512 engine on Secondary VM...');
          PrimaryVault.capture('secondary', `bootstrapping dedicated llama engine on secondary VM ${config.secondarySshTarget}`);
          await OnboardingSteps.runRemoteProvisioning(
            '',
            config.secondarySshTarget,
            config.secondaryProvider || config.provider,
            true,
            config.llama
          );
        }
      }

      // 4. Non-destructively Sync OpenClaw Config & Channels
      await progress('sync_openclaw', 'Syncing OpenClaw configuration and messaging channels...');
      await OnboardingSteps.syncOpenClawConfig(
        config.primarySshTarget,
        config.openclawToken,
        config.telegramBotToken,
        config.discordBotToken,
        config.discordGuildId
      );

      // 5. Register LLaMA Model in OpenClaw (if enabled)
      if (config.llama.enabled && config.primarySshTarget) {
        await progress('register_llama', 'Registering Local LLaMA endpoint in OpenClaw...');
        const endpoint = EndpointResolver.resolveBaseUrl(config);
        config.llama.activeEndpointUrl = endpoint;
        if (endpoint) {
          const regOk = await OmnirouteSync.registerLlamaInOpenClaw(
            config.primarySshTarget,
            endpoint,
            config.llama.modelName || 'qwen2.5-7b-mtp'
          );
          if (!regOk) {
            warnings.push('Failed to register LLaMA endpoint in OpenClaw catalog.');
          }
        }
      }

      // 6. Sync OmniRoute Providers
      if (config.providers && Object.keys(config.providers).length > 0) {
        await progress('sync_omniroute', 'Syncing OmniRoute provider catalogs...');
        await OmnirouteSync.syncProvidersToRemoteVps(config.primarySshTarget, config.providers);
      }

      // 7. Deploy Web Ingress (if enabled)
      if (config.domainedUrlsEnabled && config.publicBaseDomain) {
        if (config.ingressProvider === 'freestyle') {
          await progress('deploy_ingress', 'Deploying FreeStyle Native Ingress...');
          const deployRes = await WebIngressDeployer.deploy(config.primarySshTarget, config.publicBaseDomain);
          if (!deployRes.success) {
            warnings.push(`FreeStyle Ingress: ${deployRes.message}`);
          }
        } else if (config.ingressProvider === 'railway' && (config.railwayApiKey || '').trim()) {
          await progress('deploy_ingress', 'Deploying Railway Web Relay Ingress...');
          const deployRes = await WebIngressDeployer.deployRailwayWebRelay({
            apiKey: config.railwayApiKey!.trim(),
            domain: config.publicBaseDomain,
            primaryWorkspaceId: config.daytonaPrimaryWorkspaceId,
            secondaryWorkspaceId: config.daytonaSecondaryWorkspaceId,
            forceRedeploy: true
          });
          if (!deployRes.success) {
            warnings.push(`Railway Ingress: ${deployRes.message}`);
          }
        }
      }

      // 8. Sync Primary-VM Vault (secondary secrets, connections, categorized logs).
      // The vault is the single source of truth on the primary; local config
      // keeps only the primary connectivity tuple afterwards.
      if (config.primarySshTarget) {
        await progress('vault_sync', 'Syncing Primary VM credential vault...');
        const vaultSnapshot = PrimaryVault.buildSnapshot(
          config,
          config._userId ?? config.telegramOwnerId ?? 'local',
          PrimaryVault.loadPendingLogs()
        );
        const vaultRes = await PrimaryVault.pushSnapshot(config.primarySshTarget, vaultSnapshot);
        if (!vaultRes.success) {
          warnings.push(`Vault sync: ${vaultRes.error || 'unknown failure'}`);
        } else {
          PrimaryVault.clearPendingLogs();
        }
      }

      await progress('complete', 'Provisioning workflow completed successfully.');
      return { success: true, warnings };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Provisioning error: ${sanitizeError(msg)}`);
      return { success: false, warnings };
    }
  }
}
