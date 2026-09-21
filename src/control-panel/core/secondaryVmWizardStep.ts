import { CloudProviderType, VpsSpecs } from './types.js';
import { VpsProviderFactory } from './vpsProviderDriver.js';
import { FreestyleApi } from './freestyleApi.js';
import { DaytonaApi } from './daytonaApi.js';
import { ConfigManager } from './configManager.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { ansi } from '../tui/ansi.js';

export interface SecondaryVmResult {
  secondarySshTarget: string;
  specs: VpsSpecs;
  apiKey?: string;
  provider: CloudProviderType;
  secondaryWorkspaceId?: string;
  secondarySlug?: string;
}

export class SecondaryVmWizardStep {
  static async setup(
    ask: (q: string, d?: string, b?: boolean) => Promise<string>,
    defaultProvider: CloudProviderType = 'freestyle',
    freestyleApiKey?: string,
    daytonaApiKey?: string
  ): Promise<SecondaryVmResult> {
    while (true) {
      console.log(`\n${ansi.cyan}=== Dedicated Secondary LLM VM Provider ===${ansi.reset}`);
      console.log(`  1. Freestyle.sh (Recommended — 32GB Disk, Direct Egress) [Default]`);
      console.log(`  2. Daytona Cloud (10GB Disk, Requires Railway Relay)`);
      console.log(`  0. Back (or ESC)\n`);

      const defaultChoice = defaultProvider === 'daytona' ? '2' : '1';
      const provChoice = await ask('Select Secondary VM provider (1-2, or 0 to go back)', defaultChoice);
      if (isBackInput(provChoice)) {
        throw new BackStepSignal();
      }

      const secProvider: CloudProviderType = provChoice === '2' ? 'daytona' : 'freestyle';
      const driver = VpsProviderFactory.getDriver(secProvider === 'freestyle' ? 'freestyle' : 'daytona');

      console.log(`\n${ansi.cyan}=== Setup Dedicated Secondary LLM VM (${driver.displayName}) ===${ansi.reset}`);
      console.log(`  1. Use ${driver.displayName} API Key (Create New or Select Existing) [Default]`);
      console.log(`  2. Direct SSH Key / Target`);
      console.log(`  0. Back (or ESC)\n`);

      const choice = await ask('Select option (1-2, or 0 to go back)', '1');
      if (isBackInput(choice)) {
        continue;
      }

      if (choice === '1') {
        let apiKey = secProvider === 'freestyle' ? freestyleApiKey : daytonaApiKey;
        if (apiKey) {
          const usePrev = await ask(`Use existing ${driver.displayName} API key? (Y/n, or 0 to go back)`, 'Y');
          if (isBackInput(usePrev)) continue;
          if (usePrev.toLowerCase() !== 'y') apiKey = '';
        }

        if (!apiKey) {
          apiKey = await ask(`Enter ${driver.displayName} API Key (or 0 to go back)`);
          if (isBackInput(apiKey)) continue;
          process.stdout.write(`Validating ${driver.displayName} API Key... `);
          const val = await driver.validateApiKey(apiKey);
          if (!val.valid) {
            console.log(`${ansi.red}[Validation failed: ${val.error}]${ansi.reset}`);
            continue;
          }
          console.log(`${ansi.green}[OK: Verified]${ansi.reset}`);
        }

        console.log(`\nSecondary VM Option:`);
        console.log(`  1. Create New VM (openclaw-llama) [Default]`);
        console.log(`  2. Select Existing VM from Account List`);
        console.log(`  0. Back (or ESC)\n`);

        const vmOpt = await ask('Select option (1-2, or 0 to go back)', '1');
        if (isBackInput(vmOpt)) continue;

        if (vmOpt === '2') {
          process.stdout.write(`Fetching workspaces from ${driver.displayName}... `);
          const workspaces = await driver.listExistingWorkspaces(apiKey);
          console.log(`${ansi.green}[OK]${ansi.reset}`);
          if (workspaces.length > 0) {
            console.log(`\nAvailable VMs in account:`);
            workspaces.forEach((vm, i) =>
              console.log(`  ${i + 1}. ${vm.name} (${vm.specs.cpuCores} vCPU, ${vm.specs.ramGb} GB RAM)`)
            );
            console.log(`  0. Back (or ESC)\n`);
            const sIdxStr = await ask('Select Secondary VM number (or 0 to go back)', '1');
            if (isBackInput(sIdxStr)) continue;
            const sIdx = parseInt(sIdxStr, 10) - 1;
            const sVm = workspaces[sIdx] || workspaces[0];

            if (secProvider === 'freestyle') {
              process.stdout.write(`Generating access token for ${sVm.name}... `);
              const tok = await FreestyleApi.createIdentityToken(apiKey, sVm.id || sVm.name);
              if (!tok.token) {
                console.log(`${ansi.red}[Failed: ${tok.error}]${ansi.reset}`);
                continue;
              }
console.log(`${ansi.green}[OK]${ansi.reset}`);
              const target = FreestyleApi.formatSshTarget(sVm.name, tok.token);
              return { secondarySshTarget: target, apiKey, specs: { ...sVm.specs }, provider: secProvider, secondaryWorkspaceId: sVm.id, secondarySlug: sVm.name };
            } else {
              process.stdout.write(`Creating SSH access token for ${sVm.name}... `);
              const sshAccess = await DaytonaApi.createSshAccess(apiKey, sVm.id);
const target = sshAccess.sshTarget || `${sVm.id}@ssh.app.daytona.io`;
              console.log(`${ansi.green}[OK]${ansi.reset}`);
              return { secondarySshTarget: target, apiKey, specs: { ...sVm.specs }, provider: secProvider, secondaryWorkspaceId: sVm.id, secondarySlug: sVm.name };
            }
          }
          console.log(`${ansi.yellow}[Notice: No active VMs found. Provisioning new VM...]${ansi.reset}`);
        }

        process.stdout.write(`Auto-provisioning Secondary VM (openclaw-llama)... `);
        if (secProvider === 'freestyle') {
          const vm = await FreestyleApi.createVm(apiKey, 'openclaw-llama');
          if (!vm.success) {
            console.log(`${ansi.red}[Failed: ${vm.error || 'Could not create VM'}]${ansi.reset}`);
            console.log(`${ansi.yellow}Tip: Free tier accounts may only allow 1 VM. You can select an existing VM or choose Same VM topology.${ansi.reset}\n`);
            continue;
          }
          const tok = await FreestyleApi.createIdentityToken(apiKey, vm.id || vm.slug);
          if (!tok.token) {
            console.log(`${ansi.red}[Failed generating token: ${tok.error}]${ansi.reset}`);
            continue;
          }
const target = FreestyleApi.formatSshTarget(vm.slug, tok.token);
          console.log(`${ansi.green}[SUCCESS]${ansi.reset}`);
          return { secondarySshTarget: target, apiKey, specs: { ...driver.defaultSpecs }, provider: secProvider, secondaryWorkspaceId: vm.id, secondarySlug: vm.slug };
} else {
          const res = await DaytonaApi.provisionWorkspace(apiKey, 'openclaw-llama', driver.defaultSpecs);
          if (!res.success) {
            console.log(`${ansi.red}[Failed: ${res.error || 'Could not provision workspace'}]${ansi.reset}`);
            console.log(`${ansi.yellow}Tip: Check your Daytona quota or select an existing VM.${ansi.reset}\n`);
            continue;
          }
          console.log(`${ansi.green}[SUCCESS]${ansi.reset}`);
          return { secondarySshTarget: res.sshTarget, apiKey, specs: { ...driver.defaultSpecs }, provider: secProvider, secondaryWorkspaceId: res.workspaceId, secondarySlug: 'openclaw-llama' };
        }
      }

      const defaultHint = secProvider === 'freestyle' ? 'openclaw-llama:token@beta-ssh.freestyle.sh' : 'token@ssh.app.daytona.io';
      const sSsh = await ask('Secondary VM SSH Target (or 0 to go back)', defaultHint);
      if (isBackInput(sSsh)) continue;
      let target = ConfigManager.parseSshTarget(sSsh, sSsh);
      if (secProvider === 'daytona' && daytonaApiKey) {
        const resolved = await DaytonaApi.resolveSandbox(daytonaApiKey, target);
        if (resolved.sshTarget) target = resolved.sshTarget;
      }
      return {
        secondarySshTarget: target,
        specs: { ...driver.defaultSpecs },
        provider: secProvider
      };
    }
  }
}
