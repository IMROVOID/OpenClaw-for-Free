import { ControlPanelConfig } from './types.js';
import { OnboardingIngressStep } from './onboardingIngressStep.js';
import { BackStepSignal } from './backSignal.js';
import { WebIngressDeployer } from './webIngressDeployer.js';

export async function configureAccess(
  config: ControlPanelConfig,
  ask: (question: string, defaultValue?: string) => Promise<string>,
  save: (config: ControlPanelConfig) => void,
  report: (message: string) => void
): Promise<void> {
  let ingress;
  try {
    ingress = await OnboardingIngressStep.promptIngress(ask, structuredClone(config));
  } catch (error) {
    if (!(error instanceof BackStepSignal)) throw error;
    report('Access settings unchanged.');
    return;
  }
  const updated = { ...config, ...ingress };
  updated.customOpenclawUrl = undefined;
  updated.customOmnirouteUrl = undefined;
  updated.customLlamaUrl = undefined;
  if (!ingress.domainedUrlsEnabled) updated.publicBaseDomain = undefined;
  save(updated);

  if (updated.domainedUrlsEnabled && updated.ingressProvider === 'railway' && updated.publicBaseDomain) {
    const rKey = (updated.railwayApiKey || config.railwayApiKey || '').trim();
    if (rKey) {
      report(`Deploying / Redeploying Railway Web Relay to ${updated.publicBaseDomain}...`);
      const deployRes = await WebIngressDeployer.deployRailwayWebRelay({
        apiKey: rKey,
        domain: updated.publicBaseDomain,
        primaryWorkspaceId: updated.daytonaPrimaryWorkspaceId || config.daytonaPrimaryWorkspaceId,
        secondaryWorkspaceId: updated.daytonaSecondaryWorkspaceId || config.daytonaSecondaryWorkspaceId,
        forceRedeploy: true
      });
      if (deployRes.success) {
        report(`Railway Web Relay deployed/redeployed successfully to ${updated.publicBaseDomain}!`);
      } else {
        report(`Railway Web Relay deployment notice: ${deployRes.message}`);
      }
      return;
    }
  }

  report('Access preferences saved.');
}
