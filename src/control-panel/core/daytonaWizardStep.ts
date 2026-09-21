import { VpsSpecs } from './types.js';
import { DaytonaApi } from './daytonaApi.js';
import { VpsProviderFactory } from './vpsProviderDriver.js';
import { ConfigManager } from './configManager.js';
import { BackStepSignal, isBackInput } from './backSignal.js';
import { ansi } from '../tui/ansi.js';

export class DaytonaWizardStep {
static async setupPrimary(
    askFn: (question: string, defaultValue?: string, allowBack?: boolean) => Promise<string>,
    existingApiKey?: string
  ): Promise<{ primarySshTarget: string; apiKey?: string; specs: VpsSpecs; primaryWorkspaceId?: string; primarySlug?: string }> {
    const driver = VpsProviderFactory.getDriver('daytona');

    while (true) {
      console.log(`\n${ansi.cyan}[Step 2/7] Daytona Cloud Primary Workspace Setup${ansi.reset}`);
      console.log(`  1. Daytona API Key (Create New Workspace or Select Existing) [Recommended]`);
      console.log(`  2. Direct Daytona SSH Target (<sandbox-id>@ssh.app.daytona.io)`);
      console.log(`  0. Back (or ESC)\n`);

      const choice = await askFn('Select setup method (1-2, or 0 to go back)', '1');
      if (isBackInput(choice)) {
        throw new BackStepSignal();
      }

      if (choice === '1') {
        let apiKey = existingApiKey || '';
        if (!apiKey) {
          console.log(`\n${ansi.yellow}--- Daytona API Key Guidance ---${ansi.reset}`);
          DaytonaApi.getApiKeyGuidance().forEach((s) => console.log(`  ${s}`));
        }
        const enteredKey = await askFn('Enter Daytona API Key (or 0 to go back)', apiKey);
        if (isBackInput(enteredKey)) continue;

        apiKey = enteredKey;
        process.stdout.write('Validating Daytona API Key... ');
        const val = await driver.validateApiKey(apiKey);
        if (!val.valid) {
          console.log(`${ansi.red}[Authentication Failed: ${val.error || 'Invalid API Key'}]${ansi.reset}`);
          const failChoice = await askFn('Select: [1] Re-enter API Key, [2] Switch to Direct SSH, [0] Back', '1');
          if (failChoice === '2') {
            const pSsh = await askFn('Primary Daytona SSH Target (<sandbox-id>@ssh.app.daytona.io)');
            const target = ConfigManager.parseSshTarget(pSsh, pSsh);
            return { primarySshTarget: target, specs: { ...driver.defaultSpecs } };
          }
          if (isBackInput(failChoice)) continue;
          continue;
        }
        console.log(`${ansi.green}[OK: Verified]${ansi.reset}\n`);

        console.log(`Choose Workspace Option:`);
        console.log(`  1. Create New Workspace (Auto-provision openclaw-primary) [Default]`);
        console.log(`  2. Select Existing Workspace from Account List`);
        console.log(`  0. Back (or ESC)\n`);
        const wsOpt = await askFn('Select option (1-2, or 0 to go back)', '1');
        if (isBackInput(wsOpt)) continue;

        if (wsOpt === '2') {
          const workspaces = await driver.listExistingWorkspaces(apiKey);
          if (workspaces.length > 0) {
            console.log(`\nAvailable Workspaces in account:`);
            workspaces.forEach((ws, i) => console.log(`  ${i + 1}. ${ws.name} (${ws.specs.cpuCores} vCPU, ${ws.specs.ramGb} GB RAM)`));
            console.log(`  0. Back (or ESC)\n`);
            const pIdxStr = await askFn('Select Primary Workspace number (or 0 to go back)', '1');
            if (isBackInput(pIdxStr)) continue;
            const pIdx = parseInt(pIdxStr, 10) - 1;
            const pWs = workspaces[pIdx] || workspaces[0];
            process.stdout.write(`Creating SSH access token for ${pWs.name}... `);
            const sshAccess = await DaytonaApi.createSshAccess(apiKey, pWs.id);
            const target = sshAccess.sshTarget || `${pWs.id}@ssh.app.daytona.io`;
console.log(`${ansi.green}[OK]${ansi.reset}`);
            console.log(`  Selected Primary Workspace: ${ansi.brightYellow}${target}${ansi.reset}`);
            return { primarySshTarget: target, apiKey, specs: { ...pWs.specs }, primaryWorkspaceId: pWs.id, primarySlug: pWs.name };
          }
          console.log(`${ansi.yellow}[Notice: No active workspaces found. Auto-provisioning new workspace...]${ansi.reset}`);
        }

process.stdout.write('Auto-provisioning Primary Workspace (openclaw-primary)... ');
        const res = await DaytonaApi.provisionWorkspace(apiKey, 'openclaw-primary', driver.defaultSpecs);
        if (!res.success) {
          console.log(`${ansi.red}[Failed: ${res.error || 'Could not provision workspace'}]${ansi.reset}`);
          console.log(`${ansi.yellow}Tip: Check your Daytona quota or select an existing workspace instead.${ansi.reset}\n`);
          continue;
        }
        console.log(`${ansi.green}[SUCCESS]${ansi.reset}`);
        console.log(`  Primary Workspace Target: ${ansi.brightYellow}${res.sshTarget}${ansi.reset}`);
        return { primarySshTarget: res.sshTarget, apiKey, specs: { ...driver.defaultSpecs }, primaryWorkspaceId: res.workspaceId, primarySlug: 'openclaw-primary' };
      }

      const pSsh = await askFn('Primary Daytona SSH Target (or 0 to go back)', 'id@ssh.app.daytona.io');
      if (isBackInput(pSsh)) continue;
      let target = ConfigManager.parseSshTarget(pSsh, pSsh);
      if (existingApiKey) {
        const resolved = await DaytonaApi.resolveSandbox(existingApiKey, target);
        if (resolved.sshTarget) target = resolved.sshTarget;
      }
      return { primarySshTarget: target, specs: { ...driver.defaultSpecs } };
    }
  }
}
