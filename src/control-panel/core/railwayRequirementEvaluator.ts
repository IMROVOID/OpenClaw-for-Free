import { CloudProviderType } from './types.js';

export interface RailwayEvaluationContext {
  provider: CloudProviderType;
  hasDiscordOrNonTelegramMessenger?: boolean;
  llamaTopology?: 'dedicated' | 'same_vm' | 'cloud_only';
  secondaryProvider?: CloudProviderType;
  domainedUrlsRequested?: boolean;
  domainedUrlProvider?: 'railway' | 'freestyle' | 'none';
}

export interface RailwayRequirementResult {
  needed: boolean;
  status: 'required' | 'optional' | 'not_needed';
  egressRelayNeeded: boolean;
  llamaRelayNeeded: boolean;
  webRelayNeeded: boolean;
  reasons: string[];
  guidance: string;
}

export class RailwayRequirementEvaluator {
  /**
   * Evaluates whether Railway is required, optional, or not needed based on the
   * cloud platform, messaging channels, inference topology, and ingress mode.
   */
  static evaluate(ctx: RailwayEvaluationContext): RailwayRequirementResult {
    const isDaytona = ctx.provider === 'daytona';
    const reasons: string[] = [];

    let egressRelayNeeded = false;
    let llamaRelayNeeded = false;
    let webRelayNeeded = false;

    if (isDaytona) {
      // Rule 1 (Daytona): Basic OpenClaw + OmniRoute requires Railway Egress Relay
      // to guarantee outbound access to all LLM providers and Cloudflare edge networks.
      egressRelayNeeded = true;
      reasons.push('Daytona Cloud requires Railway Egress Relay for reliable OmniRoute model routing and outbound network connectivity.');

      if (ctx.hasDiscordOrNonTelegramMessenger) {
        reasons.push('Daytona hypervisor terminates Discord Gateway & outbound webhooks; Railway Xray egress relay is required.');
      }

      // Rule 2 (Daytona Dedicated Llama): Requires Llama SSE Reverse Proxy
      if (ctx.llamaTopology === 'dedicated') {
        llamaRelayNeeded = true;
        reasons.push('Daytona container isolation prevents direct inbound connections; Railway Llama SSE streaming relay is required for Dedicated Secondary VM.');
      }

      // Rule 3 (Daytona Domained URLs): Requires Railway Web Ingress Relay
      if (ctx.domainedUrlsRequested) {
        webRelayNeeded = true;
        reasons.push('Daytona provides no public IP and blocks Cloudflare tunnels; Railway Web Relay is required to host permanent domained URLs.');
      }

      const guidance = 'Railway is REQUIRED on Daytona Cloud to enable outbound AI provider egress and public ingress.';

      return {
        needed: true,
        status: 'required',
        egressRelayNeeded,
        llamaRelayNeeded,
        webRelayNeeded,
        reasons,
        guidance
      };
    }

    // Provider: Freestyle.sh (or other unrestricted provider)
    // Freestyle features 32GB disk, unrestricted direct egress, and native domains (<slug>.style.dev).
    if (ctx.domainedUrlsRequested && ctx.domainedUrlProvider === 'railway') {
      webRelayNeeded = true;
      reasons.push('Railway selected as custom web ingress provider for Freestyle VM.');
      return {
        needed: true,
        status: 'optional',
        egressRelayNeeded: false,
        llamaRelayNeeded: false,
        webRelayNeeded: true,
        reasons,
        guidance: 'Railway is OPTIONAL on Freestyle.sh (User chose Railway for domain ingress).'
      };
    }

    reasons.push('Freestyle.sh provides unrestricted direct internet egress and native <slug>.style.dev domains. Railway is not needed.');
    return {
      needed: false,
      status: 'not_needed',
      egressRelayNeeded: false,
      llamaRelayNeeded: false,
      webRelayNeeded: false,
      reasons,
      guidance: 'Railway is NOT NEEDED for this Freestyle setup. Standard ports and native domains work directly.'
    };
  }
}
