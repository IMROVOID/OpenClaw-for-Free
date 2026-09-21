import { DaytonaAccountQuota, VpsSpecs } from './types.js';
import { daytonaHttpRequest } from './daytonaHttp.js';

export const HARD_LIMIT_SPECS: VpsSpecs = {
  cpuCores: 4,
  ramGb: 8,
  storageGb: 10
};

export interface ProvisionWorkspaceResult {
  success: boolean;
  workspaceId: string;
  sshTarget: string;
  error?: string;
}

export interface DetailedWorkspace {
  id: string;
  name: string;
  specs: VpsSpecs;
}

export interface WorkspaceListResult {
  ok: boolean;
  authError: boolean;
  workspaces: DetailedWorkspace[];
}

export class DaytonaApi {
  /**
   * Testability seam: all Daytona HTTP traffic flows through this method so
   * tests can stub it without a live network connection.
   */
  static async httpRequest(
    urlStr: string,
    options: { method?: string; headers?: Record<string, any>; body?: string }
  ): Promise<{ statusCode: number; body: string }> {
    return daytonaHttpRequest(urlStr, options);
  }
  static getApiKeyGuidance(): string[] {
    return [
      '1. Open your browser and navigate to: https://app.daytona.io',
      '2. Sign in and open Settings -> API Keys (or https://app.daytona.io/settings/keys)',
      '3. Click "Create API Key", provide a name (e.g. OpenClaw-Control)',
      '4. Copy the secret API token and paste it here.'
    ];
  }

  static getExistingApiKeyGuidance(): string[] {
    return [
      '1. Navigate to: https://app.daytona.io and sign in.',
      '2. Open Settings -> API Keys (https://app.daytona.io/settings/keys).',
      '3. Copy an existing active key, or click "Create API Key" to generate a new one.',
      '4. Paste the API key into the prompt below.'
    ];
  }

  static getSandboxGuidance(): string[] {
    return [
      '1. Open your Daytona dashboard at https://app.daytona.io',
      '2. Navigate to your Sandboxes / Workspaces list.',
      '3. Select your target workspace to inspect its details.',
      '4. Copy either the Workspace Name (e.g. "openclaw-primary") or Sandbox UUID.'
    ];
  }

  static getExistingSshGuidance(): string[] {
    return [
      '1. Open Daytona dashboard at https://app.daytona.io and select Sandboxes.',
      '2. Click Sandbox options (⋮) -> "Create SSH Access".',
      '3. Copy the token or SSH command: ssh <token>@ssh.app.daytona.io',
      '   (Or paste your Sandbox UUID if your API Key is configured).'
    ];
  }

  static enforceHardwareBounds(requested: VpsSpecs, quota?: DaytonaAccountQuota): VpsSpecs {
    const maxCores = quota ? Math.min(quota.availableCores, HARD_LIMIT_SPECS.cpuCores) : HARD_LIMIT_SPECS.cpuCores;
    const maxRam = quota ? Math.min(quota.availableRamGb, HARD_LIMIT_SPECS.ramGb) : HARD_LIMIT_SPECS.ramGb;
    const maxDisk = quota ? Math.min(quota.availableStorageGb, HARD_LIMIT_SPECS.storageGb) : HARD_LIMIT_SPECS.storageGb;

    return {
      cpuCores: Math.max(1, Math.min(requested.cpuCores, maxCores)),
      ramGb: Math.max(2, Math.min(requested.ramGb, maxRam)),
      storageGb: Math.max(5, Math.min(requested.storageGb, maxDisk))
    };
  }

  static async validateApiKey(apiKey: string): Promise<DaytonaAccountQuota> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return {
        valid: false,
        availableCores: 0,
        availableRamGb: 0,
        availableStorageGb: 0,
        hardLimitCores: HARD_LIMIT_SPECS.cpuCores,
        hardLimitRamGb: HARD_LIMIT_SPECS.ramGb,
        hardLimitStorageGb: HARD_LIMIT_SPECS.storageGb,
        error: 'API key is empty'
      };
    }

    try {
      let res = await this.httpRequest('https://app.daytona.io/api/users/me', {
        headers: { 'Authorization': `Bearer ${cleanKey}` }
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res = await this.httpRequest('https://app.daytona.io/api/sandbox', {
          headers: { 'Authorization': `Bearer ${cleanKey}` }
        });
      }

      if (res.statusCode >= 200 && res.statusCode < 300) {
        return {
          valid: true,
          availableCores: 4,
          availableRamGb: 8,
          availableStorageGb: 10,
          hardLimitCores: HARD_LIMIT_SPECS.cpuCores,
          hardLimitRamGb: HARD_LIMIT_SPECS.ramGb,
          hardLimitStorageGb: HARD_LIMIT_SPECS.storageGb
        };
      }

      return {
        valid: false,
        availableCores: 0,
        availableRamGb: 0,
        availableStorageGb: 0,
        hardLimitCores: HARD_LIMIT_SPECS.cpuCores,
        hardLimitRamGb: HARD_LIMIT_SPECS.ramGb,
        hardLimitStorageGb: HARD_LIMIT_SPECS.storageGb,
        error: `HTTP ${res.statusCode}: Authentication failed`
      };
    } catch (err: any) {
      // Offline fallback: if network fails, accept key format if valid token length
      if (cleanKey.length >= 24) {
        return {
          valid: true,
          availableCores: 4,
          availableRamGb: 8,
          availableStorageGb: 10,
          hardLimitCores: HARD_LIMIT_SPECS.cpuCores,
          hardLimitRamGb: HARD_LIMIT_SPECS.ramGb,
          hardLimitStorageGb: HARD_LIMIT_SPECS.storageGb
        };
      }
      return {
        valid: false,
        availableCores: 0,
        availableRamGb: 0,
        availableStorageGb: 0,
        hardLimitCores: HARD_LIMIT_SPECS.cpuCores,
        hardLimitRamGb: HARD_LIMIT_SPECS.ramGb,
        hardLimitStorageGb: HARD_LIMIT_SPECS.storageGb,
        error: err.message
      };
    }
  }

  static async createSshAccess(
    apiKey: string,
    sandboxId: string,
    expiresInMinutes = 1440
  ): Promise<{ success: boolean; token?: string; sshTarget?: string; error?: string }> {
    const cleanKey = (apiKey || '').trim();
    const cleanId = (sandboxId || '').replace(/^ssh\s+/i, '').replace(/@.*$/, '').trim();
    if (!cleanKey || !cleanId) {
      return { success: false, error: 'API key and Sandbox ID are required' };
    }
    try {
      const payload = JSON.stringify({ expiresInMinutes });
      const res = await this.httpRequest(`https://app.daytona.io/api/sandbox/${cleanId}/ssh-access`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        body: payload
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = JSON.parse(res.body);
        const token = data.token;
        const sshTarget = token ? `${token}@ssh.app.daytona.io` : `${cleanId}@ssh.app.daytona.io`;
        return { success: true, token, sshTarget };
      }
      return { success: false, error: `HTTP ${res.statusCode}: ${res.body}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  static async provisionWorkspace(
    apiKey: string,
    name: string,
    specs: VpsSpecs
  ): Promise<ProvisionWorkspaceResult> {
    const bounded = this.enforceHardwareBounds(specs);
    const cleanName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const payload = JSON.stringify({
      name: cleanName,
      target: 'us',
      resources: {
        cpu: bounded.cpuCores,
        memory: bounded.ramGb,
        disk: bounded.storageGb
      }
    });

    try {
      const res = await this.httpRequest('https://app.daytona.io/api/sandbox', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        body: payload
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = JSON.parse(res.body);
        const id = data.id || data.sandboxId || data.workspaceId;
        if (!id) {
          return { success: false, workspaceId: '', sshTarget: '', error: 'Provisioning returned no workspace id' };
        }

        const sshAccess = await this.createSshAccess(apiKey, id);
        if (sshAccess.success && sshAccess.sshTarget) {
          return { success: true, workspaceId: id, sshTarget: sshAccess.sshTarget };
        }
        return {
          success: false,
          workspaceId: '',
          sshTarget: '',
          error: sshAccess.error || 'Failed to create Daytona SSH access'
        };
      }

      return {
        success: false,
        workspaceId: '',
        sshTarget: '',
        error: `HTTP ${res.statusCode}: ${res.body || 'Failed to provision workspace'}`
      };
    } catch (err: any) {
      return {
        success: false,
        workspaceId: '',
        sshTarget: '',
        error: err.message
      };
    }
  }

  static async resolveSandbox(
    apiKey: string,
    sandboxInput: string
  ): Promise<{ success: boolean; sshTarget: string; id: string; name?: string; specs?: Partial<VpsSpecs>; error?: string }> {
    const raw = sandboxInput.trim();
    const cleanId = raw.replace(/^ssh\s+/i, '').replace(/@.*$/, '').trim();
    if (!cleanId) {
      return { success: false, sshTarget: '', id: '', error: 'Sandbox identifier cannot be empty' };
    }

    try {
      const res = await this.httpRequest('https://app.daytona.io/api/sandbox', {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const parsed = JSON.parse(res.body);
        const list = Array.isArray(parsed) ? parsed : (parsed.sandboxes || parsed.items || parsed.workspaces || []);
        const match = list.find((ws: any) =>
          ws.id === cleanId || (ws.name && ws.name.toLowerCase() === cleanId.toLowerCase())
        );
        if (match) {
          const targetId = match.id || cleanId;
          const specs: Partial<VpsSpecs> = {};
          if (match.resources) {
            if (match.resources.cpu) specs.cpuCores = match.resources.cpu;
            if (match.resources.memory) specs.ramGb = match.resources.memory;
            if (match.resources.disk) specs.storageGb = match.resources.disk;
          }
          const sshAccess = await this.createSshAccess(apiKey, targetId);
          return {
            success: true,
            sshTarget: sshAccess.sshTarget || `${targetId}@ssh.app.daytona.io`,
            id: targetId,
            name: match.name,
            specs
          };
        }
      }
    } catch (_) {}

    const isUuid = /^[0-9a-fA-F-]{36}$/.test(cleanId);
    let sshTarget = `${cleanId}@ssh.app.daytona.io`;
    if (apiKey && isUuid) {
      const sshAccess = await this.createSshAccess(apiKey, cleanId);
      if (sshAccess.sshTarget) sshTarget = sshAccess.sshTarget;
    }

    return {
      success: true,
      sshTarget,
      id: cleanId
    };
  }

  static async listWorkspacesDetailed(apiKey: string): Promise<WorkspaceListResult> {
    try {
      const res = await this.httpRequest('https://app.daytona.io/api/sandbox', {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const parsed = JSON.parse(res.body);
        const list = Array.isArray(parsed) ? parsed : (parsed.sandboxes || parsed.items || parsed.workspaces || []);
        const activeList = list.filter((ws: any) => {
          if (!ws) return false;
          if (ws.deleted === true || ws.isDeleted === true) return false;
          if (ws.deletedAt || ws.deleted_at) return false;
          const st = (ws.state || ws.status || '').toLowerCase().trim();
          if (['deleted', 'destroyed', 'terminating', 'failed', 'archived', 'stopped_deleted'].includes(st)) return false;
          return true;
        });
        const workspaces: DetailedWorkspace[] = activeList.map((ws: any) => ({
          id: ws.id || ws.name,
          name: ws.name || ws.id,
          specs: {
            cpuCores: ws.resources?.cpu || ws.cpu || HARD_LIMIT_SPECS.cpuCores,
            ramGb: ws.resources?.memory || ws.memory || HARD_LIMIT_SPECS.ramGb,
            storageGb: ws.resources?.disk || ws.disk || HARD_LIMIT_SPECS.storageGb
          }
        }));
        return { ok: true, authError: false, workspaces };
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        return { ok: false, authError: true, workspaces: [] };
      }
      return { ok: false, authError: false, workspaces: [] };
    } catch (_) {
      return { ok: false, authError: false, workspaces: [] };
    }
  }

  static async listWorkspaces(apiKey: string): Promise<DetailedWorkspace[]> {
    const det = await this.listWorkspacesDetailed(apiKey);
    if (!det.ok || det.authError) return [];
    return det.workspaces;
  }
}
