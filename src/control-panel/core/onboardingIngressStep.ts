import { ControlPanelConfig } from './types.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { RailwayHelper } from './railwayHelper.js';
import { RailwayDomainManager } from './railwayDomainManager.js';
import { ansi } from '../tui/ansi.js';

export interface IngressStepResult {
  domainedUrlsEnabled: boolean;
  ingressProvider: 'railway' | 'freestyle' | 'none';
  publicBaseDomain?: string;
  railwayApiKey?: string;
}

export class OnboardingIngressStep {
  /**
   * Prompts user to choose between local SSH Port Forwarding and Permanent Domained URLs.
   */
  static async promptIngress(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    config: ControlPanelConfig
  ): Promise<IngressStepResult> {
    console.log(`\n${ansi.cyan}[Ingress & Web UI Access Mode]${ansi.reset}`);
    console.log(`Select how you want to access OpenClaw, OmniRoute, and LLaMA Web Interfaces:\n`);
    console.log(`  1. Permanent Domained URLs (Recommended — direct browser/mobile access, no port forwarding) [Default]`);
    console.log(`  2. Local SSH Port Forwarding (Secure local loopback tunnels only)`);
    console.log(`  0. Back\n`);

    const choice = await askFn('Select Ingress Mode (1-2, or 0 to go back)', '1');
    if (isBackInput(choice)) {
      throw new BackStepSignal();
    }

    if (choice === '2') {
      console.log(`  ${ansi.green}[OK: Local SSH Port Forwarding configured]${ansi.reset}`);
      return {
        domainedUrlsEnabled: false,
        ingressProvider: 'none'
      };
    }

    // User selected Domained URLs (default)
    return this.configureDomainedIngress(askFn, config);
  }

  private static async configureDomainedIngress(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    config: ControlPanelConfig
  ): Promise<IngressStepResult> {
    if (config.provider === 'freestyle') {
      console.log(`\n${ansi.cyan}Select Domain Ingress Provider for FreeStyle:${ansi.reset}`);
      console.log(`  1. FreeStyle Native Domain (https://<slug>.style.dev - Built-in TLS, 0% Railway) [Default]`);
      console.log(`  2. Railway Web Relay (Host on Railway using relay/railway-web-relay)`);
      console.log(`  3. Custom Domain (e.g. https://openclaw.yourdomain.com)`);
      console.log(`  0. Back\n`);

      const domChoice = await askFn('Select Domain Provider (1-3, or 0 to go back)', '1');
      if (isBackInput(domChoice)) {
        throw new BackStepSignal();
      }

      if (domChoice === '2') {
        const relayDomain = await this.promptRailwayDomain(askFn, config.publicBaseDomain, config);
        return {
          domainedUrlsEnabled: true,
          ingressProvider: 'railway',
          publicBaseDomain: relayDomain,
          railwayApiKey: config.railwayApiKey
        };
      }

      if (domChoice === '3') {
        const customDomain = await this.promptCustomDomain(askFn, config.publicBaseDomain);
        return {
          domainedUrlsEnabled: true,
          ingressProvider: 'freestyle',
          publicBaseDomain: customDomain
        };
      }

      // Default: FreeStyle Native
      const defaultDomain = config.freestylePrimarySlug
        ? `https://${config.freestylePrimarySlug}.style.dev`
        : (config.publicBaseDomain || 'https://openclaw.style.dev');

      const entered = await askFn(`FreeStyle Public Base Domain (or Enter for default, 0 to go back)`, defaultDomain);
      if (isBackInput(entered)) {
        throw new BackStepSignal();
      }
      return {
        domainedUrlsEnabled: true,
        ingressProvider: 'freestyle',
        publicBaseDomain: this.normalizeUrl(entered || defaultDomain)
      };
    }

    // Daytona provider: Railway Web Relay is required
    console.log(`\n${ansi.yellow}[Daytona Notice] Daytona VMs have no public IP and block direct ingress ports.${ansi.reset}`);
    console.log(`A Railway Web Relay (${ansi.bold}relay/railway-web-relay${ansi.reset}) is REQUIRED to host permanent URLs.\n`);

    const relayDomain = await this.promptRailwayDomain(askFn, config.publicBaseDomain, config);
    return {
      domainedUrlsEnabled: true,
      ingressProvider: 'railway',
      publicBaseDomain: relayDomain,
      railwayApiKey: config.railwayApiKey
    };
  }

  private static async promptRailwayDomain(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    current?: string,
    config?: ControlPanelConfig
  ): Promise<string> {
    const relay = await RailwayHelper.promptWebRelayApiKey(askFn, config?.railwayApiKey);
    if (config && relay.apiKey !== undefined) config.railwayApiKey = relay.apiKey;
    const fallback = current || relay.suggestedDomain || '';
    console.log('Enter the Web Relay subdomain or full HTTPS hostname (e.g. "web-relay" or "web-relay.up.railway.app").');
    console.log('The script will verify availability and configure the unified web-relay service.');
    while (true) {
      const entered = await askFn('Railway Web Relay subdomain / domain (or 0 to go back)', fallback);
      if (isBackInput(entered)) throw new BackStepSignal();
      const value = (entered || current || '').trim();
      const domain = RailwayDomainManager.normalizeDomain(value);
      if (!domain) {
        console.log('Enter a valid subdomain or HTTPS hostname without special characters.');
        continue;
      }
      if (/egress/i.test(domain)) {
        console.log(`${ansi.yellow}[WARN: Egress relay domains do not serve the WebUI (returns 404). Use the Web Relay domain or deploy relay/railway-web-relay.]${ansi.reset}`);
        continue;
      }

      const currentDomain = RailwayDomainManager.normalizeDomain(current || config?.publicBaseDomain);
      const isCurrentDomain = Boolean(currentDomain && domain === currentDomain);

      if (config?.railwayApiKey) {
        process.stdout.write(`  Checking domain availability (${domain})... `);
        const avail = await RailwayDomainManager.checkDomainAvailability(config.railwayApiKey, domain);
        if (avail.isOccupied && !isCurrentDomain && !avail.isUserOwned) {
          console.log(`${ansi.yellow}[Occupied]${ansi.reset}`);
          console.log(`  Domain "${domain}" is registered on Railway.`);
          const redeployAns = await askFn('  Is this your existing domain you wish to redeploy to? (Y/n, or 0 to go back)', 'Y');
          if (isBackInput(redeployAns)) throw new BackStepSignal();
          if (redeployAns.toLowerCase() !== 'y') {
            const recs = await RailwayDomainManager.getAvailableRecommendations(config.railwayApiKey, domain, 3);
            if (recs.length > 0) {
              console.log(`  ${ansi.cyan}Recommended free alternatives:${ansi.reset}`);
              recs.forEach((r, idx) => console.log(`    ${idx + 1}. ${r}`));
              const choice = await askFn('  Select recommendation (1-3) or press Enter to try another subdomain', '1');
              if (isBackInput(choice)) throw new BackStepSignal();
              const choiceNum = parseInt(choice, 10);
              if (choiceNum >= 1 && choiceNum <= recs.length) {
                const chosen = recs[choiceNum - 1];
                console.log(`  ${ansi.green}[Selected: ${chosen}]${ansi.reset}`);
                return chosen;
              }
            }
            continue;
          }
          console.log(`  ${ansi.green}[Confirmed: Redeploying to existing domain ${domain}]${ansi.reset}`);
          return domain;
        } else if (isCurrentDomain || avail.isUserOwned) {
          console.log(`${ansi.green}[Available (Current/Owned Domain)]${ansi.reset}`);
        } else {
          console.log(`${ansi.green}[Available]${ansi.reset}`);
        }
      }

      process.stdout.write(`  Checking Web Relay reachability (${domain})... `);
      const check = await RailwayHelper.checkRelayDomain(domain, 4000);
      if (check.reachable) {
        console.log(`${ansi.green}[OK: Reachable (${check.message})]${ansi.reset}`);
      } else {
        console.log(`${ansi.yellow}[WARN: ${check.message}] (Continuing with entered domain)${ansi.reset}`);
      }
      return domain;
    }
  }

  private static async promptCustomDomain(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    current?: string
  ): Promise<string> {
    const defaultDomain = current || 'https://openclaw.example.com';
    const entered = await askFn('Custom Base URL (e.g. https://mybot.com, 0 to go back)', defaultDomain);
    if (isBackInput(entered)) {
      throw new BackStepSignal();
    }
    return this.normalizeUrl(entered || defaultDomain);
  }

  private static normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return `https://${trimmed}`.replace(/\/+$/, '');
    }
    return trimmed.replace(/\/+$/, '');
  }
}
