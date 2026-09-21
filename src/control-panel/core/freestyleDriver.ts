import { VpsProviderDriver, ProvisionResult, VpsSpecs } from './types.js';
import { FreestyleApi, FREESTYLE_DEFAULT_SPECS } from './freestyleApi.js';
import { VpsProbe } from './vpsProbe.js';

export class FreestyleDriver implements VpsProviderDriver {
  readonly providerId = 'freestyle' as const;
  readonly displayName = 'Freestyle.sh';
  readonly defaultSpecs: VpsSpecs = { ...FREESTYLE_DEFAULT_SPECS };
  readonly hasDirectEgress = true;

  async validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    const res = await FreestyleApi.validateApiKey(apiKey);
    return { valid: res.valid, error: res.error };
  }

  async listExistingWorkspaces(apiKey: string): Promise<Array<{ id: string; name: string; specs: VpsSpecs }>> {
    const vms = await FreestyleApi.listVms(apiKey);
    const activeVms = vms.filter((vm) => {
      if (!vm) return false;
      if ((vm as any).deleted === true || (vm as any).isDeleted === true) return false;
      if ((vm as any).deletedAt || (vm as any).deleted_at) return false;
      const st = (vm.state || (vm as any).status || '').toLowerCase().trim();
      if (['deleted', 'terminated', 'terminating', 'destroying', 'failed'].includes(st)) return false;
      return true;
    });
    return activeVms.map((vm) => {
      const cpu = vm.resources?.cpu || vm.cpu || 4;
      const mem = vm.resources?.memory || vm.memory || 8192;
      const storage = vm.resources?.storage || vm.storage || 32768;
      return {
        id: vm.id,
        name: vm.slug || vm.id,
        specs: {
          cpuCores: cpu,
          ramGb: Math.round(mem / 1024),
          storageGb: Math.round(storage / 1024)
        }
      };
    });
  }

  async provisionPrimary(apiKey: string, prefix = 'openclaw'): Promise<ProvisionResult> {
    const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'openclaw';
    const primarySlug = `${cleanPrefix}-primary`;

    const vm = await FreestyleApi.createVm(apiKey, {
      slug: primarySlug,
      displayName: 'OpenClaw Primary Node',
      firewall: {
        rules: [{ action: 'allow', source: {}, destination: { public: true } }]
      },
      networks: [{ vpc: 'openclaw-mesh', ipv4: true }],
      metadata: {
        role: 'agent-gateway',
        'managed-by': 'openclaw-control-panel'
      }
    });
    if (!vm.success || !vm.id) {
      throw new Error(`Failed to provision primary VM '${primarySlug}': ${vm.error || 'unknown error'}`);
    }

    const token = await FreestyleApi.createIdentityToken(apiKey, vm.id || primarySlug);
    return {
      primarySshTarget: FreestyleApi.formatSshTarget(primarySlug, token.token),
      secondarySshTarget: '',
      specs: { ...this.defaultSpecs },
      apiKey,
      primaryWorkspaceId: vm.id,
      primarySlug
    };
  }

  async provisionSecondary(apiKey: string, prefix = 'openclaw', specs: VpsSpecs = this.defaultSpecs): Promise<ProvisionResult> {
    const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'openclaw';
    const llamaSlug = `${cleanPrefix}-llama`;

    const vm = await FreestyleApi.createVm(apiKey, {
      slug: llamaSlug,
      displayName: 'OpenClaw Llama Inference Node',
      firewall: {
        rules: [{ action: 'allow', source: {}, destination: { public: true } }]
      },
      networks: [{ vpc: 'openclaw-mesh', ipv4: true }],
      metadata: {
        role: 'llama-inference',
        'managed-by': 'openclaw-control-panel'
      }
    });
    if (!vm.success || !vm.id) {
      throw new Error(`Failed to provision secondary VM '${llamaSlug}': ${vm.error || 'unknown error'}`);
    }

    const token = await FreestyleApi.createIdentityToken(apiKey, vm.id || llamaSlug);
    return {
      primarySshTarget: '',
      secondarySshTarget: FreestyleApi.formatSshTarget(llamaSlug, token.token),
      specs: { ...this.defaultSpecs, ...specs },
      apiKey,
      secondaryWorkspaceId: vm.id,
      secondarySlug: llamaSlug
    };
  }

  async provisionDualVms(apiKey: string, prefix = 'openclaw'): Promise<ProvisionResult> {
    const primary = await this.provisionPrimary(apiKey, prefix);
    const secondary = await this.provisionSecondary(apiKey, prefix);
    return {
      primarySshTarget: primary.primarySshTarget,
      secondarySshTarget: secondary.secondarySshTarget,
      specs: { ...this.defaultSpecs },
      apiKey,
      interVmEndpoint: `${secondary.secondarySlug}.openclaw-mesh`,
      primaryWorkspaceId: primary.primaryWorkspaceId,
      secondaryWorkspaceId: secondary.secondaryWorkspaceId,
      primarySlug: primary.primarySlug,
      secondarySlug: secondary.secondarySlug
    };
  }

  async detectHardware(sshTarget: string): Promise<VpsSpecs> {
    try {
      const probe = await VpsProbe.detectVpsSpecs(sshTarget);
      if (probe.success) {
        return {
          cpuCores: probe.cpuCores || this.defaultSpecs.cpuCores,
          ramGb: probe.ramGb || this.defaultSpecs.ramGb,
          storageGb: 32 // Freestyle provisioned storage capacity
        };
      }
    } catch (_) {}

    return { ...this.defaultSpecs };
  }

  getRemoteTerminalCommand(sshTarget: string): string {
    return `ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 ${sshTarget}`;
  }
}
