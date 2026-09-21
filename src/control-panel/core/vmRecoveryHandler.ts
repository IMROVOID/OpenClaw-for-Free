import readline from 'readline';
import { ControlPanelConfig, InstallationState, MissingVmType } from './types.js';
import { ConfigManager } from './configManager.js';
import { VpsSetupWizard } from './vpsSetupWizard.js';
import { OnboardingSteps } from './onboardingSteps.js';
import { OnboardingRunner } from './onboardingRunner.js';
import { VpsDetector } from './vpsDetector.js';
import { VpsConfigDetector } from './vpsConfigDetector.js';
import { ServiceDiscoveryFormatter } from './serviceDiscoveryFormatter.js';
import { VpsProbe } from './vpsProbe.js';
import { OmnirouteSync } from './omnirouteSync.js';
import { EndpointResolver } from './endpointResolver.js';
import { RailwayHelper } from './railwayHelper.js';
import { isBackInput } from './backSignal.js';
import { ansi } from '../tui/ansi.js';

export class VmRecoveryHandler {
  private static ask(rl: readline.Interface, question: string, defaultValue = ''): Promise<string> {
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      rl.question(prompt, (ans) => {
        const clean = ans.trim();
        resolve(clean || defaultValue);
      });
    });
  }

  static async promptRecovery(config: ControlPanelConfig, state: InstallationState): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const missing = state.missingVmType || 'primary';

    console.clear();
    console.log(`\n${ansi.red}====================================================${ansi.reset}`);
    console.log(`  ${ansi.bold}Virtual Machine Availability Issue Detected${ansi.reset}`);
    console.log(`${ansi.red}====================================================${ansi.reset}\n`);

    const primaryStatus = state.primaryReachable ? `${ansi.green}[ONLINE]${ansi.reset}` : `${ansi.red}[UNREACHABLE]${ansi.reset}`;
    console.log(`  • Primary VM   (${config.primarySshTarget || 'none'}): ${primaryStatus}`);

    if (config.llama.enabled && config.llama.isSeparateVps) {
      const secTarget = config.llama.sshTarget || config.secondarySshTarget || 'none';
      const secStatus = state.secondaryReachable ? `${ansi.green}[ONLINE]${ansi.reset}` : `${ansi.red}[UNREACHABLE]${ansi.reset}`;
      console.log(`  • Secondary VM (${secTarget}): ${secStatus}`);
    }

    console.log(`\n${ansi.yellow}The configured VM(s) cannot be reached.${ansi.reset}\n`);
    console.log(`What would you like to do?`);
    if (missing === 'both') {
      console.log(`  1. Setup Both New Primary & Secondary VMs [Default]\n  2. Setup New Primary VM only\n  3. Setup New Secondary VM only\n  4. Retry connecting\n  0. Offline Mode\n`);
    } else if (missing === 'secondary') {
      console.log(`  1. Setup New Secondary VM (Dedicated Llama) [Default]\n  2. Disable Secondary VM (Use Primary or Cloud APIs)\n  3. Setup Both VMs\n  4. Retry connecting\n  0. Offline Mode\n`);
    } else {
      console.log(`  1. Setup New Primary VM (OpenClaw & OmniRoute) [Default]\n  2. Setup Both VMs\n  3. Retry connecting\n  0. Offline Mode\n`);
    }

    const choice = await this.ask(rl, 'Select option (0-4)', '1');
    if (isBackInput(choice) || choice === '0') {
      rl.close();
      return false;
    }

    if (choice === '4' || (missing === 'primary' && choice === '3')) {
      process.stdout.write(`\r[*] Retrying connection to VPS... `);
      const retryState = await VpsDetector.inspectAll(config);
      if (retryState.primaryReachable && retryState.secondaryReachable !== false) {
        console.log(`${ansi.green}[OK: Re-connected!]${ansi.reset}\n`);
        rl.close();
        return true;
      }
      console.log(`${ansi.red}[Failed: Still unreachable]${ansi.reset}`);
      const again = await this.ask(rl, 'Proceed with setting up new VM? (Y/n)', 'Y');
      if (again.toLowerCase() !== 'y') {
        rl.close();
        return false;
      }
    }
    rl.close();

    if (missing === 'secondary' && choice === '2') {
      config.llama.isSeparateVps = false;
      config.llama.sshTarget = config.primarySshTarget;
      config.secondarySshTarget = '';
      ConfigManager.save(config);
      return true;
    }

    if ((missing === 'both' && choice === '1') || (missing !== 'both' && choice === '2' && missing === 'primary') || (missing === 'secondary' && choice === '3')) {
      const runner = new OnboardingRunner(config);
      await runner.runOnboarding();
      return true;
    }

    if (missing === 'secondary' || (missing === 'both' && choice === '3')) {
      return this.setupNewSecondary(config);
    }

    return this.setupNewPrimary(config);
  }

  static async setupNewPrimary(config: ControlPanelConfig): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const wizard = new VpsSetupWizard(rl, (q, d) => this.ask(rl, q, d));

    try {
      console.log(`\n${ansi.cyan}=== Setup New Primary Virtual Machine ===${ansi.reset}`);
      console.log(`  1. Freestyle.sh [Default]\n  2. Daytona Cloud\n  0. Cancel\n`);

      const pChoice = await this.ask(rl, 'Select provider for Primary VM (1-2, 0 to cancel)', config.provider === 'daytona' ? '2' : '1');
      if (isBackInput(pChoice)) return false;
      config.provider = pChoice === '2' ? 'daytona' : 'freestyle';

      if (config.provider === 'freestyle') {
        const res = await wizard.setupPrimaryFreestyle(config.freestyleApiKey);
        config.primarySshTarget = res.primarySshTarget;
        if (res.apiKey) config.freestyleApiKey = res.apiKey;
        if (res.primaryWorkspaceId) config.freestylePrimaryVmId = res.primaryWorkspaceId;
        if (res.primarySlug) config.freestylePrimarySlug = res.primarySlug;
        config.vpsSpecs = res.specs;
      } else {
        const res = await wizard.setupPrimaryDaytona(config.daytonaApiKey);
        config.primarySshTarget = res.primarySshTarget;
        if (res.apiKey) config.daytonaApiKey = res.apiKey;
        if (res.primaryWorkspaceId) config.daytonaPrimaryWorkspaceId = res.primaryWorkspaceId;
        config.vpsSpecs = res.specs;
      }

      await wizard.probeHardware(config.primarySshTarget, undefined, config.provider);

      process.stdout.write(`Scanning for existing services and configuration... `);
      const existingConfig = await VpsConfigDetector.inspect(config.primarySshTarget);
      if (existingConfig.openclawInstalled) {
        console.log(`${ansi.green}[FOUND]${ansi.reset}`);
      } else {
        console.log(`${ansi.dim}[Fresh VM]${ansi.reset}`);
      }
      ServiceDiscoveryFormatter.printSummary(existingConfig, config.vpsSpecs, 'Primary VM');

      let keepConfig = false;
      if (existingConfig.openclawInstalled || existingConfig.telegramBotToken || existingConfig.discordBotToken || existingConfig.railwayRelayConfigured || existingConfig.llamaInstalled) {
        const ans = await this.ask(rl, 'Keep and import this existing configuration? (Y/n)', 'Y');
        keepConfig = ans.toLowerCase() === 'y';
      }

      if (keepConfig) {
        if (existingConfig.openclawToken) config.openclawToken = existingConfig.openclawToken;
        if (existingConfig.telegramBotToken) config.telegramBotToken = existingConfig.telegramBotToken;
        if (existingConfig.discordBotToken) config.discordBotToken = existingConfig.discordBotToken;
        if (existingConfig.discordGuildId) config.discordGuildId = existingConfig.discordGuildId;
        if (existingConfig.railwayDomain) config.railwayDomain = existingConfig.railwayDomain;
        if (existingConfig.railwayUuid) config.railwayUuid = existingConfig.railwayUuid;
        if (existingConfig.llamaInstalled) {
          config.llama.enabled = true;
          if (existingConfig.llamaTopology === 'second_vm') {
            config.llama.isSeparateVps = true;
            if (existingConfig.llamaEndpoint) {
              if (config.provider === 'freestyle') {
                config.llama.freestyleDomainUrl = existingConfig.llamaEndpoint;
              } else {
                config.llama.railwayEndpointUrl = existingConfig.llamaEndpoint;
              }
              config.llama.activeEndpointUrl = existingConfig.llamaEndpoint;
            }
          } else {
            config.llama.isSeparateVps = false;
            config.llama.sshTarget = config.primarySshTarget;
          }
          if (existingConfig.llamaModel) config.llama.modelName = existingConfig.llamaModel;
        }
        await VpsProbe.execRemote(config.primarySshTarget, 'sudo supervisorctl restart all 2>/dev/null || true', 10);
        await OmnirouteSync.syncPassword(config.primarySshTarget, config.omniroutePassword || 'CHANGEME');
      } else {
        const channels = await OnboardingSteps.promptBotChannels(
          (q, d) => this.ask(rl, q, d),
          config.primarySshTarget,
          { telegramToken: config.telegramBotToken, discordToken: config.discordBotToken, discordGuildId: config.discordGuildId }
        );
        if (channels.telegramToken) config.telegramBotToken = channels.telegramToken;
        if (channels.discordToken) config.discordBotToken = channels.discordToken;
        if (channels.discordGuildId) config.discordGuildId = channels.discordGuildId;

        if (!existingConfig.openclawInstalled) {
          await OnboardingSteps.runRemoteProvisioning(config.primarySshTarget, undefined, config.provider, false);
        }
        await OnboardingSteps.syncOpenClawConfig(config.primarySshTarget, config.openclawToken, config.telegramBotToken, config.discordBotToken, config.discordGuildId);
        await OmnirouteSync.syncPassword(config.primarySshTarget, config.omniroutePassword || 'CHANGEME');
      }

      ConfigManager.save(config);
      console.log(`\n${ansi.green}[OK] Primary VM setup completed and verified!${ansi.reset}\n`);
      return true;
    } finally {
      rl.close();
    }
  }

  static async setupNewSecondary(config: ControlPanelConfig): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const wizard = new VpsSetupWizard(rl, (q, d) => this.ask(rl, q, d));

    try {
      console.log(`\n${ansi.cyan}=== Setup New Secondary LLM Virtual Machine ===${ansi.reset}`);
      const secRes = await wizard.setupSecondaryVm(config.secondaryProvider || config.provider, config.freestyleApiKey, config.secondaryDaytonaApiKey || config.daytonaApiKey);

      config.secondaryProvider = secRes.provider;
      config.secondarySshTarget = secRes.secondarySshTarget;
      config.llama.sshTarget = secRes.secondarySshTarget;
      config.llama.enabled = true;
      config.llama.isSeparateVps = true;
      if (secRes.apiKey) {
        if (secRes.provider === 'freestyle') config.freestyleApiKey = secRes.apiKey;
        else if (secRes.provider === 'daytona') {
          config.secondaryDaytonaApiKey = secRes.apiKey;
          if (!config.daytonaApiKey) config.daytonaApiKey = secRes.apiKey;
        }
      }
      if (secRes.secondaryWorkspaceId) {
        if (secRes.provider === 'daytona') {
          config.daytonaSecondaryWorkspaceId = secRes.secondaryWorkspaceId;
        } else {
          config.freestyleSecondaryVmId = secRes.secondaryWorkspaceId;
        }
      }
      if (secRes.secondarySlug) config.freestyleLlamaSlug = secRes.secondarySlug;

      const probe = await wizard.probeHardware(config.primarySshTarget, config.secondarySshTarget, config.provider, config.secondaryProvider);
      
      let keepExisting = false;
      if (probe.secondaryLlamaDetected) {
        const modelName = probe.secondaryLlamaModel || 'Detected Model';
        console.log(`\n${ansi.green}[Secondary VM: Active LLM Service Found]${ansi.reset}`);
        const ans = await this.ask(rl, `Keep existing LLM installation & model "${modelName}"? (Y/n)`, 'Y');
        keepExisting = ans.toLowerCase() === 'y';
      }

      if (keepExisting) {
        if (probe.secondaryLlamaModel) config.llama.modelName = probe.secondaryLlamaModel;
        console.log(`  • Ensuring llama-server service is active...`);
        await VpsProbe.execRemote(config.secondarySshTarget, 'sudo supervisorctl restart llama 2>/dev/null || (pkill -9 -f llama-server 2>/dev/null; tmux kill-session -t llama 2>/dev/null; sleep 1; tmux new-session -d -s llama "bash ~/start-server.sh" 2>/dev/null || (nohup bash ~/start-server.sh >/dev/null 2>&1 &)) || true', 10);
      } else {
        const ram = probe.secondarySpecs?.ramGb || 8;
        const model = await OnboardingSteps.promptModelSelection((q, d) => this.ask(rl, q, d), config.secondaryProvider || config.provider, ram);
        config.llama = { ...config.llama, ...model };
        await OnboardingSteps.runRemoteProvisioning('', config.secondarySshTarget, config.secondaryProvider || config.provider, true, config.llama);
      }

      if ((config.secondaryProvider || config.provider) === 'daytona') {
        const relayRes = await RailwayHelper.promptLlamaRelay(
          (q, d) => this.ask(rl, q, d),
          { railwayEndpointUrl: config.llama.railwayEndpointUrl, railwayApiKey: config.railwayApiKey }
        );
        if (relayRes.railwayEndpointUrl) config.llama.railwayEndpointUrl = relayRes.railwayEndpointUrl;
        if (relayRes.activeEndpointUrl) config.llama.activeEndpointUrl = relayRes.activeEndpointUrl;
        if (relayRes.railwayApiKey) config.railwayApiKey = relayRes.railwayApiKey;
      }

      if (config.primarySshTarget) {
        const endpoint = EndpointResolver.resolveBaseUrl(config);
        config.llama.activeEndpointUrl = endpoint;
        await OmnirouteSync.registerLlamaInOpenClaw(config.primarySshTarget, endpoint, config.llama.modelName || 'qwen2.5-7b-mtp');
      }

      ConfigManager.save(config);
      console.log(`\n${ansi.green}[OK] Secondary Llama VM setup completed and verified!${ansi.reset}\n`);
      return true;
    } finally {
      rl.close();
    }
  }

  static async showSetupAssistantMenu(config: ControlPanelConfig): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.clear();
      console.log(`\n${ansi.cyan}====================================================${ansi.reset}`);
      console.log(`  ${ansi.bold}OpenClaw VPS Setup & Reconfiguration Assistant${ansi.reset}`);
      console.log(`${ansi.cyan}====================================================${ansi.reset}\n`);
      console.log(`  1. Setup / Replace Primary VM (OpenClaw & OmniRoute)`);
      console.log(`  2. Setup / Replace Secondary VM (Dedicated Llama LLM)`);
      console.log(`  3. Run Full Guided Onboarding (Both VMs)`);
      console.log(`  4. Reconfigure Bot Channels (Telegram & Discord)`);
      console.log(`  5. Reconfigure WebUI Access & Redeploy Web Relay`);
      console.log(`  0. Back to Control Panel (or ESC)\n`);

      const choice = await this.ask(rl, 'Select option (0-5)', '0');
      rl.close();

      if (choice === '1') await this.setupNewPrimary(config);
      else if (choice === '2') await this.setupNewSecondary(config);
      else if (choice === '3') {
        const runner = new OnboardingRunner(config);
        await runner.runOnboarding();
      } else if (choice === '4') {
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        const channels = await OnboardingSteps.promptBotChannels(
          (q, d) => this.ask(rl2, q, d),
          config.primarySshTarget,
          { telegramToken: config.telegramBotToken, discordToken: config.discordBotToken, discordGuildId: config.discordGuildId }
        );
        if (channels.telegramToken) config.telegramBotToken = channels.telegramToken;
        if (channels.discordToken) config.discordBotToken = channels.discordToken;
        if (channels.discordGuildId) config.discordGuildId = channels.discordGuildId;
        ConfigManager.save(config);
        rl2.close();
      } else if (choice === '5') {
        const { configureAccess } = await import('./accessSettingsController.js');
        const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          await configureAccess(
            config,
            (q, d) => this.ask(rl3, q, d),
            (next) => ConfigManager.save(next),
            (msg) => console.log(msg)
          );
        } finally {
          rl3.close();
        }
      }
    } catch (err) {
      console.error('[Error in Setup Assistant]:', err);
    }
  }
}
