import readline from 'readline';
import { ControlPanelConfig, CloudProviderType } from './types.js';
import { ConfigManager } from './configManager.js';
import { VpsSetupWizard } from './vpsSetupWizard.js';
import { OnboardingSteps } from './onboardingSteps.js';
import { VpsDetector } from './vpsDetector.js';
import { VpsConfigDetector } from './vpsConfigDetector.js';
import { ServiceDiscoveryFormatter } from './serviceDiscoveryFormatter.js';
import { VpsProbe } from './vpsProbe.js';
import { EndpointResolver } from './endpointResolver.js';
import { OmnirouteSync } from './omnirouteSync.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { OnboardingScreen } from './onboardingScreen.js';
import { RelayDeployer } from './relayDeployer.js';
import { OnboardingExistingLlama } from './onboardingExistingLlama.js';
import { RemoteProvisioner } from './remoteProvisioner.js';
import { ansi } from '../tui/ansi.js';

export class OnboardingRunner {
  private rl: readline.Interface;
  private config: ControlPanelConfig;
  private screen: OnboardingScreen;

  constructor(config: ControlPanelConfig) {
    this.config = config;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.screen = new OnboardingScreen(this.rl);
  }

  private ask(question: string, defaultValue = '', allowBack = true): Promise<string> {
    return this.screen.ask(question, defaultValue, allowBack);
  }

  async runOnboarding(missingServices?: string[]): Promise<ControlPanelConfig> {
    this.screen.attach();
    try {
      console.clear();
      console.log(`\n${ansi.cyan}====================================================\n  ${ansi.bold}OpenClaw Multi-Cloud Onboarding Setup Assistant${ansi.reset}\n${ansi.cyan}====================================================${ansi.reset}\n`);

      if (missingServices && missingServices.length > 0) {
        console.log(`${ansi.yellow}[NOTICE] Incomplete Installation:${ansi.reset} ${missingServices.join(', ')}\n`);
      }

      const vpsWizard = new VpsSetupWizard(this.rl, (q, d, b) => this.ask(q, d, b));
      let step = 1;
      let skipLlamaProvisioning = false;

      while (step <= 7) {
        this.screen.setStep(step);
        try {
          if (step === 1) {
            console.log(`\n[Step 1/7] Select Cloud VPS Provider:`);
            console.log(`  1. Freestyle.sh (Recommended — 32GB Disk, Direct Egress, No Relay) [Default]`);
            console.log(`  2. Daytona Cloud (10GB Disk, Requires Railway Relay)`);
            console.log(`  0. Exit (or ESC)\n`);

            const defaultChoice = this.config.provider === 'daytona' ? '2' : '1';
            const providerChoice = await this.ask('Select provider (1-2, or 0 to exit)', defaultChoice, false);
            if (isBackInput(providerChoice)) {
              console.log(`\n${ansi.yellow}Exiting setup assistant...${ansi.reset}\n`);
              this.rl.close();
              return this.config;
            }
            this.config.provider = providerChoice === '2' ? 'daytona' : 'freestyle';
            step = 2;
          } else if (step === 2) {
            if (this.config.provider === 'freestyle') {
              const res = await vpsWizard.setupPrimaryFreestyle(this.config.freestyleApiKey);
              this.config.primarySshTarget = res.primarySshTarget;
              if (res.primarySshTarget.includes(':')) {
                this.config.freestylePrimarySlug = res.primarySshTarget.split(':')[0].replace(/^ssh\s+/i, '').trim();
              }
              if (res.apiKey) this.config.freestyleApiKey = res.apiKey;
              if (res.primaryWorkspaceId) this.config.freestylePrimaryVmId = res.primaryWorkspaceId;
              if (res.primarySlug) this.config.freestylePrimarySlug = res.primarySlug;
              this.config.vpsSpecs = res.specs;
            } else {
              const res = await vpsWizard.setupPrimaryDaytona(this.config.daytonaApiKey);
              this.config.primarySshTarget = res.primarySshTarget;
              if (res.apiKey) this.config.daytonaApiKey = res.apiKey;
              if (res.primaryWorkspaceId) this.config.daytonaPrimaryWorkspaceId = res.primaryWorkspaceId;
              this.config.vpsSpecs = res.specs;
            }
            step = 3;
          } else if (step === 3) {
            const probeRes = await vpsWizard.probeHardware(
              this.config.primarySshTarget,
              undefined,
              this.config.provider
            );
            this.config.vpsSpecs = probeRes.primarySpecs;

            process.stdout.write(`Discovering installed services on Primary VM... `);
            const existingVm = await VpsConfigDetector.inspect(this.config.primarySshTarget);
            if (existingVm.openclawInstalled) {
              console.log(`${ansi.green}[FOUND]${ansi.reset}`);
            } else {
              console.log(`${ansi.dim}[Fresh VM]${ansi.reset}`);
            }
            ServiceDiscoveryFormatter.printSummary(existingVm, this.config.vpsSpecs, 'Primary VM');

            if (existingVm.railwayDomain) this.config.railwayDomain = existingVm.railwayDomain;
            if (existingVm.railwayUuid) this.config.railwayUuid = existingVm.railwayUuid;
            if (existingVm.openclawToken) this.config.openclawToken = existingVm.openclawToken;
            if (existingVm.telegramBotToken) this.config.telegramBotToken = existingVm.telegramBotToken;
            if (existingVm.discordBotToken) this.config.discordBotToken = existingVm.discordBotToken;
            if (existingVm.discordGuildId) this.config.discordGuildId = existingVm.discordGuildId;

            if (this.config.provider === 'daytona' && (!this.config.railwayDomain || !this.config.railwayUuid)) {
              const rw = await RelayDeployer.promptEgressRelay(
                (q, d) => this.ask(q, d, true),
                { railwayDomain: this.config.railwayDomain, railwayUuid: this.config.railwayUuid },
                this.config.railwayApiKey
              );
              if (rw.railwayDomain) this.config.railwayDomain = rw.railwayDomain;
              if (rw.railwayUuid) this.config.railwayUuid = rw.railwayUuid;
            }

            this.screen.commitSection();
            step = 4;
          } else if (step === 4) {
            const botChannels = await OnboardingSteps.promptBotChannels(
              (q, d) => this.ask(q, d, true),
              this.config.primarySshTarget,
              {
                telegramToken: this.config.telegramBotToken,
                discordToken: this.config.discordBotToken,
                discordGuildId: this.config.discordGuildId
              }
            );
            if (botChannels.telegramToken) this.config.telegramBotToken = botChannels.telegramToken;
            if (botChannels.discordToken) this.config.discordBotToken = botChannels.discordToken;
            if (botChannels.discordGuildId) this.config.discordGuildId = botChannels.discordGuildId;
            step = 5;
          } else if (step === 5) {
            skipLlamaProvisioning = await this.handleStep5Llama(vpsWizard);
            step = 6;
          } else if (step === 6) {
            const ingressRes = await OnboardingSteps.promptIngressAndDomainMode(
              (q, d) => this.ask(q, d, true),
              this.config
            );
            this.config.domainedUrlsEnabled = ingressRes.domainedUrlsEnabled;
            this.config.ingressProvider = ingressRes.ingressProvider;
            if (ingressRes.publicBaseDomain) {
              this.config.publicBaseDomain = ingressRes.publicBaseDomain;
            }
            if (ingressRes.railwayApiKey) {
              this.config.railwayApiKey = ingressRes.railwayApiKey;
            }

            console.log(`\n${ansi.cyan}[Step 6/7] Automated Remote Node Provisioning${ansi.reset}`);
            const provRes = await RemoteProvisioner.execute(this.config, {
              skipLlamaProvisioning,
              onProgress: (_stage, detail) => {
                if (detail) console.log(`  • ${detail}`);
              }
            });
            if (provRes.warnings.length > 0) {
              provRes.warnings.forEach((w) => console.log(`  ${ansi.yellow}[WARN: ${w}]${ansi.reset}`));
            }

            this.screen.commitSection();
            step = 7;
          } else if (step === 7) {
            console.log(`\n${ansi.cyan}[Step 7/7] Finalization & TUI Launch${ansi.reset}`);
            ConfigManager.save(this.config);
            const secProv = this.config.llama.enabled && this.config.llama.isSeparateVps ? ` | Secondary: ${(this.config.secondaryProvider || this.config.provider).toUpperCase()}` : '';
            console.log(`${ansi.green}Configuration saved!${ansi.reset} Primary: ${this.config.provider.toUpperCase()}${secProv} | Egress: ${this.config.provider === 'freestyle' ? 'DIRECT' : 'RELAY'}\n`);
            break;
          }
        } catch (err: unknown) {
          const errObj = err instanceof Error ? err : new Error(String(err));
          if (errObj instanceof BackStepSignal || errObj.name === 'BackStepSignal') {
            console.log(`\n${ansi.yellow}<< Returning to previous step...${ansi.reset}`);
            step = Math.max(1, step - 1);
            if (step === 3) step = 2;
            this.screen.rollbackStep(step);
          } else {
            console.log(`\n${ansi.red}[Error: ${errObj.message}]${ansi.reset}`);
            const retry = await this.ask('Options: [1] Retry current step, [0] Back (or ESC)', '1', false);
            if (isBackInput(retry)) {
              step = Math.max(1, step - 1);
              if (step === 3) step = 2;
              this.screen.rollbackStep(step);
            }
          }
        }
      }

      return this.config;
    } finally {
      this.screen.detach();
      this.rl.close();
    }
  }

  private async handleStep5Llama(vpsWizard: VpsSetupWizard): Promise<boolean> {
    const existing = await VpsDetector.detectExistingLlamaSetup(this.config, this.config.primarySshTarget);
    let keepExistingSetup = false;
    if (existing.found) {
      console.log(`\n${ansi.yellow}[Detected: Existing LLM setup / connection found]${ansi.reset}`);
      console.log(existing.summary);
      const keepAns = await this.ask('Keep existing LLM setup (skip deployment)? (Y/n, or 0 to go back)', 'Y', true);
      if (keepAns === '0') throw new BackStepSignal();
      keepExistingSetup = keepAns.toLowerCase() === 'y';
    }

    if (keepExistingSetup) {
      this.config.llama.enabled = true;
      this.config.llama.isSeparateVps = existing.isSeparate;
      if (existing.endpoint) this.config.llama.activeEndpointUrl = existing.endpoint;
      if (existing.modelName) this.config.llama.modelName = existing.modelName;
      if (existing.sshTarget) {
        this.config.secondarySshTarget = existing.sshTarget;
        this.config.llama.sshTarget = existing.sshTarget;
      }
      if (existing.isSeparate && (!this.config.secondarySshTarget || !this.config.llama.sshTarget)) {
        await OnboardingExistingLlama.promptSecondaryConnection((q, d, b) => this.ask(q, d, b), this.config, vpsWizard, existing.endpoint);
      }
      return true;
    }

    const topology = await OnboardingSteps.promptLlamaTopology((q, d) => this.ask(q, d, true));
    if (topology === 'disabled') {
      this.config.llama.enabled = false;
      return false;
    }

    if (topology === 'same_vm') {
      this.config.llama.enabled = true;
      this.config.llama.isSeparateVps = false;
      this.config.llama.sshTarget = this.config.primarySshTarget;
      this.config.secondarySshTarget = '';

      const existingLlama = await VpsDetector.detectLlamaInstallation(this.config.primarySshTarget);
      let keepExisting = false;
      if (existingLlama) {
        console.log(`\n${ansi.yellow}[Detected: Existing llama-server on Primary VM]${ansi.reset}`);
        const keepAns = await this.ask('Keep existing LLM configuration? (Y/n)', 'Y', true);
        keepExisting = keepAns.toLowerCase() === 'y';
      }

      if (!keepExisting) {
        const modelSettings = await OnboardingSteps.promptModelSelection((q, d) => this.ask(q, d, true), this.config.provider, this.config.vpsSpecs.ramGb);
        this.config.llama = { ...this.config.llama, ...modelSettings };
      }
      return false;
    }

    // Dedicated Second VM
    this.config.llama.enabled = true;
    this.config.llama.isSeparateVps = true;
    const secRes = await vpsWizard.setupSecondaryVm(this.config.provider, this.config.freestyleApiKey, this.config.secondaryDaytonaApiKey || this.config.daytonaApiKey);
    this.config.secondaryProvider = secRes.provider;
    if (secRes.provider === 'freestyle' && secRes.apiKey) {
      if (this.config.freestyleApiKey && this.config.freestyleApiKey !== secRes.apiKey) {
        this.config.secondaryFreestyleApiKey = secRes.apiKey;
      } else {
        this.config.freestyleApiKey = secRes.apiKey;
      }
    } else if (secRes.provider === 'daytona' && secRes.apiKey) {
      this.config.secondaryDaytonaApiKey = secRes.apiKey;
      if (!this.config.daytonaApiKey) this.config.daytonaApiKey = secRes.apiKey;
    }
    this.config.secondarySshTarget = secRes.secondarySshTarget;
    this.config.llama.sshTarget = secRes.secondarySshTarget;
    if (secRes.secondarySshTarget.includes(':')) {
      this.config.freestyleLlamaSlug = secRes.secondarySshTarget.split(':')[0].replace(/^ssh\s+/i, '').trim();
    }
    if (secRes.secondaryWorkspaceId) {
      if (secRes.provider === 'daytona') this.config.daytonaSecondaryWorkspaceId = secRes.secondaryWorkspaceId;
      else this.config.freestyleSecondaryVmId = secRes.secondaryWorkspaceId;
    }
    if (secRes.secondarySlug) this.config.freestyleLlamaSlug = secRes.secondarySlug;

    const secProbe = await vpsWizard.probeHardware(this.config.primarySshTarget, this.config.secondarySshTarget, this.config.provider, this.config.secondaryProvider);
    let keepExistingSec = false;
    if (secProbe.secondaryLlamaDetected) {
      const modelName = secProbe.secondaryLlamaModel || 'Detected Model';
      console.log(`\n${ansi.green}[Secondary VM: Active LLM Service Found]${ansi.reset}`);
      const keepAns = await this.ask(`Keep existing LLM installation & model "${modelName}"? (Y/n, or 0 to go back)`, 'Y', true);
      keepExistingSec = keepAns.toLowerCase() === 'y';
    }

    if (keepExistingSec) {
      this.config.llama.enabled = true;
      this.config.llama.isSeparateVps = true;
      if (secProbe.secondaryLlamaModel) this.config.llama.modelName = secProbe.secondaryLlamaModel;
      console.log(`${ansi.green}[OK] Preserving existing LLM installation and model on Secondary VM.${ansi.reset}`);
    } else {
      const secRam = secProbe.secondarySpecs?.ramGb || this.config.vpsSpecs.ramGb;
      const modelSettings = await OnboardingSteps.promptModelSelection((q, d) => this.ask(q, d, true), this.config.secondaryProvider || this.config.provider, secRam);
      this.config.llama = { ...this.config.llama, ...modelSettings };
    }

    const epRes = await OnboardingSteps.promptLlamaEndpoint((q, d) => this.ask(q, d, true), this.config.secondaryProvider || this.config.provider, this.config.secondarySshTarget, { ...this.config.llama, railwayApiKey: this.config.railwayApiKey });
    if (epRes.freestyleDomainUrl) this.config.llama.freestyleDomainUrl = epRes.freestyleDomainUrl;
    if (epRes.railwayEndpointUrl) this.config.llama.railwayEndpointUrl = epRes.railwayEndpointUrl;
    if (epRes.activeEndpointUrl) this.config.llama.activeEndpointUrl = epRes.activeEndpointUrl;
    if (epRes.railwayApiKey) this.config.railwayApiKey = epRes.railwayApiKey;

    return keepExistingSec;
  }
}
