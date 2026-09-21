import { ControlPanelConfig } from './types.js';
import { RailwayClient } from './railwayClient.js';
import { RailwayHelper } from './railwayHelper.js';
import { RailwayDomainManager } from './railwayDomainManager.js';

export interface RailwayIngressVerificationResult {
  verified: boolean;
  domain?: string;
  apiKey?: string;
  reason?: string;
}

export class RailwayIngressVerifier {
  /**
   * Auto-detects an existing Railway API Token from config or environment variables.
   */
  static detectRailwayApiKey(config: ControlPanelConfig): string {
    const fromConfig = (config.railwayApiKey || '').trim();
    if (fromConfig) return fromConfig;

    const fromEnv = (
      process.env.RAILWAY_API_TOKEN ||
      process.env.RAILWAY_TOKEN ||
      process.env.RAILWAY_API_KEY ||
      ''
    ).trim();

    return fromEnv;
  }

  /**
   * Verifies Railway API token, locates the deployed Web Relay domain,
   * and verifies that the domain is reachable and not returning 404.
   */
  static async verifyRelay(
    apiKey: string,
    candidateDomain?: string
  ): Promise<RailwayIngressVerificationResult> {
    if (!apiKey) {
      return { verified: false, reason: 'No Railway API token provided or detected.' };
    }

    const val = await RailwayClient.validateApiKey(apiKey);
    if (!val.valid) {
      return { verified: false, reason: val.error || 'Invalid Railway API token.' };
    }

    const relays = await RailwayClient.listExistingRelays(apiKey);
    const webRelay = RailwayHelper.findWebRelay(relays);

    let targetDomain = candidateDomain ? RailwayDomainManager.normalizeDomain(candidateDomain) : '';
    if (!targetDomain && webRelay?.domain) {
      targetDomain = RailwayDomainManager.normalizeDomain(webRelay.domain);
    }

    if (!targetDomain) {
      return {
        verified: false,
        apiKey,
        reason: 'No deployed Railway Web Relay domain found for this account.'
      };
    }

    if (/egress/i.test(targetDomain)) {
      return {
        verified: false,
        apiKey,
        domain: targetDomain,
        reason: 'Configured domain is an Egress relay, not a Web Relay (returns 404).'
      };
    }

    const health = await RailwayHelper.checkRelayDomain(targetDomain, 4000);
    if (!health.reachable || health.statusCode === 404) {
      return {
        verified: false,
        apiKey,
        domain: targetDomain,
        reason: health.message || 'Railway domain is unreachable or returning 404.'
      };
    }

    return {
      verified: true,
      domain: targetDomain,
      apiKey
    };
  }

  /**
   * Auto-detects and verifies Railway Ingress.
   * ONLY if everything is fine, sets Railway Relay URL on the config.
   * If anything is wrong, disables the domain and falls back to local SSH Port Forwarding.
   */
  static async autoDetectAndVerify(config: ControlPanelConfig): Promise<ControlPanelConfig> {
    if (!config.domainedUrlsEnabled && config.ingressProvider !== 'railway') {
      return config;
    }

    const apiKey = this.detectRailwayApiKey(config);
    const candidateDomain = config.publicBaseDomain || config.railwayDomain;

    if (!apiKey) {
      config.domainedUrlsEnabled = false;
      config.publicBaseDomain = undefined;
      config.ingressProvider = 'none';
      return config;
    }

    config.railwayApiKey = apiKey;
    const res = await this.verifyRelay(apiKey, candidateDomain);

    if (res.verified && res.domain) {
      config.domainedUrlsEnabled = true;
      config.publicBaseDomain = res.domain;
      config.ingressProvider = 'railway';
    } else {
      config.domainedUrlsEnabled = false;
      config.publicBaseDomain = undefined;
      config.ingressProvider = 'none';
    }

    return config;
  }
}
