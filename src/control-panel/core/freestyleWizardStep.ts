import { VpsSpecs } from './types.js';
import { FreestyleApi } from './freestyleApi.js';
import { VpsProviderFactory } from './vpsProviderDriver.js';
import { ConfigManager } from './configManager.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { ansi } from '../tui/ansi.js';

export class FreestyleWizardStep {
static async setupPrimary(
    askFn: (question: string, defaultValue?: string, allowBack?: boolean) => Promise<string>,
    existingApiKey?: string
  ): Promise<{ primarySshTarget: string; apiKey?: string; specs: VpsSpecs; primaryWorkspaceId?: string; primarySlug?: string }> {
    const driver = VpsProviderFactory.getDriver('freestyle');

    while (true) {
      console.log(`\n${ansi.cyan}[Step 2/7] Freestyle.sh Primary VM Setup${ansi.reset}`);
      console.log(`  1. Freestyle Account API Key (Create New VM or Select Existing) [Recommended]`);
      console.log(`  2. Direct Scoped SSH Target (<slug>:<token>@beta-ssh.freestyle.sh)`);
      console.log(`  0. Back (or ESC)\n`);

      const choice = await askFn('Select setup method (1-2, or 0 to go back)', '1');
      if (isBackInput(choice)) {
        throw new BackStepSignal();
      }

      if (choice === '1') {
        let apiKey = existingApiKey || '';
        if (!apiKey) {
          console.log(`\n${ansi.yellow}--- Freestyle Account API Key Guidance ---${ansi.reset}`);
          console.log(`  1. Open your browser and navigate to: https://freestyle.sh`);
          console.log(`  2. Generate an Account API Key in Dashboard -> Settings -> API Keys`);
          console.log(`     (or run CLI: 'npx freestyle tokens create "openclaw"')`);
          console.log(`  Note: If you have a direct VM SSH token, choose Option 2 instead.`);
        }

        const enteredKey = await askFn('Enter Freestyle API Key (or 0 to go back)', apiKey);
        if (isBackInput(enteredKey)) {
          continue;
        }

        if (enteredKey.includes(':') || enteredKey.includes('@beta-ssh.freestyle.sh')) {
          console.log(`\n${ansi.yellow}[Detected SSH Target format: ${enteredKey}]${ansi.reset}`);
          const useAsSsh = await askFn('Use this as your Direct SSH Target instead? (Y/n)', 'Y');
          if (useAsSsh.toLowerCase() === 'y') {
            const target = ConfigManager.parseSshTarget(enteredKey, enteredKey);
            return { primarySshTarget: target, specs: { ...driver.defaultSpecs } };
          }
        }

        apiKey = enteredKey;
        process.stdout.write('Validating Freestyle API Key... ');
        const val = await driver.validateApiKey(apiKey);
        if (!val.valid) {
          console.log(`${ansi.red}[Authentication Failed: ${val.error || 'Invalid API Key'}]${ansi.reset}`);
          console.log(`\n${ansi.yellow}Troubleshooting:${ansi.reset}`);
          console.log(`  • Ensure you created an Account API Key (via dashboard or 'npx freestyle tokens create').`);
          console.log(`  • Per-VM identity tokens cannot manage account VMs. For existing VMs, use Option 2 (Direct SSH).\n`);

          const failChoice = await askFn('Select: [1] Re-enter API Key, [2] Switch to Direct SSH, [0] Back', '1');
          if (failChoice === '2') {
            const prim = await askFn('Primary VM SSH Target (<slug>:<token>@beta-ssh.freestyle.sh)');
            const target = ConfigManager.parseSshTarget(prim, prim);
            return { primarySshTarget: target, specs: { ...driver.defaultSpecs } };
          }
          if (isBackInput(failChoice)) {
            continue;
          }
          continue;
        }
        console.log(`${ansi.green}[OK: Verified]${ansi.reset}\n`);

        console.log(`Choose VM Option:`);
        console.log(`  1. Create New VM (Auto-provision openclaw-primary) [Default]`);
        console.log(`  2. Select Existing VM from Account List`);
        console.log(`  0. Back (or ESC)\n`);
        const vmOpt = await askFn('Select option (1-2, or 0 to go back)', '1');
        if (isBackInput(vmOpt)) continue;

        if (vmOpt === '2') {
          const workspaces = await driver.listExistingWorkspaces(apiKey);
          if (workspaces.length > 0) {
            console.log(`\nAvailable VMs in account:`);
            workspaces.forEach((vm, i) => console.log(`  ${i + 1}. ${vm.name} (${vm.specs.cpuCores} vCPU, ${vm.specs.ramGb} GB RAM)`));
            console.log(`  0. Back (or ESC)\n`);
            const pIdxStr = await askFn('Select Primary VM number (or 0 to go back)', '1');
            if (isBackInput(pIdxStr)) continue;
            const pIdx = parseInt(pIdxStr, 10) - 1;
            const pVm = workspaces[pIdx] || workspaces[0];
            process.stdout.write(`Generating access token for ${pVm.name}... `);
            const tok = await FreestyleApi.createIdentityToken(apiKey, pVm.id || pVm.name);
            if (!tok.token) {
              console.log(`${ansi.red}[Error generating token: ${tok.error}]${ansi.reset}`);
              continue;
            }
            console.log(`${ansi.green}[OK]${ansi.reset}`);
const target = FreestyleApi.formatSshTarget(pVm.name, tok.token);
            console.log(`  Selected Primary VM: ${ansi.brightYellow}${target}${ansi.reset}`);
            return { primarySshTarget: target, apiKey, specs: { ...pVm.specs }, primaryWorkspaceId: pVm.id, primarySlug: pVm.name };
          }
          console.log(`${ansi.yellow}[Notice: No active VMs found in account. Provisioning new VM...]${ansi.reset}`);
        }

        process.stdout.write('Auto-provisioning Primary VM (openclaw-primary)... ');
        const vm = await FreestyleApi.createVm(apiKey, 'openclaw-primary');
        if (!vm.success) {
          console.log(`${ansi.red}[Failed: ${vm.error || 'Could not create VM'}]${ansi.reset}`);
          console.log(`${ansi.yellow}Tip: Free tier accounts may only allow 1 VM. You can select an existing VM from your account.${ansi.reset}\n`);
          continue;
        }
        const tok = await FreestyleApi.createIdentityToken(apiKey, vm.id || vm.slug);
        if (!tok.token) {
          console.log(`${ansi.red}[Error generating token: ${tok.error}]${ansi.reset}`);
          continue;
        }
const target = FreestyleApi.formatSshTarget(vm.slug, tok.token);
        console.log(`${ansi.green}[SUCCESS]${ansi.reset}`);
        console.log(`  Primary VM Target: ${ansi.brightYellow}${target}${ansi.reset}`);
        return { primarySshTarget: target, apiKey, specs: { ...driver.defaultSpecs }, primaryWorkspaceId: vm.id, primarySlug: vm.slug };
      }

      const prim = await askFn('Primary VM SSH Target (or 0 to go back)', 'openclaw-primary:token@beta-ssh.freestyle.sh');
      if (isBackInput(prim)) continue;
      const target = ConfigManager.parseSshTarget(prim, prim);
      return { primarySshTarget: target, specs: { ...driver.defaultSpecs } };
    }
  }
}
