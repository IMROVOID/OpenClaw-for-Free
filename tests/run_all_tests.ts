import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('  Running Unified Control Panel Automated Test Suite');
console.log('====================================================\n');

const tests = [
  'test_control_panel_state.ts',
  'test_vps_detector.ts',
  'test_daytona_api.ts',
  'test_vps_specs_detection.ts',
  'test_llama_config_generator.ts',
  'test_provider_validator.ts',
  'test_huggingface_inspector.ts',
  'test_freestyle_api.ts',
  'test_provider_drivers.ts',
  'test_onboarding_new_features.ts',
  'test_onboarding_screen.ts',
  'test_secondary_vm_provider.ts',
  'test_endpoint_resolver.ts',
  'test_vm_recovery_detection.ts',
  'test_vps_config_detector.ts',
  'test_tunnel_and_auth.ts',
  'tui_telemetry_test.ts',
  'test_railway_client.ts',
  'test_relay_deployer.ts',
  'test_omniroute_sync.ts',
  'test_telegram_bot_menu.ts',
  'test_telegram_bot_onboarding.ts',
  'test_telegram_bot_recovery.ts',
  'test_telegram_bot_auth.ts',
  'test_vm_ssh_auto_renewer.ts',
  'test_telegram_bot_vm_selection.ts',
  'test_index_auto_reconnect.ts',
  'test_telegram_bot_multi_user.ts',
  'test_user_sqlite_encrypted_db.ts',
  'test_step5_back_and_existing_llama.ts',
  'test_llama_detection_external.ts',
  'test_existing_setup_and_remote_llama.ts',
  'test_secondary_api_key_and_auto_reconnect.ts',
  'test_railway_requirement_evaluator.ts',
  'test_domained_url_resolver.ts',
  'test_railway_web_relay.ts',
  'test_telegram_bot_domained_onboarding.ts',
  'test_onboarding_ingress_step.ts',
  'test_onboarding_fixes.ts',
  'test_secondary_llama_autodetect.ts',
  'test_railway_web_deployer.ts',
  'test_vps_verifier.ts',
  'test_shared_provisioner.ts',
  'test_web_relay_upgrade.ts',
  'test_omniroute_model_sync.ts',
  'test_status_detection_defect.ts',
  'test_railway_autodetect_and_inactive_selection.ts',
  'test_primary_vault.ts'
];

let allPassed = true;

for (const t of tests) {
  const testPath = path.join(__dirname, t);
  console.log(`\n▶ Running ${t}...`);
  try {
    execSync(`npx tsx "${testPath}"`, { stdio: 'inherit' });
  } catch (err: any) {
    console.error(`✘ Test ${t} failed!`);
    allPassed = false;
  }
}

console.log('\n====================================================');
if (allPassed) {
  console.log(`  ✔ ALL ${tests.length} TESTS PASSED SUCCESSFULLY!`);
} else {
  console.error('  ✘ SOME TESTS FAILED. See error output above.');
  process.exit(1);
}
console.log('====================================================\n');
