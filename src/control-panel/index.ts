import { ConfigManager } from './core/configManager.js';
import { OnboardingRunner } from './core/onboardingRunner.js';
import { VpsDetector } from './core/vpsDetector.js';
import { VmRecoveryHandler } from './core/vmRecoveryHandler.js';
import { ControlPanelApp } from './app.js';
import { ansi } from './tui/ansi.js';
import { createInterface } from 'node:readline/promises';
import { configureAccess } from './core/accessSettingsController.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log('OpenClaw Daytona Control Panel v1.0.0 (Unified TUI)');
    process.exit(0);
  }

  const explicitSetup = args.includes('--onboard') || args.includes('--setup');
  const hasConfig = ConfigManager.hasConfig();
  const config = ConfigManager.load();

  if (args.includes('--configure-access')) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await configureAccess(config, async (question, defaultValue) => {
        const answer = await prompt.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `);
        return answer.trim() || defaultValue || '0';
      }, next => ConfigManager.save(next), message => console.log(message));
    } finally {
      prompt.close();
    }
    return;
  }

  if (explicitSetup || !hasConfig) {
    const runner = new OnboardingRunner(config);
    await runner.runOnboarding();
  } else {
    // Existing configuration detected: Auto-login flow
    process.stdout.write(`\r${ansi.cyan}[*] Auto-logging in to Primary VPS (${config.primarySshTarget})...${ansi.reset}`);
    const inspectRes = await VpsDetector.autoReconnect(config);
    const action = VpsDetector.determineAction(inspectRes);

    if (action === 'skip_to_tui') {
      ConfigManager.save(config);
      process.stdout.write(`\r${ansi.green}[OK] Auto-login verified! OpenClaw & OmniRoute ready.${ansi.reset}\n`);
    } else if (action === 'guided_repair') {
      console.log(`\n${ansi.yellow}[!] Connected to VPS (Partial setup detected: ${inspectRes.missingServices.join(', ')}).${ansi.reset}`);
      console.log(`Launching guided repair assistant...\n`);
      const runner = new OnboardingRunner(config);
      await runner.runOnboarding(inspectRes.missingServices);
    } else if (action === 'vm_recovery') {
      await VmRecoveryHandler.promptRecovery(config, inspectRes);
    } else {
      process.stdout.write(`\r${ansi.yellow}[WARN] VPS probe timed out or offline. Entering Control Panel in offline mode...${ansi.reset}\n`);
    }
  }

  // Launch Full Interactive TUI
  const app = new ControlPanelApp();
  await app.start();
}

main().catch((err) => {
  console.error('[FATAL] Control Panel failed to start:', err);
  process.exit(1);
});
