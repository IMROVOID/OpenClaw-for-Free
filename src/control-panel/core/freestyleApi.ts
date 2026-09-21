import https from 'https';
import { URL } from 'url';
import { VpsSpecs } from './types.js';

export const FREESTYLE_DEFAULT_SPECS: VpsSpecs = {
  cpuCores: 4,
  ramGb: 8,
  storageGb: 32
};

export interface FreestyleVmSummary {
  id: string;
  slug: string;
  displayName?: string;
  state?: string;
  resources?: {
    cpu?: number;
    memory?: number;
    storage?: number;
  };
  cpu?: number;
  memory?: number;
  storage?: number;
}

export interface CreateVmPayload {
  slug: string;
  displayName?: string;
  firewall?: {
    rules: Array<{
      action: 'allow' | 'deny';
      source?: Record<string, any>;
      destination?: { public?: boolean; [key: string]: any };
    }>;
  };
  networks?: Array<{
    vpc: string;
    ipv4: boolean;
  }>;
  metadata?: Record<string, string>;
}

export class FreestyleApi {
  static readonly BASE_URL = 'https://api.freestyle.sh/v5';

  static getApiKeyGuidance(): string[] {
    return [
      '1. Open your browser and navigate to: https://freestyle.sh',
      '2. Sign in and open Settings -> API Keys (or https://freestyle.sh/settings/keys)',
      '3. Click "Create API Key", provide a name (e.g. OpenClaw-Control)',
      '4. Copy the secret API token and paste it here.'
    ];
  }

  static getExistingApiKeyGuidance(): string[] {
    return [
      '1. Navigate to: https://freestyle.sh and sign in.',
      '2. Open Settings -> API Keys.',
      '3. Copy an existing active key, or click "Create API Key" to generate a new one.',
      '4. Paste the API key into the prompt below.'
    ];
  }

  static getExistingSshGuidance(): string[] {
    return [
      '1. Open your Freestyle dashboard at https://freestyle.sh',
      '2. Select your target Virtual Machine.',
      '3. Copy the SSH target string formatted as: <slug>:<token>@beta-ssh.freestyle.sh',
      '   (Or copy the full "ssh <slug>:<token>@beta-ssh.freestyle.sh" command directly).'
    ];
  }

  static formatSshTarget(slug: string, token: string): string {
    return `${slug.trim()}:${token.trim()}@beta-ssh.freestyle.sh`;
  }

  static enforceHardwareBounds(requested: VpsSpecs): VpsSpecs {
    return {
      cpuCores: Math.max(1, Math.min(requested.cpuCores, FREESTYLE_DEFAULT_SPECS.cpuCores)),
      ramGb: Math.max(2, Math.min(requested.ramGb, FREESTYLE_DEFAULT_SPECS.ramGb)),
      storageGb: Math.max(5, Math.min(requested.storageGb, FREESTYLE_DEFAULT_SPECS.storageGb))
    };
  }

  static async validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string; vms?: FreestyleVmSummary[] }> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { valid: false, error: 'API key is empty' };
    }

    if (cleanKey.startsWith('fst_test_')) {
      return { valid: true, vms: [] };
    }

    try {
      const res = await this.httpRequest(`${this.BASE_URL}/vms`, {
        headers: { 'Authorization': `Bearer ${cleanKey}` }
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const parsed = JSON.parse(res.body);
        const vms: FreestyleVmSummary[] = Array.isArray(parsed) ? parsed : (parsed.vms || []);
        return { valid: true, vms };
      }

      if (res.statusCode === 401 || res.statusCode === 403) {
        return { valid: false, error: `Authentication failed (HTTP ${res.statusCode}): Invalid Freestyle API Key` };
      }

      return { valid: false, error: `HTTP ${res.statusCode}: Failed to validate Freestyle account` };
    } catch (err: any) {
      return { valid: false, error: `Network error reaching api.freestyle.sh: ${err.message}` };
    }
  }

  static async listVms(apiKey: string): Promise<FreestyleVmSummary[]> {
    const res = await this.validateApiKey(apiKey);
    return res.vms || [];
  }

  static async createVm(
    apiKey: string,
    payloadOrSlug: CreateVmPayload | string
  ): Promise<{ success: boolean; id: string; slug: string; error?: string }> {
    const cleanKey = apiKey.trim();
    const basePayload: CreateVmPayload = typeof payloadOrSlug === 'string'
      ? { slug: payloadOrSlug }
      : payloadOrSlug;

    const firewallRules = basePayload.firewall?.rules && basePayload.firewall.rules.length > 0
      ? basePayload.firewall.rules.map((r) => ({
          action: r.action,
          source: r.source || {},
          destination: r.destination || { public: true }
        }))
      : [{ action: 'allow' as const, source: {}, destination: { public: true } }];

    const payload: CreateVmPayload = {
      ...basePayload,
      firewall: {
        rules: firewallRules
      }
    };

    if (cleanKey.startsWith('fst_test_')) {
      return { success: true, id: `vm_${payload.slug}`, slug: payload.slug };
    }

    const bodyStr = JSON.stringify(payload);
    try {
      const res = await this.httpRequest(`${this.BASE_URL}/vms`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        },
        body: bodyStr
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = JSON.parse(res.body);
        const id = data.id || `vm_${payload.slug}`;
        const slug = data.slug || payload.slug;
        return { success: true, id, slug };
      }

      return {
        success: false,
        id: '',
        slug: payload.slug,
        error: `HTTP ${res.statusCode}: ${res.body || 'Failed to create VM'}`
      };
    } catch (err: any) {
      return {
        success: false,
        id: '',
        slug: payload.slug,
        error: err.message
      };
    }
  }

  static async createIdentityToken(
    apiKey: string,
    vmIdOrSlug: string
  ): Promise<{ token: string; expiresAt: string | null; error?: string }> {
    const cleanKey = apiKey.trim();
    if (cleanKey.startsWith('fst_test_')) {
      return { token: `fst_tok_${vmIdOrSlug}`, expiresAt: null };
    }

    try {
      let vmId = vmIdOrSlug.trim();
      if (!vmId.startsWith('vm-')) {
        const vms = await this.listVms(cleanKey);
        const match = vms.find((v) => v.slug === vmId || v.id === vmId);
        if (match?.id) {
          vmId = match.id;
        }
      }

      // Step 1: Create Identity (POST /v5/identities)
      const idnRes = await this.httpRequest(`${this.BASE_URL}/identities`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
          'Content-Length': 2
        },
        body: '{}'
      });

      if (idnRes.statusCode < 200 || idnRes.statusCode >= 300) {
        return { token: '', expiresAt: null, error: `HTTP ${idnRes.statusCode}: Failed to create identity: ${idnRes.body}` };
      }

      const idnData = JSON.parse(idnRes.body);
      const identityId = idnData.id;

      // Step 2: Grant VM Permission (POST /v5/identities/{id}/permissions/vm)
      const permBody = JSON.stringify({ vmId });
      const permRes = await this.httpRequest(`${this.BASE_URL}/identities/${identityId}/permissions/vm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(permBody)
        },
        body: permBody
      });

      if (permRes.statusCode < 200 || permRes.statusCode >= 300) {
        return { token: '', expiresAt: null, error: `HTTP ${permRes.statusCode}: Failed to grant VM access: ${permRes.body}` };
      }

      // Step 3: Mint Access Token (POST /v5/identities/{id}/tokens)
      const tokRes = await this.httpRequest(`${this.BASE_URL}/identities/${identityId}/tokens`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
          'Content-Length': 2
        },
        body: '{}'
      });

      if (tokRes.statusCode >= 200 && tokRes.statusCode < 300) {
        const tokData = JSON.parse(tokRes.body);
        return { token: tokData.token, expiresAt: tokData.expiresAt || null };
      }

      return {
        token: '',
        expiresAt: null,
        error: `HTTP ${tokRes.statusCode}: Failed to generate token: ${tokRes.body}`
      };
    } catch (err: any) {
      return { token: '', expiresAt: null, error: err.message };
    }
  }

  private static httpRequest(
    urlStr: string,
    options: { method?: string; headers?: Record<string, any>; body?: string }
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const req = https.request(u, {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 7000
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Freestyle API request timed out'));
      });
      if (options.body) req.write(options.body);
      req.end();
    });
  }
}
