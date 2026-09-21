import { CloudProviderType, ControlPanelConfig, LlamaSettings } from './types.js';
import { VpsProbe } from './vpsProbe.js';
import { VpsDetector } from './vpsDetector.js';
import { OpenclawConfigSyncer } from './openclawConfigSyncer.js';
import { EndpointResolver } from './endpointResolver.js';
import { CustomModelStep } from './customModelStep.js';
import { OnboardingIngressStep, IngressStepResult } from './onboardingIngressStep.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { getBootstrapNodeScript, buildIngressArgument, BootstrapIngressOptions } from './bootstrapLoader.js';
import { RailwayHelper } from './railwayHelper.js';
import { ansi } from '../tui/ansi.js';

export interface BotChannelConfig {
  telegramToken?: string;
  discordToken?: string;
  discordGuildId?: string;
}

export class OnboardingSteps {
  /**
   * Step 4: Bot Messaging Channels Configuration (safely merges into ~/.openclaw/openclaw.json)
   */
  static async promptBotChannels(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    primarySshTarget: string,
    existingDefaults?: BotChannelConfig
  ): Promise<BotChannelConfig> {
    console.log(`\n${ansi.cyan}[Step 4/7] Bot Messaging Channels${ansi.reset}`);
    console.log(`Configure Telegram and Discord bot integrations for OpenClaw:\n`);

    const existing: BotChannelConfig = { ...existingDefaults };
    if (primarySshTarget) {
      const detected = await VpsDetector.detectExistingBotTokens(primarySshTarget);
      if (detected.telegramToken) existing.telegramToken = detected.telegramToken;
      if (detected.discordToken) existing.discordToken = detected.discordToken;
      if (detected.discordGuildId) existing.discordGuildId = detected.discordGuildId;
    }

    let tgToken = existing.telegramToken || '';
    let dcToken = existing.discordToken || '';
    let dcGuild = existing.discordGuildId || '';

    if (existing.telegramToken || existing.discordToken) {
      console.log(`  ${ansi.green}[Detected existing Bot Configuration on VM / Session]:${ansi.reset}`);
      if (existing.telegramToken) console.log(`  • Telegram Bot: ${existing.telegramToken.slice(0, 12)}...`);
      if (existing.discordToken) console.log(`  • Discord Bot:  ${existing.discordToken.slice(0, 12)}... (Guild: ${existing.discordGuildId || 'none'})`);
      const keep = await askFn('Keep existing bot channel configuration? (Y/n, or 0 to go back)', 'Y');
      if (isBackInput(keep)) throw new BackStepSignal();
      if (keep.toLowerCase() === 'y') {
        tgToken = existing.telegramToken || '';
        dcToken = existing.discordToken || '';
        dcGuild = existing.discordGuildId || '';
      } else {
        tgToken = await askFn('Telegram Bot Token (or skip, 0 to go back)', existing.telegramToken || '');
        if (isBackInput(tgToken)) throw new BackStepSignal();
        dcToken = await askFn('Discord Bot Token (or skip, 0 to go back)', existing.discordToken || '');
        if (isBackInput(dcToken)) throw new BackStepSignal();
        if (dcToken && dcToken.toLowerCase() !== 'skip') {
          dcGuild = await askFn('Discord Guild ID (or 0 to go back)', existing.discordGuildId || '');
          if (isBackInput(dcGuild)) throw new BackStepSignal();
        }
      }
    } else {
      tgToken = await askFn('Telegram Bot Token (Enter to skip, or 0 to go back)', '');
      if (isBackInput(tgToken)) throw new BackStepSignal();
      dcToken = await askFn('Discord Bot Token (Enter to skip, or 0 to go back)', '');
      if (isBackInput(dcToken)) throw new BackStepSignal();
      if (dcToken && dcToken.toLowerCase() !== 'skip') {
        dcGuild = await askFn('Discord Guild ID (or 0 to go back)', '');
        if (isBackInput(dcGuild)) throw new BackStepSignal();
      }
    }

    const finalTg = tgToken && tgToken.toLowerCase() !== 'skip' ? tgToken : undefined;
    const finalDc = dcToken && dcToken.toLowerCase() !== 'skip' ? dcToken : undefined;
    const finalGuild = dcGuild && dcGuild.toLowerCase() !== 'skip' ? dcGuild : undefined;

    const res: BotChannelConfig = {
      telegramToken: finalTg,
      discordToken: finalDc,
      discordGuildId: finalGuild
    };

    if (primarySshTarget && (finalTg || finalDc)) {
      process.stdout.write(`Merging bot credentials into Primary VM... `);
      await this.syncOpenClawConfig(primarySshTarget, '', finalTg, finalDc, finalGuild);
      console.log(`${ansi.green}[OK: Configured & Verified]${ansi.reset}`);
    }

    return res;
  }

  static async syncOpenClawConfig(
    primaryTarget: string,
    token: string,
    telegramToken?: string,
    discordToken?: string,
    discordGuildId?: string
  ): Promise<void> {
    return OpenclawConfigSyncer.sync(primaryTarget, token, telegramToken, discordToken, discordGuildId);
  }

  /**
   * Step 5a: Local LLM Topology Prompt
   */
  static async promptLlamaTopology(
    askFn: (question: string, defaultValue?: string) => Promise<string>
  ): Promise<'second_vm' | 'same_vm' | 'disabled'> {
    console.log(`\n${ansi.cyan}[Step 5/7] Local LLM Topology & Deployment${ansi.reset}`);
    console.log(`  1. Dedicated Second VM (Recommended — Zero agent RAM interference) [Default]`);
    console.log(`  2. Same VM (Co-locate on Primary VM)`);
    console.log(`  3. Cloud APIs Only (Disable local llama-server)`);
    console.log(`  0. Back (or ESC)\n`);

    const choice = await askFn('Select LLM deployment mode (1-3, or 0 to go back)', '1');
    if (isBackInput(choice)) {
      throw new BackStepSignal();
    }
    if (choice === '3') return 'disabled';
    if (choice === '2') return 'same_vm';
    return 'second_vm';
  }

  /**
   * Step 5b: Local LLM Inference Model Selection (Default: Qwen 2.5 7B MTP)
   */
  static async promptModelSelection(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    provider: CloudProviderType,
    targetRamGb = 8
  ): Promise<Partial<LlamaSettings>> {
    console.log(`\n${ansi.cyan}Select Local LLM Inference Model:${ansi.reset}`);
    console.log(`  1. Qwen 2.5 7B MTP (Recommended — 25-35 tok/s, 32k context, AVX-512) [Default]`);
    if (provider === 'freestyle') {
      console.log(`  2. Qwen 2.5 14B Q4_0 (Advanced — ~8.2GB, Requires Freestyle 32GB)`);
    } else {
      console.log(`  2. Qwen 2.5 14B Q4_0 (Advanced — ~8.2GB, Requires >20GB storage)`);
    }
    console.log(`  3. Custom Model (Hugging Face Repo ID or direct GGUF URL)`);
    console.log(`  0. Back (or ESC)\n`);

    const choice = await askFn('Select local model option (1-3, or 0 to go back)', '1');
    if (isBackInput(choice)) {
      throw new BackStepSignal();
    }

    if (choice === '3') {
      return CustomModelStep.promptCustomModel(askFn, targetRamGb);
    }

    if (choice === '2') {
      return {
        enabled: true,
        modelName: 'Qwen 2.5 14B Q4_0',
        modelUrl: 'https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_0.gguf',
        quantization: 'q4_0',
        contextSize: 32768,
        batchSize: 512,
        threads: 4,
        enableMtp: false,
        enableFlashAttn: true,
        isMoe: false,
        kvCacheQuant: 'q4_0'
      };
    }

    // Default: Qwen 2.5 7B MTP across both providers
    return {
      enabled: true,
      modelName: 'Qwen 2.5 7B MTP',
      modelUrl: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
      quantization: 'q4_k_m',
      contextSize: 32768,
      batchSize: 512,
      threads: 4,
      enableMtp: true,
      enableFlashAttn: true,
      isMoe: false,
      kvCacheQuant: 'q4_0'
    };
  }

  /**
   * Step 5c: Local LLM Endpoint Configuration
   */
  static async promptLlamaEndpoint(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    provider: CloudProviderType,
    secondaryTarget?: string,
    existingDefaults?: { freestyleDomainUrl?: string; railwayEndpointUrl?: string; railwayApiKey?: string }
  ): Promise<{ freestyleDomainUrl?: string; railwayEndpointUrl?: string; activeEndpointUrl?: string; railwayApiKey?: string }> {
    if (provider === 'freestyle') {
      console.log(`\n${ansi.cyan}Configure LLaMA Server Remote Ingress Endpoint:${ansi.reset}`);
      const slug = EndpointResolver.extractSlug(secondaryTarget || 'openclaw-llama');
      const defaultDomain = existingDefaults?.freestyleDomainUrl || `https://${slug}.style.dev`;
      console.log(`  • Freestyle native domains route directly to your secondary inference VM.`);
      console.log(`  • Default domain: ${ansi.brightYellow}${defaultDomain}${ansi.reset}`);
      const entered = await askFn(`Freestyle Llama Public Domain (or Enter for default, 0 to go back)`, defaultDomain);
      if (isBackInput(entered)) throw new BackStepSignal();
      const norm = EndpointResolver.normalizeV1Url(entered || defaultDomain);
      return { freestyleDomainUrl: entered || defaultDomain, activeEndpointUrl: norm };
    } else {
      return RailwayHelper.promptLlamaRelay(askFn, existingDefaults);
    }
  }

  /**
   * Step 5d: Ingress & Web UI Access Mode Prompt
   */
  static async promptIngressAndDomainMode(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    config: ControlPanelConfig
  ): Promise<IngressStepResult> {
    return OnboardingIngressStep.promptIngress(askFn, config);
  }

  /**
   * Helper to format remote bootstrap command with optional model parameters
   */
  static buildProvisioningCommand(
    role: 'agent' | 'llama',
    provider: CloudProviderType,
    modelSettings?: Partial<LlamaSettings>,
    ingressDomain?: string,
    ingressOptions: BootstrapIngressOptions = {}
  ): string {
    const flags = [`--provider=${provider}`, `--role=${role}`];
    if (role === 'llama' && modelSettings?.modelUrl) {
      flags.push(`--model-url=${modelSettings.modelUrl}`);
      const filename = modelSettings.modelName
        ? `${modelSettings.modelName.toLowerCase().replace(/[^a-z0-9.-]/g, '-')}.gguf`
        : 'model.gguf';
      flags.push(`--model-filename=${filename}`);
    }
    if (ingressDomain !== undefined) {
      if (role !== 'agent') throw new Error('Ingress requires agent role.');
      flags.push(buildIngressArgument(ingressDomain, { ...ingressOptions, isSeparateVps: ingressOptions.isSeparateVps || modelSettings?.isSeparateVps }));
    }
    return `bash -s -- ${flags.join(' ')}`;
  }

  /**
   * Step 6: Automated Remote Provisioning via bootstrap_node.sh with direct SSH piping
   */
  static async runRemoteProvisioning(
    primaryTarget: string,
    secondaryTarget: string | undefined,
    provider: CloudProviderType,
    llamaEnabled: boolean,
    modelSettings?: Partial<LlamaSettings>,
    ingressDomain?: string,
    ingressOptions: BootstrapIngressOptions = {}
  ): Promise<void> {
    const command = this.buildProvisioningCommand('agent', provider, modelSettings, ingressDomain, {
      ...ingressOptions, isSeparateVps: ingressOptions.isSeparateVps || (llamaEnabled && !!secondaryTarget)
    });
    console.log(`\n${ansi.cyan}[Step 6/7] Automated Remote Node Provisioning${ansi.reset}`);
    const scriptContent = getBootstrapNodeScript();

    if (primaryTarget) {
      console.log(`[*] Dispatched bootstrap on Primary VM (${primaryTarget})...`);
      const cmd = command;
      process.stdout.write('    Installing OpenClaw runtime and dependencies... ');
      const res = await VpsProbe.execRemoteWithStdin(primaryTarget, cmd, scriptContent, 180);
      if (res.code !== 0 && ingressDomain !== undefined) throw new Error(`Ingress bootstrap failed with code ${res.code}.`);
      if (res.code === 0) {
        console.log(`${ansi.green}[OK]${ansi.reset}`);
      } else {
        console.log(`${ansi.yellow}[WARN: Code ${res.code}]${ansi.reset}`);
      }
    }

    if (llamaEnabled && secondaryTarget) {
      console.log(`[*] Dispatched bootstrap on Secondary Llama VM (${secondaryTarget})...`);
      const cmd = this.buildProvisioningCommand('llama', provider, modelSettings);
      process.stdout.write('    Configuring llama.cpp AVX-512 engine & model... ');
      const res = await VpsProbe.execRemoteWithStdin(secondaryTarget, cmd, scriptContent, 300);
      if (res.code === 0) {
        console.log(`${ansi.green}[OK]${ansi.reset}`);
      } else {
        console.log(`${ansi.yellow}[WARN: Code ${res.code}]${ansi.reset}`);
      }
    }
  }
}
