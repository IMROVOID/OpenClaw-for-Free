import https from 'https';
import { RailwaySafetyGuard } from './railwaySafetyGuard.js';

export interface RailwayRelayItem {
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  domain: string;
  fullUrl: string;
  isLlama: boolean;
}

export class RailwayClient {
  /**
   * Cleans raw token input by stripping quotes, Bearer prefixes, and variable assignments.
   */
  static sanitizeToken(raw: string): string {
    let t = (raw || '').trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      t = t.slice(1, -1).trim();
    }
    if (/^bearer\s+/i.test(t)) {
      t = t.replace(/^bearer\s+/i, '').trim();
    }
    if (/^railway_api_token\s*=\s*/i.test(t)) {
      t = t.replace(/^railway_api_token\s*=\s*/i, '').trim();
    }
    if (/^railway_token\s*=\s*/i.test(t)) {
      t = t.replace(/^railway_token\s*=\s*/i, '').trim();
    }
    return t;
  }

  static async executeGraphQL<T = unknown>(
    apiKey: string,
    query: string,
    variables?: Record<string, unknown>,
    timeoutMs = 7000,
    customHeaders?: Record<string, string>
  ): Promise<{ data?: T; errors?: Array<{ message: string }>; statusCode?: number }> {
    const key = this.sanitizeToken(apiKey);
    if (!key) return { errors: [{ message: 'API key is empty' }] };

    const safety = RailwaySafetyGuard.isRestricted(key);
    if (safety.restricted) {
      return {
        errors: [
          {
            message: `Railway account is under safety cooldown: ${safety.reason || 'Restricted'}. Automated requests halted to prevent account bans.`
          }
        ],
        statusCode: 429
      };
    }

    await RailwaySafetyGuard.throttle();

    const postData = JSON.stringify({ query, variables });
    const reqHeaders: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(postData)
    };

    if (customHeaders) {
      if (customHeaders['Project-Access-Token']) {
        delete reqHeaders['Authorization'];
      }
      Object.assign(reqHeaders, customHeaders);
    }

    return new Promise((resolve) => {
      try {
        const req = https.request(
          'https://backboard.railway.com/graphql/v2',
          {
            method: 'POST',
            timeout: timeoutMs,
            headers: reqHeaders
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try {
                const json = JSON.parse(body);
                const result = { data: json.data, errors: json.errors, statusCode: res.statusCode };
                const errText = json.errors?.[0]?.message || (res.statusCode && res.statusCode >= 400 ? `HTTP ${res.statusCode}` : '');
                if (res.statusCode === 429 || res.statusCode === 402) {
                  RailwaySafetyGuard.recordError(key, errText || `HTTP ${res.statusCode}`);
                } else if (errText && RailwaySafetyGuard.isAbuseOrRestrictionError(errText)) {
                  RailwaySafetyGuard.recordError(key, errText);
                }
                resolve(result);
              } catch (_) {
                const errMsg = `HTTP ${res.statusCode}: ${body.slice(0, 100)}`;
                if (res.statusCode === 429 || res.statusCode === 402) {
                  RailwaySafetyGuard.recordError(key, errMsg);
                }
                resolve({ errors: [{ message: errMsg }], statusCode: res.statusCode });
              }
            });
          }
        );

        req.on('error', (err) => {
          resolve({ errors: [{ message: err.message }] });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ errors: [{ message: 'GraphQL request timed out' }] });
        });

        req.write(postData);
        req.end();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve({ errors: [{ message: msg }] });
      }
    });
  }

  static async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    user?: string;
    tokenType?: 'account' | 'workspace' | 'project';
    error?: string;
  }> {
    const key = this.sanitizeToken(apiKey);
    if (!key) return { valid: false, error: 'Empty token' };

    // 1. Check Bearer token against projects query (works for Account and Workspace tokens)
    const projRes = await this.executeGraphQL<{ projects?: { edges?: Array<{ node: { id: string; name: string } }> } }>(
      key,
      'query { projects { edges { node { id name } } } }',
      undefined,
      5000
    );

    if (projRes.data?.projects) {
      const edges = projRes.data.projects.edges || [];
      const projectName = edges.length > 0 ? edges[0].node.name : undefined;

      // Try reading user info (works on Account tokens, returns "Not Authorized" on Workspace tokens)
      const meRes = await this.executeGraphQL<{ me?: { id: string; name?: string; email?: string } }>(
        key,
        'query { me { id name email } }',
        undefined,
        4000
      );

      if (meRes.data?.me) {
        const u = meRes.data.me;
        return {
          valid: true,
          user: u.email || u.name || u.id,
          tokenType: 'account'
        };
      }

      return {
        valid: true,
        user: projectName ? `Workspace (Project: ${projectName})` : 'Workspace Token',
        tokenType: 'workspace'
      };
    }

    // 2. Check if this is a Project Token requiring Project-Access-Token header
    const isAuthError = projRes.statusCode === 401 ||
      projRes.statusCode === 403 ||
      projRes.errors?.some((e) => /not authorized|unauthorized/i.test(e.message));

    if (isAuthError) {
      const projTokenRes = await this.executeGraphQL<{ projectToken?: { projectId: string; environmentId?: string } }>(
        key,
        'query { projectToken { projectId environmentId } }',
        undefined,
        5000,
        { 'Project-Access-Token': key }
      );

      if (projTokenRes.data?.projectToken?.projectId) {
        return {
          valid: true,
          user: `Project Token (${projTokenRes.data.projectToken.projectId.slice(0, 8)})`,
          tokenType: 'project'
        };
      }
    }

    if (isAuthError) {
      return {
        valid: false,
        error: 'Not Authorized. If using an Account Token, ensure "No Workspace" or active workspace was selected at https://railway.com/account/tokens. If using a Project Token, ensure it is active in Project Settings > Tokens.'
      };
    }

    return { valid: false, error: projRes.errors?.[0]?.message || 'Invalid Railway token' };
  }

  static async listExistingRelays(apiKey: string): Promise<RailwayRelayItem[]> {
    const key = (apiKey || '').trim();
    if (!key) return [];

    const q = `
      query {
        projects {
          edges {
            node {
              id
              name
              environments {
                edges {
                  node {
                    id
                    name
                  }
                }
              }
              services {
                edges {
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    const res = await this.executeGraphQL<{
      projects?: {
        edges?: Array<{
          node: {
            id: string;
            name: string;
            environments?: { edges?: Array<{ node: { id: string; name: string } }> };
            services?: { edges?: Array<{ node: { id: string; name: string } }> };
          };
        }>;
      };
    }>(key, q, undefined, 6000);

    const projects = res.data?.projects?.edges?.map((e) => e.node) || [];
    const results: RailwayRelayItem[] = [];

    for (const proj of projects) {
      const envs = proj.environments?.edges?.map((e) => e.node) || [];
      if (envs.length === 0) continue;
      const services = proj.services?.edges?.map((e) => e.node) || [];

      for (const env of envs) {
        for (const svc of services) {
          const domQ = `
            query($pid: String!, $eid: String!, $sid: String!) {
              domains(projectId: $pid, environmentId: $eid, serviceId: $sid) {
                serviceDomains { domain }
                customDomains { domain }
              }
            }
          `;
          const domRes = await this.executeGraphQL<{
            domains?: {
              serviceDomains?: Array<{ domain: string }>;
              customDomains?: Array<{ domain: string }>;
            };
          }>(key, domQ, { pid: proj.id, eid: env.id, sid: svc.id }, 4000);

          const sDoms = domRes.data?.domains?.serviceDomains?.map((d) => d.domain) || [];
          const cDoms = domRes.data?.domains?.customDomains?.map((d) => d.domain) || [];
          const allDoms = [...sDoms, ...cDoms];

          for (const d of allDoms) {
            if (!results.some((r) => r.domain.toLowerCase() === d.toLowerCase())) {
              results.push({
                projectId: proj.id,
                projectName: proj.name,
                serviceId: svc.id,
                serviceName: svc.name,
                domain: d,
                fullUrl: `https://${d}`,
                isLlama: /llama/i.test(svc.name) || /llama/i.test(d)
              });
            }
          }
        }
      }
    }

    return results.sort((a, b) => (a.isLlama ? 1 : 0) - (b.isLlama ? 1 : 0));
  }
}
