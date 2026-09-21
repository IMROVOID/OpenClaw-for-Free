import { DetectedVmConfig, VpsSpecs } from './types.js';
import { ansi } from '../tui/ansi.js';

export class ServiceDiscoveryFormatter {
  /**
   * Render a visual summary of detected services on a remote VPS
   */
  static printSummary(config: DetectedVmConfig, specs?: VpsSpecs, targetLabel = 'Primary VM'): void {
    console.log(`\n${ansi.cyan}=== Service & Hardware Discovery on ${targetLabel} ===${ansi.reset}`);

    if (specs) {
      console.log(`  • Hardware Specs   : ${ansi.green}[OK: ${specs.cpuCores} vCPU, ${specs.ramGb} GB RAM, ${specs.storageGb} GB Storage]${ansi.reset}`);
    }

    // 1. OpenClaw
    if (config.openclawInstalled) {
      const bots: string[] = [];
      if (config.telegramBotToken) bots.push(`Telegram: ${config.telegramBotToken.slice(0, 10)}...`);
      if (config.discordBotToken) bots.push(`Discord: ${config.discordBotToken.slice(0, 10)}...`);
      const botsStr = bots.length > 0 ? ` (${bots.join(', ')})` : ' (No bots configured)';
      const ocTokenStr = config.openclawToken ? ` [Token: ${config.openclawToken.slice(0, 10)}...]` : '';
      console.log(`  • OpenClaw Runtime : ${ansi.green}[INSTALLED]${ansi.reset}${ocTokenStr}${botsStr}`);
    } else {
      console.log(`  • OpenClaw Runtime : ${ansi.dim}[Not installed — fresh VM]${ansi.reset}`);
    }

    // 2. OmniRoute
    if (config.omnirouteActive) {
      console.log(`  • OmniRoute Gateway: ${ansi.green}[ACTIVE & RUNNING]${ansi.reset} (Port 20128)`);
    } else if (config.omnirouteInstalled) {
      console.log(`  • OmniRoute Gateway: ${ansi.yellow}[INSTALLED]${ansi.reset} (Service stopped)`);
    } else {
      console.log(`  • OmniRoute Gateway: ${ansi.dim}[Not installed]${ansi.reset}`);
    }

    // 3. Egress Relay
    if (config.railwayRelayConfigured) {
      const dom = config.railwayDomain ? ` (${config.railwayDomain})` : '';
      console.log(`  • Egress Relay     : ${ansi.green}[CONFIGURED]${ansi.reset}${dom}`);
    } else {
      console.log(`  • Egress Relay     : ${ansi.dim}[Direct egress / None]${ansi.reset}`);
    }

    // 4. Local LLM
    if (config.llamaInstalled || config.llamaRunning) {
      const top = config.llamaTopology === 'second_vm' ? 'Dedicated Second VM' : 'Same VM';
      const state = config.llamaRunning ? `${ansi.green}[RUNNING]${ansi.reset}` : `${ansi.yellow}[INSTALLED]${ansi.reset}`;
      const mod = config.llamaModel ? ` [Model: ${config.llamaModel}]` : '';
      console.log(`  • Local LLM Server : ${state} (${top})${mod}`);
    } else {
      console.log(`  • Local LLM Server : ${ansi.dim}[Not installed]${ansi.reset}`);
    }

    console.log();
  }
}
