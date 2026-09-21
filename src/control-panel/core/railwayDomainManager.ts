import crypto from 'crypto';
import { RailwayClient } from './railwayClient.js';

export interface DomainAvailabilityResult {
  available: boolean;
  isUserOwned: boolean;
  isOccupied: boolean;
  domain: string;
  subdomain: string;
  message?: string;
}

export interface EnsureServiceDomainResult {
  success: boolean;
  domain: string;
  message?: string;
}

export class RailwayDomainManager {
  static normalizeDomain(input?: string, defaultSuffix = 'up.railway.app'): string | undefined {
    let domain = input?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (!domain) return undefined;
    if (!domain.includes('.')) {
      domain = `${domain}.${defaultSuffix}`;
    }
    if (domain.length > 253) return undefined;
    return domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      ? domain
      : undefined;
  }

  static extractSubdomain(input?: string): string {
    const raw = (input || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (!raw) return '';
    const firstPart = raw.split('.')[0] || '';
    return firstPart.replace(/[^a-z0-9-]/g, '');
  }

  static async checkDomainAvailability(
    apiKey: string,
    domainOrSubdomain: string
  ): Promise<DomainAvailabilityResult> {
    const domain = this.normalizeDomain(domainOrSubdomain);
    const subdomain = this.extractSubdomain(domainOrSubdomain);
    if (!domain) {
      return { available: false, isUserOwned: false, isOccupied: false, domain: '', subdomain: '', message: 'Invalid domain format' };
    }

    try {
      const relays = await RailwayClient.listExistingRelays(apiKey);
      const isOwned = relays.some((r) => r.domain.toLowerCase() === domain);
      if (isOwned) {
        return {
          available: true,
          isUserOwned: true,
          isOccupied: false,
          domain,
          subdomain,
          message: 'Domain already belongs to your Railway account'
        };
      }
    } catch (_) {}

    const q = `
      query($domain: String!) {
        serviceDomainAvailable(domain: $domain) {
          available
          message
        }
      }
    `;

    const res = await RailwayClient.executeGraphQL<{
      serviceDomainAvailable?: { available: boolean; message: string };
    }>(apiKey, q, { domain });

    if (res.data?.serviceDomainAvailable) {
      const avail = res.data.serviceDomainAvailable.available;
      return {
        available: avail,
        isUserOwned: false,
        isOccupied: !avail,
        domain,
        subdomain,
        message: res.data.serviceDomainAvailable.message
      };
    }

    const errMsg = res.errors?.[0]?.message || 'Failed to check domain availability';
    return { available: false, isUserOwned: false, isOccupied: false, domain, subdomain, message: errMsg };
  }

  static async getAvailableRecommendations(
    apiKey: string,
    baseSubdomain: string,
    count = 3
  ): Promise<string[]> {
    const cleanBase = this.extractSubdomain(baseSubdomain) || 'openclaw';
    const suffixes = [
      'bot',
      'app',
      'live',
      'hub',
      'relay',
      crypto.randomBytes(2).toString('hex'),
      crypto.randomBytes(2).toString('hex'),
      crypto.randomBytes(3).toString('hex')
    ];

    const candidates: string[] = [];
    for (const s of suffixes) {
      const cand = `${cleanBase}-${s}.up.railway.app`;
      if (!candidates.includes(cand)) candidates.push(cand);
    }

    const available: string[] = [];
    for (const cand of candidates) {
      if (available.length >= count) break;
      try {
        const q = `
          query($domain: String!) {
            serviceDomainAvailable(domain: $domain) {
              available
            }
          }
        `;
        const res = await RailwayClient.executeGraphQL<{
          serviceDomainAvailable?: { available: boolean };
        }>(apiKey, q, { domain: cand }, 3000);
        if (res.data?.serviceDomainAvailable?.available) {
          available.push(cand);
        }
      } catch (_) {}
    }

    return available;
  }

  static async ensureServiceDomain(
    apiKey: string,
    projectId: string,
    environmentId: string,
    serviceId: string,
    desiredDomain: string
  ): Promise<EnsureServiceDomainResult> {
    const cleanDomain = this.normalizeDomain(desiredDomain);
    if (!cleanDomain) {
      return { success: false, domain: desiredDomain, message: 'Invalid desired domain' };
    }

    const isRailwayServiceDomain = cleanDomain.endsWith('.up.railway.app');

    const domQ = `
      query($pid: String!, $eid: String!, $sid: String!) {
        domains(projectId: $pid, environmentId: $eid, serviceId: $sid) {
          serviceDomains { id domain }
          customDomains { id domain }
        }
      }
    `;

    const domRes = await RailwayClient.executeGraphQL<{
      domains?: {
        serviceDomains?: Array<{ id: string; domain: string }>;
        customDomains?: Array<{ id: string; domain: string }>;
      };
    }>(apiKey, domQ, { pid: projectId, eid: environmentId, sid: serviceId });

    const existingServiceDomains = domRes.data?.domains?.serviceDomains || [];
    const existingCustomDomains = domRes.data?.domains?.customDomains || [];

    if (isRailwayServiceDomain) {
      if (existingServiceDomains.length > 0) {
        const current = existingServiceDomains[0];
        if (current.domain.toLowerCase() === cleanDomain) {
          return { success: true, domain: cleanDomain };
        }
        const updateQ = `
          mutation($input: ServiceDomainUpdateInput!) {
            serviceDomainUpdate(input: $input)
          }
        `;
        const updateRes = await RailwayClient.executeGraphQL<{
          serviceDomainUpdate?: boolean;
        }>(apiKey, updateQ, {
          input: {
            serviceDomainId: current.id,
            domain: cleanDomain,
            environmentId,
            serviceId
          }
        });
        if (updateRes.data?.serviceDomainUpdate) {
          return { success: true, domain: cleanDomain };
        }
        return {
          success: false,
          domain: cleanDomain,
          message: updateRes.errors?.[0]?.message || 'Failed to update service domain'
        };
      } else {
        const createQ = `
          mutation($input: ServiceDomainCreateInput!) {
            serviceDomainCreate(input: $input) {
              id
              domain
            }
          }
        `;
        const createRes = await RailwayClient.executeGraphQL<{
          serviceDomainCreate?: { id: string; domain: string };
        }>(apiKey, createQ, {
          input: { environmentId, serviceId }
        });
        if (!createRes.data?.serviceDomainCreate) {
          return {
            success: false,
            domain: cleanDomain,
            message: createRes.errors?.[0]?.message || 'Failed to create service domain'
          };
        }

        const newDomainId = createRes.data.serviceDomainCreate.id;
        const updateQ = `
          mutation($input: ServiceDomainUpdateInput!) {
            serviceDomainUpdate(input: $input)
          }
        `;
        const updateRes = await RailwayClient.executeGraphQL<{
          serviceDomainUpdate?: boolean;
        }>(apiKey, updateQ, {
          input: {
            serviceDomainId: newDomainId,
            domain: cleanDomain,
            environmentId,
            serviceId
          }
        });
        if (updateRes.data?.serviceDomainUpdate) {
          return { success: true, domain: cleanDomain };
        }
        return {
          success: false,
          domain: cleanDomain,
          message: updateRes.errors?.[0]?.message || 'Failed to rename service domain'
        };
      }
    } else {
      const exists = existingCustomDomains.some((d) => d.domain.toLowerCase() === cleanDomain);
      if (exists) return { success: true, domain: cleanDomain };

      const customCreateQ = `
        mutation($input: CustomDomainCreateInput!) {
          customDomainCreate(input: $input) {
            id
            domain
          }
        }
      `;
      const customRes = await RailwayClient.executeGraphQL<{
        customDomainCreate?: { id: string; domain: string };
      }>(apiKey, customCreateQ, {
        input: { projectId, environmentId, serviceId, domain: cleanDomain }
      });
      if (customRes.data?.customDomainCreate) {
        return { success: true, domain: customRes.data.customDomainCreate.domain };
      }
      return {
        success: false,
        domain: cleanDomain,
        message: customRes.errors?.[0]?.message || 'Failed to create custom domain'
      };
    }
  }
}
