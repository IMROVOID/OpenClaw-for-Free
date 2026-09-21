import http from 'http';
import https from 'https';
import { URL } from 'url';
import { ControlPanelConfig } from './types.js';

export class EndpointResolver {
  /**
   * Extract clean VM slug from an SSH target or slug identifier.
   * e.g., "openclaw-llama:token@beta-ssh.freestyle.sh" -> "openclaw-llama"
   */
  static extractSlug(targetOrSlug: string): string {
    if (!targetOrSlug) return 'openclaw-llama';
    const clean = targetOrSlug.trim().replace(/^ssh\s+/i, '');
    const userPart = clean.split('@')[0] || '';
    if (userPart.includes(':')) {
      return userPart.split(':')[0].trim() || 'openclaw-llama';
    }
    return userPart || clean;
  }

  /**
   * Normalize an endpoint URL to ensure proper protocol and /v1 suffix.
   */
  static normalizeV1Url(rawUrl: string): string {
    let url = rawUrl.trim().replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    if (!url.endsWith('/v1')) {
      url = `${url}/v1`;
    }
    return url;
  }

  /**
   * Resolve the active OpenAI-compatible base URL for OpenClaw.
   */
  static resolveBaseUrl(config: ControlPanelConfig): string {
    if (!config.llama || !config.llama.enabled) {
      return '';
    }

    if (config.llama.activeEndpointUrl && config.llama.activeEndpointUrl.trim()) {
      return this.normalizeV1Url(config.llama.activeEndpointUrl);
    }

    const port = config.llamaPort || 8080;

    // 1. Same-VM co-located topology
    if (!config.llama.isSeparateVps) {
      return `http://127.0.0.1:${port}/v1`;
    }

    const secProvider = config.secondaryProvider || config.provider;

    // 2. Daytona Cloud -> Railway Relay
    if (secProvider === 'daytona') {
      if (config.llama.railwayEndpointUrl && config.llama.railwayEndpointUrl.trim()) {
        return this.normalizeV1Url(config.llama.railwayEndpointUrl);
      }
      if (config.railwayDomain && config.railwayDomain.trim()) {
        return this.normalizeV1Url(`https://${config.railwayDomain}`);
      }
      return '';
    }

    // 3. Freestyle.sh -> Native Ingress Domain (*.style.dev)
    if (config.llama.freestyleDomainUrl && config.llama.freestyleDomainUrl.trim()) {
      return this.normalizeV1Url(config.llama.freestyleDomainUrl);
    }

    const target = config.llama.sshTarget || config.secondarySshTarget || '';
    const slug = this.extractSlug(target);
    return `https://${slug}.style.dev/v1`;
  }

  /**
   * Probe an endpoint health check (/health) with a strict timeout.
   */
  static async probeEndpoint(
    endpointUrl: string,
    timeoutMs = 5000
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    if (!endpointUrl) {
      return { ok: false, error: 'Endpoint URL is empty' };
    }

    const base = endpointUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
    const healthUrl = `${base}/health`;

    return new Promise((resolve) => {
      try {
        const u = new URL(healthUrl);
        const transport = u.protocol === 'https:' ? https : http;
        const req = transport.get(u, { timeout: timeoutMs }, (res) => {
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 400,
            status,
            error: status >= 400 ? `HTTP ${status}` : undefined
          });
        });

        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, error: 'Connection timed out' });
        });
      } catch (err: any) {
        resolve({ ok: false, error: err.message });
      }
    });
  }
}
