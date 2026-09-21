import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VpsProbe } from './vpsProbe.js';
import { RailwayHelper } from './railwayHelper.js';
import { RailwayClient } from './railwayClient.js';
import { RailwaySafetyGuard } from './railwaySafetyGuard.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { ansi } from '../tui/ansi.js';

import { EMBEDDED_DAYTONA_RELAY_SCRIPT } from './relayScriptConstant.js';

const getDirname = (): string => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

export class RelayDeployer {
  /**
   * Load setup_daytona_relay.sh script content
   */
  static getRelayScript(): string {
    const currentDir = getDirname();
    const localPaths = [
      path.resolve(process.cwd(), 'scripts', 'setup_daytona_relay.sh'),
      path.resolve(currentDir, '..', '..', '..', 'scripts', 'setup_daytona_relay.sh'),
      path.resolve(currentDir, 'scripts', 'setup_daytona_relay.sh')
    ];

    for (const p of localPaths) {
      if (fs.existsSync(p)) {
        try {
          return fs.readFileSync(p, 'utf-8');
        } catch (_) {}
      }
    }
    return EMBEDDED_DAYTONA_RELAY_SCRIPT;
  }

  /**
   * Interactive prompt for Daytona Egress Relay configuration
   */
  static async promptEgressRelay(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    defaults?: { railwayDomain?: string; railwayUuid?: string },
    apiKey?: string
  ): Promise<{ railwayDomain?: string; railwayUuid?: string }> {
    console.log(`\n${ansi.cyan}[Daytona Cloud] Egress Relay Configuration${ansi.reset}`);
    console.log(`  • Daytona blocks direct outbound connections to the internet.`);
    console.log(`  • An egress relay (Railway VLESS/WS) is required for Telegram, Discord, and AI APIs.\n`);

    const cleanKey = (apiKey || '').trim();
    let discoveredDomain: string | undefined;

    if (cleanKey) {
      try {
        const safety = RailwaySafetyGuard.isRestricted(cleanKey);
        if (!safety.restricted) {
          process.stdout.write('  Discovering existing Gateway/Egress relays from Railway... ');
          const relays = await RailwayClient.listExistingRelays(cleanKey);
          const egress = relays.filter((r) => RailwayHelper.isEgressRelayCandidate(r));
          if (egress.length > 0) {
            console.log(`${ansi.green}[Found ${egress.length}]${ansi.reset}`);
            console.log(`\nDiscovered Egress Relays in your Railway account:`);
            egress.forEach((r, idx) => {
              console.log(`  ${idx + 1}. ${ansi.brightYellow}${r.serviceName}${ansi.reset} (${r.domain || r.fullUrl}) [${r.projectName}]`);
            });
            console.log(`  0. Custom domain or default\n`);

            const pick = await askFn('Select relay number (or 0 for custom)', '1');
            if (isBackInput(pick)) throw new BackStepSignal();
            const pickIdx = parseInt(pick, 10) - 1;
            if (pickIdx >= 0 && egress[pickIdx]) {
              discoveredDomain = egress[pickIdx].domain || egress[pickIdx].fullUrl;
            }
          } else {
            console.log(`${ansi.dim}[None detected]${ansi.reset}`);
          }
        }
      } catch (_) {}
    }

    const defDom = discoveredDomain || defaults?.railwayDomain || 'egress-relay-production.up.railway.app';
    const defUuid = defaults?.railwayUuid || 'd4b8e21a-79f1-4320-a612-4c5386f91f7a';

    let cleanDom = discoveredDomain;
    if (!cleanDom) {
      const domPrompt = `Railway Egress Relay Domain (or Enter for default, 0 to go back)`;
      const enteredDom = await askFn(domPrompt, defDom);
      if (isBackInput(enteredDom)) throw new BackStepSignal();
      cleanDom = (enteredDom.trim() || defDom).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    const uuidPrompt = `Railway Egress Relay Client UUID (or Enter for default, 0 to go back)`;
    const enteredUuid = await askFn(uuidPrompt, defUuid);
    if (isBackInput(enteredUuid)) throw new BackStepSignal();
    const cleanUuid = enteredUuid.trim() || defUuid;

    return { railwayDomain: cleanDom, railwayUuid: cleanUuid };
  }

  /**
   * Deploy Xray client and configure OpenClaw/OmniRoute proxy on Daytona VM
   */
  static async deployEgressRelay(
    primaryTarget: string,
    railwayDomain: string,
    relayUuid: string,
    relayPath = '/api/v1/relay-stream'
  ): Promise<boolean> {
    if (!primaryTarget || !railwayDomain || !relayUuid) return false;

    const scriptContent = this.getRelayScript();
    if (!scriptContent) {
      console.log(`  ${ansi.yellow}[WARN: scripts/setup_daytona_relay.sh not found]${ansi.reset}`);
      return false;
    }

    const cleanDomain = railwayDomain.trim().replace(/[^a-zA-Z0-9.-]/g, '');
    const cleanUuid = relayUuid.trim().replace(/[^a-fA-F0-9-]/g, '');
    const cleanPath = (relayPath.trim() || '/api/v1/relay-stream').replace(/[^a-zA-Z0-9/_-]/g, '');
    if (!cleanDomain || !cleanUuid) return false;

    process.stdout.write(`    Deploying Xray egress relay (${cleanDomain})... `);
    const cmd = `bash -s -- '${cleanDomain}' '${cleanUuid}' '${cleanPath}'`;
    const res = await VpsProbe.execRemoteWithStdin(primaryTarget, cmd, scriptContent, 120);

    if (res.code === 0) {
      console.log(`${ansi.green}[OK]${ansi.reset}`);
      process.stdout.write(`    Testing egress reachability through relay... `);
      const test = await RailwayHelper.testVpsEgressTunnel(primaryTarget);
      if (test.active) {
        console.log(`${ansi.green}[OK: Active]${ansi.reset}`);
        return true;
      } else {
        console.log(`${ansi.yellow}[WARN: Tunnel starting up]${ansi.reset}`);
        return true;
      }
    } else {
      console.log(`${ansi.yellow}[WARN: Exit ${res.code}]${ansi.reset}`);
      return false;
    }
  }
}
