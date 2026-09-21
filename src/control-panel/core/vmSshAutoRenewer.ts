import { ControlPanelConfig } from './types.js';
import { ConfigManager } from './configManager.js';
import { FreestyleApi } from './freestyleApi.js';
import { DaytonaApi } from './daytonaApi.js';
import { VpsProbe } from './vpsProbe.js';

export interface VmRefreshResult {
  renewed: boolean;
  found: boolean;
  newSshTarget?: string;
  vmId?: string;
  error?: string;
}

export class VmSshAutoRenewer {
  static async refreshPrimaryVmSsh(config: ControlPanelConfig): Promise<VmRefreshResult> {
    const provider = config.provider;

    if (provider === 'freestyle') {
      const apiKey = config.freestyleApiKey;
      if (!apiKey) {
        return { renewed: false, found: false, error: 'No Freestyle API key configured' };
      }
      try {
        const val = await FreestyleApi.validateApiKey(apiKey);
        if (!val.valid) {
          return { renewed: false, found: false, error: 'API key invalid or expired' };
        }
        const vms = val.vms || [];
        if (!vms || vms.length === 0) {
          return { renewed: false, found: false, error: 'No active VMs found on Freestyle account' };
        }

        const extractedSlug = config.primarySshTarget
          ? config.primarySshTarget.split(':')[0].replace(/^ssh\s+/i, '').trim()
          : undefined;

        const match =
          (config.freestylePrimaryVmId && vms.find((v) => v.id === config.freestylePrimaryVmId)) ||
          (config.freestylePrimarySlug && vms.find((v) => v.slug === config.freestylePrimarySlug)) ||
          (extractedSlug && vms.find((v) => v.slug === extractedSlug || v.id === extractedSlug)) ||
          vms.find((v) => /primary|openclaw/i.test(v.slug || v.displayName || '')) ||
          (vms.length === 1 ? vms[0] : undefined);

        if (!match) {
          const candidates = vms.map((v) => v.slug || v.id || '').filter(Boolean).join(', ');
          return { renewed: false, found: false, error: `Primary VM not found on Freestyle account. Available: ${candidates}` };
        }

        const tokenRes = await FreestyleApi.createIdentityToken(apiKey, match.id || match.slug);
        if (!tokenRes.token) {
          return { renewed: false, found: true, error: tokenRes.error || 'Failed to mint Freestyle identity token' };
        }

        const newTarget = FreestyleApi.formatSshTarget(match.slug, tokenRes.token);
        config.primarySshTarget = newTarget;
        config.freestylePrimarySlug = match.slug;
        config.freestylePrimaryVmId = match.id;
        ConfigManager.save(config);

        return { renewed: true, found: true, newSshTarget: newTarget, vmId: match.id };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { renewed: false, found: false, error: msg };
      }
    }

    if (provider === 'daytona') {
      const apiKey = config.daytonaApiKey;
      if (!apiKey) {
        return { renewed: false, found: false, error: 'No Daytona API key configured' };
      }
      try {
        const val = await DaytonaApi.validateApiKey(apiKey);
        if (!val.valid) {
          return { renewed: false, found: false, error: 'API key invalid or expired' };
        }
        const listRes = await DaytonaApi.listWorkspacesDetailed(apiKey);
        if (!listRes.ok) {
          if (listRes.authError) {
            return { renewed: false, found: false, error: 'API key invalid or expired' };
          }
          return { renewed: false, found: false, error: 'Failed to list workspaces on Daytona account' };
        }
        const workspaces = listRes.workspaces || [];
        if (!workspaces || workspaces.length === 0) {
          return { renewed: false, found: false, error: 'No active workspaces found on Daytona account' };
        }

        const cleanTargetId = config.primarySshTarget
          ? config.primarySshTarget.replace(/^ssh\s+/i, '').replace(/@.*$/, '').trim()
          : undefined;

        const match =
          (config.daytonaPrimaryWorkspaceId && workspaces.find((w) => w.id === config.daytonaPrimaryWorkspaceId)) ||
          (cleanTargetId && workspaces.find((w) => w.id === cleanTargetId || w.name === cleanTargetId)) ||
          workspaces.find((w) => /primary|openclaw|mr\.?v/i.test(w.name)) ||
          (workspaces.length === 1 ? workspaces[0] : undefined);

        if (!match) {
          const candidates = workspaces.map((w) => w.id).join(', ');
          return { renewed: false, found: false, error: `Primary workspace not found on Daytona account. Available: ${candidates}` };
        }

        const sshRes = await DaytonaApi.createSshAccess(apiKey, match.id, 43200);
        if (!sshRes.success || !sshRes.sshTarget) {
          return { renewed: false, found: true, error: sshRes.error || 'Failed to create Daytona SSH access' };
        }

        config.primarySshTarget = sshRes.sshTarget;
        config.daytonaPrimaryWorkspaceId = match.id;
        ConfigManager.save(config);

        return { renewed: true, found: true, newSshTarget: sshRes.sshTarget, vmId: match.id };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { renewed: false, found: false, error: msg };
      }
    }

    return { renewed: false, found: false, error: `Unsupported provider: ${provider}` };
  }

  static async refreshSecondaryVmSsh(config: ControlPanelConfig): Promise<VmRefreshResult> {
    const secProvider = config.secondaryProvider || config.provider;

    if (secProvider === 'freestyle') {
      const apiKey = config.secondaryFreestyleApiKey || config.freestyleApiKey;
      if (!apiKey) {
        return { renewed: false, found: false, error: 'No Freestyle API key configured for secondary VM' };
      }
      try {
        const val = await FreestyleApi.validateApiKey(apiKey);
        if (!val.valid) {
          return { renewed: false, found: false, error: 'API key invalid or expired' };
        }
        const vms = val.vms || [];
        if (!vms || vms.length === 0) {
          return { renewed: false, found: false, error: 'No active VMs found on Freestyle account' };
        }

        const currentSec = config.llama.sshTarget || config.secondarySshTarget || '';
        const extractedSlug = currentSec ? currentSec.split(':')[0].replace(/^ssh\s+/i, '').trim() : undefined;

        const match =
          (config.freestyleSecondaryVmId && vms.find((v) => v.id === config.freestyleSecondaryVmId)) ||
          (config.freestyleLlamaSlug && vms.find((v) => v.slug === config.freestyleLlamaSlug)) ||
          (extractedSlug && vms.find((v) => v.slug === extractedSlug || v.id === extractedSlug)) ||
          vms.find((v) => /llama|secondary|llm/i.test(v.slug || v.displayName || ''));

        if (!match) {
          const candidates = vms.map((v) => v.slug || v.id || '').filter(Boolean).join(', ');
          return { renewed: false, found: false, error: `Secondary VM not found on Freestyle account. Available: ${candidates}` };
        }

        const tokenRes = await FreestyleApi.createIdentityToken(apiKey, match.id || match.slug);
        if (!tokenRes.token) {
          return { renewed: false, found: true, error: tokenRes.error || 'Failed to mint Freestyle identity token' };
        }

        const newTarget = FreestyleApi.formatSshTarget(match.slug, tokenRes.token);
        config.secondarySshTarget = newTarget;
        config.llama.sshTarget = newTarget;
        config.freestyleLlamaSlug = match.slug;
        config.freestyleSecondaryVmId = match.id;
        ConfigManager.save(config);

        return { renewed: true, found: true, newSshTarget: newTarget, vmId: match.id };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { renewed: false, found: false, error: msg };
      }
    }

    if (secProvider === 'daytona') {
      const apiKey = config.secondaryDaytonaApiKey || config.daytonaApiKey;
      if (!apiKey) {
        return { renewed: false, found: false, error: 'No Daytona API key configured for secondary VM' };
      }
      try {
        const val = await DaytonaApi.validateApiKey(apiKey);
        if (!val.valid) {
          return { renewed: false, found: false, error: 'API key invalid or expired' };
        }
        const listRes = await DaytonaApi.listWorkspacesDetailed(apiKey);
        if (!listRes.ok) {
          if (listRes.authError) {
            return { renewed: false, found: false, error: 'API key invalid or expired' };
          }
          return { renewed: false, found: false, error: 'Failed to list workspaces on Daytona account' };
        }
        const workspaces = listRes.workspaces || [];
        if (!workspaces || workspaces.length === 0) {
          return { renewed: false, found: false, error: 'No active workspaces found on Daytona account' };
        }

        const currentSec = config.llama.sshTarget || config.secondarySshTarget || '';
        const cleanTargetId = currentSec.replace(/^ssh\s+/i, '').replace(/@.*$/, '').trim();

        const match =
          (config.daytonaSecondaryWorkspaceId && workspaces.find((w) => w.id === config.daytonaSecondaryWorkspaceId)) ||
          (cleanTargetId && workspaces.find((w) => w.id === cleanTargetId || w.name === cleanTargetId)) ||
          workspaces.find((w) => /llama|secondary|llm/i.test(w.name)) ||
          (workspaces.length === 1 ? workspaces[0] : undefined);

        if (!match) {
          const candidates = workspaces.map((w) => w.id).join(', ');
          return { renewed: false, found: false, error: `Secondary workspace not found on Daytona account. Available: ${candidates}` };
        }

        const sshRes = await DaytonaApi.createSshAccess(apiKey, match.id, 43200);
        if (!sshRes.success || !sshRes.sshTarget) {
          return { renewed: false, found: true, error: sshRes.error || 'Failed to create Daytona SSH access' };
        }

        config.secondarySshTarget = sshRes.sshTarget;
        config.llama.sshTarget = sshRes.sshTarget;
        config.daytonaSecondaryWorkspaceId = match.id;
        ConfigManager.save(config);

        return { renewed: true, found: true, newSshTarget: sshRes.sshTarget, vmId: match.id };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { renewed: false, found: false, error: msg };
      }
    }

    return { renewed: false, found: false, error: `Unsupported provider: ${secProvider}` };
  }
}
