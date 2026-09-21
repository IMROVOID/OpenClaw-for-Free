import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { VpsProbe } from './vpsProbe.js';
import { RailwayHelper } from './railwayHelper.js';

import { RailwayDomainManager } from './railwayDomainManager.js';
import { RailwayClient } from './railwayClient.js';
import { RailwayTargetResolver } from './railwayTargetResolver.js';
import { RailwaySafetyGuard } from './railwaySafetyGuard.js';

export interface RailwayWebRelayDeployOptions {
  apiKey: string;
  domain: string;
  upstreams?: {
    openclaw?: string;
    omniroute?: string;
    llama?: string;
  };
  primaryWorkspaceId?: string;
  secondaryWorkspaceId?: string;
  forceRedeploy?: boolean;
}

const getDirname = (): string => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

export class WebIngressDeployer {
  static getScript(): string {
    const currentDir = getDirname();
    const candidates = [
      path.resolve(process.cwd(), 'scripts', 'setup_web_ingress.sh'),
      path.resolve(currentDir, '..', '..', '..', 'scripts', 'setup_web_ingress.sh'),
      path.resolve(currentDir, 'scripts', 'setup_web_ingress.sh')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          return fs.readFileSync(p, 'utf-8');
        } catch (_) {}
      }
    }
    return '';
  }

  static getRelayDirectory(): string {
    const currentDir = getDirname();
    const candidates = [
      path.resolve(process.cwd(), 'relay', 'railway-web-relay'),
      path.resolve(currentDir, '..', '..', '..', 'relay', 'railway-web-relay'),
      path.resolve(currentDir, 'relay', 'railway-web-relay')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return path.resolve(process.cwd(), 'relay', 'railway-web-relay');
  }

  static buildDaytonaUpstreams(primaryWorkspaceId?: string, secondaryWorkspaceId?: string): {
    openclaw: string;
    omniroute: string;
    llama: string;
  } {
    const prim = (primaryWorkspaceId || '').trim();
    const sec = (secondaryWorkspaceId || '').trim() || prim;
    if (!prim) {
      return {
        openclaw: 'http://127.0.0.1:18789',
        omniroute: 'http://127.0.0.1:20128',
        llama: 'http://127.0.0.1:8080'
      };
    }
    return {
      openclaw: `https://18789-${prim}.proxy.daytona.work`,
      omniroute: `https://20128-${prim}.proxy.daytona.work`,
      llama: `https://8080-${sec}.proxy.daytona.work`
    };
  }

  static async execCliCommand(
    cmd: string,
    args: string[],
    env: Record<string, string>,
    cwd?: string,
    timeoutMs = 60000
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const escapedArgs = args.map((a) => {
        if (/^[a-zA-Z0-9_./:=-]+$/.test(a)) return a;
        return `"${a.replace(/"/g, '\\"')}"`;
      });
      const fullCmd = `${cmd} ${escapedArgs.join(' ')}`;
      exec(
        fullCmd,
        {
          cwd,
          env: { ...process.env, ...env },
          timeout: timeoutMs
        },
        (error, stdout, stderr) => {
          resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || (error ? error.message : ''))
          });
        }
      );
    });
  }

  static async deployRailwayWebRelay(options: RailwayWebRelayDeployOptions): Promise<{
    success: boolean;
    message: string;
    reachable?: boolean;
  }> {
    const apiKey = (options.apiKey || '').trim();
    if (!apiKey) {
      return { success: false, message: 'Railway API token is required to deploy Web Relay.' };
    }
    const cleanDomain = RailwayDomainManager.normalizeDomain(options.domain);
    if (!cleanDomain) {
      return { success: false, message: 'Domain is required to deploy Web Relay.' };
    }

    // Safety guard: prevent automated calls when account is restricted/under cooldown
    const safety = RailwaySafetyGuard.isRestricted(apiKey);
    if (safety.restricted) {
      return {
        success: false,
        message: `Railway account is under safety cooldown: ${safety.reason || 'Restricted'}. Automated deployment stopped to protect your account. Check https://railway.com/account/billing or use Local SSH Port Forwarding.`
      };
    }

    // 1. Resolve Railway target context (project, environment, service) with cleanDomain to detect redeployment
    let target = await RailwayTargetResolver.resolveTargetContext(apiKey, cleanDomain);

    // 0. Availability check: allow redeployment if user confirmed, domain is user-owned, or target service exists
    try {
      const avail = await RailwayDomainManager.checkDomainAvailability(apiKey, cleanDomain);
      const isRedeploy = Boolean(options.forceRedeploy || target || avail.isUserOwned);
      if (avail.isOccupied && !isRedeploy) {
        const recs = await RailwayDomainManager.getAvailableRecommendations(apiKey, cleanDomain, 3);
        const recMsg = recs.length > 0 ? ` Recommended free alternatives: ${recs.join(', ')}` : '';
        return {
          success: false,
          message: `Domain "${cleanDomain}" is already occupied on Railway.${recMsg}`
        };
      }
    } catch (_) {}

    const upstreams = options.upstreams || this.buildDaytonaUpstreams(options.primaryWorkspaceId, options.secondaryWorkspaceId);
    const relayDir = this.getRelayDirectory();
    if (!fs.existsSync(relayDir)) {
      return { success: false, message: `relay/railway-web-relay directory not found at ${relayDir}` };
    }

    const upstreamVars = {
      OPENCLAW_UPSTREAM: upstreams.openclaw || 'http://127.0.0.1:18789',
      OMNIROUTE_UPSTREAM: upstreams.omniroute || 'http://127.0.0.1:20128',
      LLAMA_UPSTREAM: upstreams.llama || 'http://127.0.0.1:8080'
    };

    if (target) {
      await RailwayTargetResolver.upsertVariables(apiKey, target, upstreamVars);
    }

    // 2. Set environment variables for Railway CLI (account-level or project-level token)
    const val = await RailwayClient.validateApiKey(apiKey);
    const env: Record<string, string> = val.tokenType === 'project'
      ? { RAILWAY_TOKEN: apiKey }
      : { RAILWAY_API_TOKEN: apiKey };

    // Also set CLI variables if target is known or fallback to generic
    const varArgs = ['variable', 'set',
      `OPENCLAW_UPSTREAM=${upstreamVars.OPENCLAW_UPSTREAM}`,
      `OMNIROUTE_UPSTREAM=${upstreamVars.OMNIROUTE_UPSTREAM}`,
      `LLAMA_UPSTREAM=${upstreamVars.LLAMA_UPSTREAM}`,
      '--skip-deploys'
    ];
    if (target) {
      varArgs.push('--project', target.projectId, '--environment', target.environmentId, '--service', target.serviceId);
    }
    await this.execCliCommand('railway', varArgs, env, relayDir, 30000);

    // 3. Deploy project with explicit project/environment/service to prevent interactive login prompt
    const upArgs = ['up', '--detach', '-y'];
    if (target) {
      upArgs.push('--project', target.projectId, '--environment', target.environmentId, '--service', target.serviceId);
    }
    const upRes = await this.execCliCommand('railway', upArgs, env, relayDir, 60000);
    if (upRes.code !== 0 && !upRes.stdout.includes('Deploy initiated')) {
      const errCombined = `${upRes.stderr} ${upRes.stdout}`;
      let userFriendlyMessage = upRes.stderr || upRes.stdout || `Exit code ${upRes.code}`;
      if (/payment|unauthorized/i.test(errCombined)) {
        userFriendlyMessage = `Payment method required or account restricted. Railway blocks new deployments on this workspace until a payment method is verified at https://railway.com/account/billing. Alternatively, switch to Local SSH Port Forwarding mode in WebUI Access Settings.`;
      }
      return {
        success: false,
        message: `Railway deployment failed: ${userFriendlyMessage}`
      };
    }

    // 4. Attach domain via GraphQL API and verify
    if (target) {
      const domRes = await RailwayDomainManager.ensureServiceDomain(
        apiKey,
        target.projectId,
        target.environmentId,
        target.serviceId,
        cleanDomain
      );
      if (!domRes.success) {
        return {
          success: false,
          message: `Deployment uploaded, but domain attachment failed: ${domRes.message || 'Unknown error'}`
        };
      }
    } else {
      const domArgs = ['domain', cleanDomain];
      await this.execCliCommand('railway', domArgs, env, relayDir, 30000);
    }

    return {
      success: true,
      message: `Railway Web Relay deployed successfully for ${cleanDomain}`
    };
  }

  static async deploy(primaryTarget: string, domain: string): Promise<{ success: boolean; message?: string }> {
    if (!primaryTarget || !domain) {
      return { success: false, message: 'Missing primary target or domain.' };
    }
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    const script = this.getScript();
    if (!script) {
      return { success: false, message: 'setup_web_ingress.sh script not found.' };
    }

    const cmd = `bash -s -- '${cleanDomain}'`;
    const res = await VpsProbe.execRemoteWithStdin(primaryTarget, cmd, script, 90);
    if (res.code === 0) {
      return { success: true, message: `Caddy Web Ingress configured successfully for https://${cleanDomain}` };
    }
    return { success: false, message: res.stderr || res.stdout || `Exit code ${res.code}` };
  }

  static async verify(domain: string, probePath = '/health'): Promise<{ reachable: boolean; message?: string }> {
    const check = await RailwayHelper.checkRelayDomain(domain, 5000, probePath);
    return { reachable: check.reachable, message: check.message };
  }
}
