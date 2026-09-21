import { ControlPanelConfig, CloudProviderType } from './types.js';
import { VpsSetupWizard } from './vpsSetupWizard.js';
import { VmSshAutoRenewer } from './vmSshAutoRenewer.js';
import { ConfigManager } from './configManager.js';
import { isBackInput } from './backSignal.js';
import { ansi } from '../tui/ansi.js';

export class OnboardingExistingLlama {
  /**
   * Try to auto-reconnect to Secondary VM via stored API key. Returns true if renewed and connected.
   */
  static async autoConnectSecondaryVm(config: ControlPanelConfig): Promise<boolean> {
    const secProv = config.secondaryProvider || config.provider;
    const secApiKey = secProv === 'freestyle'
      ? config.secondaryFreestyleApiKey
      : config.secondaryDaytonaApiKey;

    if (!secApiKey) return false;

    process.stdout.write(`\nAttempting auto-connection to Secondary VM using stored API key... `);
    const renewRes = await VmSshAutoRenewer.refreshSecondaryVmSsh(config);
    if (renewRes.renewed && config.secondarySshTarget) {
      console.log(`${ansi.green}[OK: Connected to ${config.secondarySshTarget}]${ansi.reset}`);
      return true;
    }
    console.log(`${ansi.yellow}[Could not auto-connect: ${renewRes.error || 'VM not found'}]${ansi.reset}`);
    return false;
  }

  /**
   * Prompt user for Secondary VM connection when existing Llama was detected on a separate VM.
   * If a valid API key is already stored, auto-reconnects without prompting.
   * Returns false if user chose to go back (0 or ESC), true if completed or skipped.
   */
  static async promptSecondaryConnection(
    ask: (q: string, d?: string, b?: boolean) => Promise<string>,
    config: ControlPanelConfig,
    vpsWizard: VpsSetupWizard,
    endpoint?: string
  ): Promise<boolean> {
    const autoConnected = await this.autoConnectSecondaryVm(config);
    if (autoConnected) {
      return true;
    }

    console.log(`\n${ansi.cyan}[Secondary VM Connection]${ansi.reset}`);
    console.log(`Llama is running on a dedicated separate VM (${endpoint || 'Remote Endpoint'}).`);
    console.log(`To enable local port forwarding (port 8080) and Control Panel terminal management,`);
    console.log(`the Secondary VM connection / SSH target is needed.`);
    console.log(`  1. Connect via Cloud API Key (Freestyle / Daytona) [Default]`);
    console.log(`  2. Enter Direct SSH Target (e.g. ssh user@host or alias)`);
    console.log(`  3. Skip SSH connection (Keep endpoint-only remote relay)`);
    console.log(`  0. Back (or ESC)\n`);

    const connChoice = await ask('Select option (1-3, or 0 to go back)', '1', true);
    if (isBackInput(connChoice) || connChoice === '0') {
      return false;
    }

    if (connChoice === '1') {
      const defaultSecProv: CloudProviderType = (endpoint && endpoint.includes('.style.dev'))
        ? 'freestyle'
        : ((endpoint && endpoint.includes('railway')) ? 'daytona' : config.provider);

      const secRes = await vpsWizard.setupSecondaryVm(
        defaultSecProv,
        config.secondaryFreestyleApiKey || config.freestyleApiKey,
        config.secondaryDaytonaApiKey || config.daytonaApiKey
      );

      config.secondaryProvider = secRes.provider;
      if (secRes.provider === 'freestyle' && secRes.apiKey) {
        config.secondaryFreestyleApiKey = secRes.apiKey;
        if (!config.freestyleApiKey) config.freestyleApiKey = secRes.apiKey;
      } else if (secRes.provider === 'daytona' && secRes.apiKey) {
        config.secondaryDaytonaApiKey = secRes.apiKey;
        if (!config.daytonaApiKey) config.daytonaApiKey = secRes.apiKey;
      }

      config.secondarySshTarget = secRes.secondarySshTarget;
      config.llama.sshTarget = secRes.secondarySshTarget;
      if (secRes.secondarySshTarget.includes(':')) {
        config.freestyleLlamaSlug = secRes.secondarySshTarget.split(':')[0].replace(/^ssh\s+/i, '').trim();
      }
      if (secRes.secondaryWorkspaceId) {
        if (secRes.provider === 'daytona') {
          config.daytonaSecondaryWorkspaceId = secRes.secondaryWorkspaceId;
        } else {
          config.freestyleSecondaryVmId = secRes.secondaryWorkspaceId;
        }
      }
      if (secRes.secondarySlug) config.freestyleLlamaSlug = secRes.secondarySlug;
      ConfigManager.save(config);
    } else if (connChoice === '2') {
      const directTarget = await ask('Enter Secondary VM SSH target (e.g. user@hostname or ssh config alias)');
      if (directTarget.trim()) {
        const parsed = ConfigManager.parseSshTarget(directTarget.trim(), directTarget.trim(), config.secondaryProvider || config.provider);
        config.secondarySshTarget = parsed;
        config.llama.sshTarget = parsed;
        ConfigManager.save(config);
      }
    }

    return true;
  }
}
