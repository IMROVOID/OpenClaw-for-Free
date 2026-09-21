import { RailwayClient } from './railwayClient.js';

export interface RailwayTargetContext {
  projectId: string;
  projectName: string;
  environmentId: string;
  serviceId: string;
  serviceName: string;
}

export class RailwayTargetResolver {
  static async resolveTargetContext(apiKey: string, targetDomain?: string): Promise<RailwayTargetContext | undefined> {
    const listQ = `
      query {
        projects {
          edges {
            node {
              id
              name
              environments { edges { node { id name } } }
              services { edges { node { id name } } }
            }
          }
        }
      }
    `;

    const res = await RailwayClient.executeGraphQL<{
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
    }>(apiKey, listQ, undefined, 6000);

    let projects = res.data?.projects?.edges?.map((e) => e.node) || [];

    // If targetDomain is specified, try to find a service that already has this domain attached
    if (targetDomain && projects.length > 0) {
      const cleanTarget = targetDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
      for (const p of projects) {
        const pEnvs = p.environments?.edges?.map((e) => e.node) || [];
        const pSvcs = p.services?.edges?.map((e) => e.node) || [];
        for (const e of pEnvs) {
          for (const s of pSvcs) {
            const domQ = `
              query($pid: String!, $eid: String!, $sid: String!) {
                domains(projectId: $pid, environmentId: $eid, serviceId: $sid) {
                  serviceDomains { domain }
                  customDomains { domain }
                }
              }
            `;
            const dRes = await RailwayClient.executeGraphQL<{
              domains?: {
                serviceDomains?: Array<{ domain: string }>;
                customDomains?: Array<{ domain: string }>;
              };
            }>(apiKey, domQ, { pid: p.id, eid: e.id, sid: s.id }, 3000);
            const allD = [
              ...(dRes.data?.domains?.serviceDomains?.map((d) => d.domain.toLowerCase()) || []),
              ...(dRes.data?.domains?.customDomains?.map((d) => d.domain.toLowerCase()) || [])
            ];
            if (allD.includes(cleanTarget)) {
              return {
                projectId: p.id,
                projectName: p.name,
                environmentId: e.id,
                serviceId: s.id,
                serviceName: s.name
              };
            }
          }
        }
      }
    }

    if (projects.length === 0) {
      // Safety guard: unverified accounts cannot create projects via API without payment method.
      // Attempting to do so triggers Railway's automated abuse/fraud restriction.
      const meQ = `query { me { isVerified } }`;
      const meRes = await RailwayClient.executeGraphQL<{ me?: { isVerified?: boolean } }>(apiKey, meQ);
      if (meRes.data?.me && meRes.data.me.isVerified === false) {
        return undefined;
      }

      const createProjQ = `
        mutation($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            name
            environments { edges { node { id name } } }
            services { edges { node { id name } } }
          }
        }
      `;
      const createRes = await RailwayClient.executeGraphQL<{
        projectCreate?: {
          id: string;
          name: string;
          environments?: { edges?: Array<{ node: { id: string; name: string } }> };
          services?: { edges?: Array<{ node: { id: string; name: string } }> };
        };
      }>(apiKey, createProjQ, { input: { name: 'OpenClaw-Relay' } }, 6000);

      if (createRes.data?.projectCreate) {
        projects = [createRes.data.projectCreate];
      }
    }

    if (projects.length === 0) return undefined;

    const targetProj =
      projects.find((p) => /openclaw/i.test(p.name) || /web-relay/i.test(p.name) || /relay/i.test(p.name)) || projects[0];

    const env =
      targetProj.environments?.edges?.find((e) => /prod/i.test(e.node.name))?.node ||
      targetProj.environments?.edges?.[0]?.node;

    if (!env) return undefined;

    // Prefer web-relay / openclaw-relay explicitly, excluding egress/gateway/xray/vless
    let svc =
      targetProj.services?.edges?.find((s) => /web-relay/i.test(s.node.name))?.node ||
      targetProj.services?.edges?.find((s) => /openclaw-relay/i.test(s.node.name))?.node ||
      targetProj.services?.edges?.find((s) => /relay/i.test(s.node.name) && !/egress|gateway|vless|xray/i.test(s.node.name))?.node ||
      targetProj.services?.edges?.find((s) => /relay/i.test(s.node.name))?.node;

    if (!svc) {
      const createSvcQ = `
        mutation($input: ServiceCreateInput!) {
          serviceCreate(input: $input) {
            id
            name
          }
        }
      `;
      const createSvcRes = await RailwayClient.executeGraphQL<{
        serviceCreate?: { id: string; name: string };
      }>(apiKey, createSvcQ, { input: { projectId: targetProj.id, name: 'web-relay' } }, 6000);

      if (createSvcRes.data?.serviceCreate) {
        svc = createSvcRes.data.serviceCreate;
      }
    }

    if (!svc) return undefined;

    return {
      projectId: targetProj.id,
      projectName: targetProj.name,
      environmentId: env.id,
      serviceId: svc.id,
      serviceName: svc.name
    };
  }

  static async upsertVariables(
    apiKey: string,
    target: RailwayTargetContext,
    variables: Record<string, string>
  ): Promise<boolean> {
    const varQ = `
      mutation($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `;

    const res = await RailwayClient.executeGraphQL(
      apiKey,
      varQ,
      {
        input: {
          projectId: target.projectId,
          environmentId: target.environmentId,
          serviceId: target.serviceId,
          variables
        }
      },
      6000
    );

    return Boolean(!res.errors || res.errors.length === 0);
  }
}
