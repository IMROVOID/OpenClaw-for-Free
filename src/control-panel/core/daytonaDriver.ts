import { VpsProviderDriver, ProvisionResult, VpsSpecs } from './types.js';
import { DaytonaApi, HARD_LIMIT_SPECS } from './daytonaApi.js';
import { VpsProbe } from './vpsProbe.js';

export class DaytonaDriver implements VpsProviderDriver {
  readonly providerId = 'daytona' as const;
  readonly displayName = 'Daytona Cloud';
  readonly defaultSpecs: VpsSpecs = { ...HARD_LIMIT_SPECS };
  readonly hasDirectEgress = false;

  async validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    const quota = await DaytonaApi.validateApiKey(apiKey);
    return { valid: quota.valid, error: quota.error };
  }

  async listExistingWorkspaces(apiKey: string): Promise<Array<{ id: string; name: string; specs: VpsSpecs }>> {
    return DaytonaApi.listWorkspaces(apiKey);
  }

  async provisionPrimary(apiKey: string, prefix = 'openclaw'): Promise<ProvisionResult> {
    const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'openclaw';
    const name = `${cleanPrefix}-primary`;
    const res = await DaytonaApi.provisionWorkspace(apiKey, name, this.defaultSpecs);
    if (!res.success || !res.workspaceId) {
      throw new Error(`Failed to provision primary workspace '${name}': ${res.error || 'unknown error'}`);
    }
    return {
      primarySshTarget: res.sshTarget,
      secondarySshTarget: '',
      specs: { ...this.defaultSpecs },
      apiKey,
      primaryWorkspaceId: res.workspaceId,
      primarySlug: name
    };
  }

  async provisionSecondary(apiKey: string, prefix = 'openclaw', specs: VpsSpecs = this.defaultSpecs): Promise<ProvisionResult> {
    const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'openclaw';
    const name = `${cleanPrefix}-llama`;
    const res = await DaytonaApi.provisionWorkspace(apiKey, name, { ...this.defaultSpecs, ...specs });
    if (!res.success || !res.workspaceId) {
      throw new Error(`Failed to provision secondary workspace '${name}': ${res.error || 'unknown error'}`);
    }
    return {
      primarySshTarget: '',
      secondarySshTarget: res.sshTarget,
      specs: { ...this.defaultSpecs },
      apiKey,
      secondaryWorkspaceId: res.workspaceId,
      secondarySlug: name
    };
  }

  async provisionDualVms(apiKey: string, prefix = 'openclaw'): Promise<ProvisionResult> {
    const primary = await this.provisionPrimary(apiKey, prefix);
    const secondary = await this.provisionSecondary(apiKey, prefix);
    return {
      primarySshTarget: primary.primarySshTarget,
      secondarySshTarget: secondary.secondarySshTarget,
      specs: primary.specs,
      apiKey,
      primaryWorkspaceId: primary.primaryWorkspaceId,
      secondaryWorkspaceId: secondary.secondaryWorkspaceId,
      primarySlug: primary.primarySlug,
      secondarySlug: secondary.secondarySlug
    };
  }

  async detectHardware(sshTarget: string): Promise<VpsSpecs> {
    try {
      const detected = await VpsProbe.detectVpsSpecs(sshTarget);
      return DaytonaApi.enforceHardwareBounds({
        cpuCores: detected.cpuCores,
        ramGb: detected.ramGb,
        storageGb: detected.storageGb
      });
    } catch (_) {
      return { ...this.defaultSpecs };
    }
  }

  getRemoteTerminalCommand(sshTarget: string): string {
    return `ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 ${sshTarget}`;
  }
}
