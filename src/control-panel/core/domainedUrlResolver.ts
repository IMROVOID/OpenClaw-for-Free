import { ControlPanelConfig } from './types.js';

export interface ResolvedUrlResult {
  url: string;
  isDomained: boolean;
  portForwardCmd: string;
}

export class DomainedUrlResolver {
  private static cleanDomain(domain?: string): string {
    return (domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  /**
   * Resolves OpenClaw Gateway & WebUI access URL
   */
  static resolveOpenclawUrl(config: ControlPanelConfig): ResolvedUrlResult {
    const port = config.openclawPort || 18789;
    const target = config.primarySshTarget || '<primary-vps>';
    const token = config.openclawToken || '';
    const tokenParam = token ? encodeURIComponent(token) : '';
    const tokenSuffix = tokenParam ? `?token=${tokenParam}#token=${tokenParam}` : '';
    const portForwardCmd = `ssh -N -L ${port}:127.0.0.1:${port} ${target}`;

    if (config.customOpenclawUrl) {
      const base = config.customOpenclawUrl.replace(/\/+$/, '');
      const url = base.includes('?') || base.includes('#') ? base : `${base}/${tokenSuffix}`;
      return { url, isDomained: true, portForwardCmd };
    }

    if (config.domainedUrlsEnabled && config.publicBaseDomain) {
      const domain = this.cleanDomain(config.publicBaseDomain);
      const url = `https://${domain}/openclaw/${tokenSuffix}`;
      return { url, isDomained: true, portForwardCmd };
    }

    const localUrl = `http://127.0.0.1:${port}/${tokenSuffix}`;
    return { url: localUrl, isDomained: false, portForwardCmd };
  }

  /**
   * Resolves OmniRoute Admin Dashboard & API URL
   */
  static resolveOmnirouteUrl(config: ControlPanelConfig): ResolvedUrlResult {
    const port = config.omniroutePort || 20128;
    const target = config.primarySshTarget || '<primary-vps>';
    const portForwardCmd = `ssh -N -L ${port}:127.0.0.1:${port} ${target}`;

    if (config.customOmnirouteUrl) {
      const base = config.customOmnirouteUrl.replace(/\/+$/, '');
      const url = base.endsWith('/dashboard') ? base : `${base}/dashboard`;
      return { url, isDomained: true, portForwardCmd };
    }

    if (config.domainedUrlsEnabled && config.publicBaseDomain) {
      const domain = this.cleanDomain(config.publicBaseDomain);
      const url = `https://${domain}/omniroute/dashboard`;
      return { url, isDomained: true, portForwardCmd };
    }

    const localUrl = `http://127.0.0.1:${port}/dashboard`;
    return { url: localUrl, isDomained: false, portForwardCmd };
  }

  /**
   * Resolves Llama Inference WebUI & Streaming API URL
   */
  static resolveLlamaUrl(config: ControlPanelConfig): ResolvedUrlResult {
    const port = config.llamaPort || 8080;
    const target = config.secondarySshTarget || config.primarySshTarget || '<llama-vps>';
    const portForwardCmd = `ssh -N -L ${port}:127.0.0.1:${port} ${target}`;

    if (config.customLlamaUrl) {
      const url = config.customLlamaUrl.replace(/\/+$/, '');
      return { url, isDomained: true, portForwardCmd };
    }

    if (config.domainedUrlsEnabled && config.publicBaseDomain) {
      const domain = this.cleanDomain(config.publicBaseDomain);
      const url = `https://${domain}/llama`;
      return { url, isDomained: true, portForwardCmd };
    }

    if (config.llama?.activeEndpointUrl && !config.llama.activeEndpointUrl.includes('127.0.0.1')) {
      const url = config.llama.activeEndpointUrl.replace(/\/+$/, '');
      return { url, isDomained: true, portForwardCmd };
    }

    const localUrl = `http://127.0.0.1:${port}`;
    return { url: localUrl, isDomained: false, portForwardCmd };
  }
}
