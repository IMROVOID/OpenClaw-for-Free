import readline from 'readline';
import { VpsSpecs, CloudProviderType, ProvisionResult } from './types.js';
import { DaytonaApi } from './daytonaApi.js';
import { FreestyleApi } from './freestyleApi.js';
import { VpsProviderFactory } from './vpsProviderDriver.js';
import { ConfigManager } from './configManager.js';
import { VpsDetector } from './vpsDetector.js';
import { VpsConfigDetector } from './vpsConfigDetector.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { FreestyleWizardStep } from './freestyleWizardStep.js';
import { DaytonaWizardStep } from './daytonaWizardStep.js';
import { SecondaryVmWizardStep, type SecondaryVmResult } from './secondaryVmWizardStep.js';
import { ansi } from '../tui/ansi.js';

export type { SecondaryVmResult };

export class VpsSetupWizard {
  private rl: readline.Interface;
  private askFn?: (question: string, defaultValue?: string, allowBack?: boolean) => Promise<string>;

  constructor(
    rl: readline.Interface,
    askFn?: (question: string, defaultValue?: string, allowBack?: boolean) => Promise<string>
  ) {
    this.rl = rl;
    this.askFn = askFn;
  }

  ask(question: string, defaultValue = '', allowBack = true): Promise<string> {
    if (this.askFn) {
      return this.askFn(question, defaultValue, allowBack);
    }
    return new Promise((resolve, reject) => {
      const promptText = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      this.rl.question(promptText, (ans) => {
        const clean = ans.trim();
        if (allowBack && isBackInput(clean)) {
          return reject(new BackStepSignal());
        }
        resolve(clean || defaultValue);
      });
    });
  }

async setupPrimaryFreestyle(existingApiKey?: string): Promise<{ primarySshTarget: string; apiKey?: string; specs: VpsSpecs; primaryWorkspaceId?: string; primarySlug?: string }> {
    return FreestyleWizardStep.setupPrimary((q, d, b) => this.ask(q, d, b), existingApiKey);
  }

  async setupPrimaryDaytona(existingApiKey?: string): Promise<{ primarySshTarget: string; apiKey?: string; specs: VpsSpecs; primaryWorkspaceId?: string; primarySlug?: string }> {
    return DaytonaWizardStep.setupPrimary((q, d, b) => this.ask(q, d, b), existingApiKey);
  }

  async setupSecondaryVm(
    defaultProvider: CloudProviderType = 'freestyle',
    freestyleApiKey?: string,
    daytonaApiKey?: string
  ): Promise<SecondaryVmResult> {
    return SecondaryVmWizardStep.setup(
      (q, d, b) => this.ask(q, d, b),
      defaultProvider,
      freestyleApiKey,
      daytonaApiKey
    );
  }

  async probeHardware(
    primaryTarget: string,
    secondaryTarget: string | undefined,
    provider: CloudProviderType,
    secondaryProvider?: CloudProviderType
  ): Promise<{
    primarySpecs: VpsSpecs;
    secondarySpecs?: VpsSpecs;
    secondaryLlamaDetected?: boolean;
    secondaryLlamaModel?: string;
    secondaryLlamaRunning?: boolean;
  }> {
    console.log(`\n${ansi.cyan}[Step 3/7] Automated Hardware Probe${ansi.reset}`);
    const primaryDriver = VpsProviderFactory.getDriver(provider === 'freestyle' ? 'freestyle' : 'daytona');

    process.stdout.write(`Probing hardware on Primary VM (${primaryTarget})... `);
    const primarySpecs = await primaryDriver.detectHardware(primaryTarget);
    console.log(`${ansi.green}[OK: ${primarySpecs.cpuCores} vCPU, ${primarySpecs.ramGb} GB RAM, ${primarySpecs.storageGb} GB Storage]${ansi.reset}`);

    let secondarySpecs: VpsSpecs | undefined;
    let secondaryLlamaDetected = false;
    let secondaryLlamaModel: string | undefined;
    let secondaryLlamaRunning: boolean | undefined;

    if (secondaryTarget) {
      const secDriver = VpsProviderFactory.getDriver((secondaryProvider || provider) === 'freestyle' ? 'freestyle' : 'daytona');
      process.stdout.write(`Probing hardware on Secondary VM (${secondaryTarget})... `);
      secondarySpecs = await secDriver.detectHardware(secondaryTarget);
      console.log(`${ansi.green}[OK: ${secondarySpecs.cpuCores} vCPU, ${secondarySpecs.ramGb} GB RAM, ${secondarySpecs.storageGb} GB Storage]${ansi.reset}`);

      process.stdout.write(`Checking for existing LLM installation on Secondary VM... `);
      const llamaInfo = await VpsConfigDetector.detectSecondaryLlama(secondaryTarget);
      secondaryLlamaDetected = llamaInfo.llamaInstalled;
      secondaryLlamaModel = llamaInfo.llamaModel;
      secondaryLlamaRunning = llamaInfo.llamaRunning;

      if (secondaryLlamaDetected) {
        console.log(`${ansi.green}[FOUND]${ansi.reset}`);
        const state = llamaInfo.llamaRunning ? `${ansi.green}[RUNNING]${ansi.reset}` : `${ansi.yellow}[INSTALLED]${ansi.reset}`;
        console.log(`    ┌─ LLM Service : ${state} (Port 8080)`);
        if (llamaInfo.llamaModel) {
          const sz = llamaInfo.llamaModelSize ? ` (${llamaInfo.llamaModelSize})` : '';
          console.log(`    ├─ Model Name  : ${ansi.brightYellow}${llamaInfo.llamaModel}${ansi.reset}${sz}`);
        }
        if (llamaInfo.llamaModelPath) {
          console.log(`    └─ Model File  : ${ansi.dim}${llamaInfo.llamaModelPath}${ansi.reset}`);
        } else {
          console.log(`    └─ Status      : ${ansi.dim}Ready${ansi.reset}`);
        }
      } else {
        console.log(`${ansi.dim}[Not installed — will configure fresh]${ansi.reset}`);
      }
    }

    return { primarySpecs, secondarySpecs, secondaryLlamaDetected, secondaryLlamaModel, secondaryLlamaRunning };
  }

  async setupFreestyle(existingApiKey?: string): Promise<ProvisionResult> {
    const res = await this.setupPrimaryFreestyle(existingApiKey);
    return {
      primarySshTarget: res.primarySshTarget,
      secondarySshTarget: '',
      specs: res.specs,
      apiKey: res.apiKey
    };
  }

  async setupDaytona(existingApiKey?: string): Promise<ProvisionResult> {
    const res = await this.setupPrimaryDaytona(existingApiKey);
    return {
      primarySshTarget: res.primarySshTarget,
      secondarySshTarget: '',
      specs: res.specs,
      apiKey: res.apiKey
    };
  }
}
