import http from 'http';
import https from 'https';
import { URL } from 'url';
import { VpsProbe } from './vpsProbe.js';
import { EndpointResolver } from './endpointResolver.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { RailwayClient, RailwayRelayItem } from './railwayClient.js';
import { ansi } from '../tui/ansi.js';

export interface RailwayHealthCheck {
  reachable: boolean;
  statusCode?: number;
  message?: string;
}

export class RailwayHelper {
  static getApiKeyGuidance(): string[] {
    return [
      '1. Open your browser and navigate to: https://railway.com (or https://railway.app)',
      '2. Sign in and open Account Settings -> Tokens (https://railway.com/account/tokens)',
      '3. Click "New Token", give it a name (e.g. OpenClaw-Control)',
      '4. Copy the API token and paste it below (or press Enter to skip).'
    ];
  }

  static normalizeRelayUrl(input: string): string {
    const raw = (input || '').trim();
    if (!raw) return '';
    if (raw.includes('<your-llama-relay>')) return '';

    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        if (!u.hostname.includes('.')) {
          u.hostname = `${u.hostname}.up.railway.app`;
          return u.toString().replace(/\/+$/, '');
        }
        return raw.replace(/\/+$/, '');
      } catch {
        return raw.replace(/\/+$/, '');
      }
    }

    if (raw.includes('.')) {
      return `https://${raw.replace(/\/+$/, '')}`;
    }

    return `https://${raw}.up.railway.app`;
  }

  static async validateApiKey(apiKey: string): Promise<{ valid: boolean; user?: string; error?: string }> {
    return RailwayClient.validateApiKey(apiKey);
  }

  static isEgressRelayCandidate(relay: RailwayRelayItem): boolean {
    const haystack = `${relay.serviceName} ${relay.projectName} ${relay.domain}`.toLowerCase();
    return haystack.includes('egress') || haystack.includes('gateway-relay') || haystack.includes('gateway relay');
  }

  static isWebRelayCandidate(relay: RailwayRelayItem): boolean {
    if (relay.isLlama || RailwayHelper.isEgressRelayCandidate(relay)) return false;
    const haystack = `${relay.serviceName} ${relay.domain}`.toLowerCase();
    return haystack.includes('web-relay') || haystack.includes('web relay');
  }

  static findWebRelay(relays: RailwayRelayItem[]): RailwayRelayItem | undefined {
    const nonEgress = relays.filter((relay) => !RailwayHelper.isEgressRelayCandidate(relay));
    return nonEgress.find((relay) => RailwayHelper.isWebRelayCandidate(relay))
      ?? nonEgress.find((relay) => !relay.isLlama)
      ?? nonEgress[0];
  }

  static async promptWebRelayApiKey(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    existingKey?: string
  ): Promise<{ apiKey?: string; suggestedDomain?: string }> {
    for (const line of this.getApiKeyGuidance()) {
      console.log(`  ${ansi.dim}${line}${ansi.reset}`);
    }
    const currentKey = (existingKey || '').trim();
    let apiKey = currentKey;
    if (currentKey) {
      const masked = currentKey.slice(0, 4) + '••••••••' + currentKey.slice(-4);
      console.log(`  ${ansi.cyan}Saved Railway API token found: ${ansi.brightYellow}${masked}${ansi.reset}`);
      const reuse = await askFn('Use saved Railway API token? (Y/n, or 0 to go back)', 'Y');
      if (isBackInput(reuse)) throw new BackStepSignal();
      if (reuse.trim().toLowerCase() === 'n') {
        const entered = await askFn('Railway API token (0 goes back)', '');
        if (isBackInput(entered)) throw new BackStepSignal();
        apiKey = (entered || '').trim();
      }
    } else {
      const entered = await askFn(
        'Railway API token (required for connected-domain default, 0 goes back)',
        ''
      );
      if (isBackInput(entered)) throw new BackStepSignal();
      apiKey = (entered || '').trim();
    }
    if (!apiKey) {
      throw new Error('A Railway API token is required before entering the Web Relay domain.');
    }

    process.stdout.write('  Verifying Railway API token & fetching Web Relay domains... ');
    const [validation, relays] = await Promise.all([
      this.validateApiKey(apiKey),
      RailwayClient.listExistingRelays(apiKey)
    ]);
    if (!validation.valid) {
      console.log(`${ansi.red}[Invalid Railway API token]${ansi.reset}`);
      throw new Error(validation.error || 'Invalid Railway API token.');
    }
    console.log(`${ansi.green}[OK: Verified${validation.user ? ` (${validation.user})` : ''}]${ansi.reset}`);

    const webRelay = RailwayHelper.findWebRelay(relays);
    return { apiKey, suggestedDomain: webRelay?.domain };
  }

  static async checkRelayDomain(domainOrUrl: string, timeoutMs = 5000, probePath?: string): Promise<RailwayHealthCheck> {
    const raw = (domainOrUrl || '').trim();
    if (!raw) return { reachable: false, message: 'No URL specified' };
    if (/egress/i.test(raw)) {
      return { reachable: false, message: 'Egress relay domains do not serve the WebUI; use the Web Relay domain' };
    }

    let target = this.normalizeRelayUrl(raw) || (raw.startsWith('http') ? raw : `https://${raw}`);
    if (probePath) {
      const cleanPath = probePath.startsWith('/') ? probePath : `/${probePath}`;
      try {
        const u = new URL(target);
        if (!u.pathname || u.pathname === '/') {
          u.pathname = cleanPath;
          target = u.toString();
        }
      } catch (_) {
        target = `${target.replace(/\/+$/, '')}${cleanPath}`;
      }
    }

    return new Promise((resolve) => {
      try {
        const u = new URL(target);
        const transport = u.protocol === 'http:' ? http : https;
        const req = transport.get(u, { timeout: timeoutMs }, (res) => {
          const isUp = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 400);
          let message = `HTTP ${res.statusCode}`;
          if (res.statusCode === 404) {
            message = 'HTTP 404 (Not deployed or route not found on Railway)';
          } else if (res.statusCode && res.statusCode >= 500) {
            message = `HTTP ${res.statusCode} (Upstream service unavailable)`;
          }
          resolve({
            reachable: isUp,
            statusCode: res.statusCode,
            message
          });
        });

        req.on('error', (err) => {
          resolve({ reachable: false, message: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ reachable: false, message: 'Connection timed out' });
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve({ reachable: false, message: msg });
      }
    });
  }

  static async testVpsEgressTunnel(targetSsh: string, httpProxyPort = 10808): Promise<{ active: boolean; response?: string }> {
    const cmd = `curl -s -m 6 -x "http://127.0.0.1:${httpProxyPort}" -I https://gateway.discord.gg 2>&1 | head -n 1`;
    const res = await VpsProbe.execRemote(targetSsh, cmd, 8);

    if (res.code === 0 && res.stdout.includes('HTTP/')) {
      return { active: true, response: res.stdout.trim() };
    }
    return { active: false, response: res.stderr || res.stdout.trim() || 'No response through tunnel' };
  }

  static async testLlamaRelayEndpoint(endpointUrl: string): Promise<RailwayHealthCheck> {
    const healthUrl = `${endpointUrl.replace(/\/+$/, '')}/health`;
    return this.checkRelayDomain(healthUrl, 6000);
  }

  static generateEgressSetupCommand(railwayDomain: string, relayUuid: string, relayPath = '/api/v1/relay-stream'): string {
    return `bash /home/daytona/setup_daytona_relay.sh "${railwayDomain}" "${relayUuid}" "${relayPath}"`;
  }

  /**
   * Interactive Railway Relay Configuration Step for Daytona Cloud
   */
  static async promptLlamaRelay(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    existingDefaults?: { railwayEndpointUrl?: string; railwayApiKey?: string }
  ): Promise<{ railwayEndpointUrl?: string; activeEndpointUrl?: string; railwayApiKey?: string }> {
    console.log(`\n${ansi.cyan}[Step 5c] Railway Egress & Llama Relay Configuration${ansi.reset}`);
    console.log(`  • Daytona Cloud isolates sandboxes without direct public ingress.`);
    console.log(`  • A Railway Relay acts as a reverse proxy for OpenClaw to reach the Secondary LLaMA VM.\n`);

    // 1. Prompt for Railway API Key
    console.log(`${ansi.cyan}Railway API Key Setup (Optional):${ansi.reset}`);
    for (const line of this.getApiKeyGuidance()) {
      console.log(`  ${ansi.dim}${line}${ansi.reset}`);
    }

    const currentKey = existingDefaults?.railwayApiKey || '';
    const keyPrompt = currentKey
      ? `Railway API Key (or Enter to keep existing, 0 to go back)`
      : `Railway API Key (or press Enter to skip, 0 to go back)`;
    const enteredKey = await askFn(keyPrompt, currentKey);
    if (isBackInput(enteredKey)) throw new BackStepSignal();

    const finalKey = enteredKey.trim() || currentKey;
    let existingRelays: RailwayRelayItem[] = [];

    if (finalKey) {
      process.stdout.write('  Verifying Railway API token & fetching relays... ');
      const [val, relays] = await Promise.all([
        this.validateApiKey(finalKey),
        RailwayClient.listExistingRelays(finalKey)
      ]);
      existingRelays = relays;
      if (val.valid && !val.error) {
        console.log(`${ansi.green}[OK: Verified${val.user ? ` (${val.user})` : ''}]${ansi.reset}`);
      } else if (val.error) {
        console.log(`${ansi.dim}[${val.error}]${ansi.reset}`);
      }
    }

    let activeRelayUrl = '';
    const rawDefault = existingDefaults?.railwayEndpointUrl || '';
    const cleanDefault = rawDefault.includes('<your-llama-relay>') ? '' : rawDefault;

    // 2. Relay selection or manual entry
    if (existingRelays.length > 0) {
      console.log(`\n${ansi.cyan}Choose Railway Relay Option:${ansi.reset}`);
      console.log(`  1. Select Existing Relay from Railway Account [Recommended]`);
      console.log(`  2. Enter Custom Relay URL or Subdomain`);
      console.log(`  3. Skip Relay Configuration`);
      console.log(`  0. Back (or ESC)\n`);

      const opt = await askFn('Select option (1-3, or 0 to go back)', '1');
      if (isBackInput(opt)) throw new BackStepSignal();

      if (opt === '1') {
        console.log(`\nAvailable Relays in your Railway account:`);
        existingRelays.forEach((r, i) => {
          const tags: string[] = [];
          if (r.isLlama) tags.push(`${ansi.green}[LLaMA Relay]${ansi.reset}`);
          if (RailwayHelper.isEgressRelayCandidate(r)) tags.push(`${ansi.yellow}[Egress Relay: no WebUI]${ansi.reset}`);
          console.log(`  ${i + 1}. ${ansi.brightYellow}${r.serviceName}${ansi.reset} (${r.fullUrl}) [${r.projectName}]${tags.join(' ')}`);
        });
        console.log(`  0. Back\n`);

        const selIdxStr = await askFn('Select Relay number (or 0 to go back)', '1');
        if (isBackInput(selIdxStr)) throw new BackStepSignal();
        const selIdx = parseInt(selIdxStr, 10) - 1;
        const chosen = existingRelays[selIdx] || existingRelays[0];

        if (RailwayHelper.isEgressRelayCandidate(chosen)) {
          console.log(`${ansi.yellow}[WARN: ${chosen.serviceName} is an Egress Relay and never serves a WebUI (404). Pick the web-relay service instead.]${ansi.reset}`);
        }
        process.stdout.write(`  Checking relay reachability (${chosen.fullUrl})... `);
        const check = await this.checkRelayDomain(chosen.fullUrl, 4000);
        if (check.reachable) {
          console.log(`${ansi.green}[OK: Reachable (${check.message})]${ansi.reset}`);
        } else {
          console.log(`${ansi.yellow}[WARN: ${check.message}] (Continuing with selected relay)${ansi.reset}`);
        }
        activeRelayUrl = chosen.fullUrl;
      } else if (opt === '3') {
        console.log(`  ${ansi.dim}[Skipped Relay URL configuration]${ansi.reset}`);
      }
    }

    // 3. Fallback to manual entry if no existing relay chosen yet and not skipped
    if (!activeRelayUrl && existingRelays.length === 0) {
      console.log(`\n${ansi.cyan}Railway Llama Relay Endpoint (Optional):${ansi.reset}`);
      console.log(`  • Enter full URL:  ${ansi.yellow}https://<your-relay>.up.railway.app${ansi.reset}`);
      console.log(`  • Or subdomain:    ${ansi.yellow}<your-relay>${ansi.reset}`);

      while (true) {
        const urlPrompt = cleanDefault
          ? `Railway Llama Relay URL / Subdomain (or Enter to keep, 0 to go back)`
          : `Railway Llama Relay URL / Subdomain (or Enter to skip, 0 to go back)`;
        const enteredUrl = await askFn(urlPrompt, cleanDefault);
        if (isBackInput(enteredUrl)) throw new BackStepSignal();

        const candidate = (enteredUrl.trim() || cleanDefault).trim();
        if (!candidate) {
          console.log(`  ${ansi.dim}[Skipped Relay URL configuration]${ansi.reset}`);
          break;
        }

        const normalized = this.normalizeRelayUrl(candidate);
        if (!normalized) {
          console.log(`  ${ansi.dim}[Skipped Relay URL configuration]${ansi.reset}`);
          break;
        }

        process.stdout.write(`  Checking relay reachability (${normalized})... `);
        const check = await this.checkRelayDomain(normalized, 4000);
        if (check.reachable) {
          console.log(`${ansi.green}[OK: Reachable (${check.message})]${ansi.reset}`);
          activeRelayUrl = normalized;
          break;
        } else {
          console.log(`${ansi.yellow}[WARN: Not reachable - ${check.message}]${ansi.reset}`);
          console.log(`  Make sure the Railway relay service is deployed and running.`);
          const proceed = await askFn(`  Use "${normalized}" anyway? (Y/n, or 0 to go back)`, 'Y');
          if (isBackInput(proceed)) throw new BackStepSignal();
          if (proceed.toLowerCase() === 'y') {
            activeRelayUrl = normalized;
            break;
          }
        }
      }
    }

    const normV1 = activeRelayUrl ? EndpointResolver.normalizeV1Url(activeRelayUrl) : '';
    return {
      railwayApiKey: finalKey || undefined,
      railwayEndpointUrl: activeRelayUrl || undefined,
      activeEndpointUrl: normV1 || undefined
    };
  }
}
