import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { PrimaryVault, PrimaryVaultSnapshot, VaultLogCategory, VaultLogEntry } from '../src/control-panel/core/primaryVault.js';
import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';

function buildMockConfig(): ControlPanelConfig {
  return {
    provider: 'daytona',
    secondaryProvider: 'daytona',
    daytonaApiKey: 'PRIMARY_KEY_SECRET',
    secondaryDaytonaApiKey: 'SECONDARY_KEY_SECRET',
    freestyleApiKey: 'FS_KEY_SECRET',
    primarySshTarget: 'user@ssh.app.daytona.io:2222',
    secondarySshTarget: 'user@llama.app.daytona.io:2222',
    daytonaPrimaryWorkspaceId: 'ws-primary-1',
    daytonaSecondaryWorkspaceId: 'ws-secondary-1',
    openclawPort: 18789,
    omniroutePort: 20128,
    llamaPort: 8080,
    openclawToken: 'gateway-token-secret',
    omniroutePassword: 'omniroute-pw-secret',
    vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 32 },
    railwayDomain: 'relay.example.com',
    railwayUuid: 'relay-uuid-1',
    railwayApiKey: 'railway-key-secret',
    publicBaseDomain: 'https://panel.example.com',
    providers: {
      openai: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'PROVIDER_KEY_SECRET', enabled: true, validated: true }
    },
    llama: {
      enabled: true,
      isSeparateVps: true,
      sshTarget: 'user@llama.app.daytona.io:2222',
      modelUrl: 'https://huggingface.co/test/model.gguf',
      modelName: 'Qwen 2.5 7B',
      quantization: 'q4_k_m',
      contextSize: 32768,
      batchSize: 512,
      threads: 4,
      enableMtp: true,
      enableFlashAttn: true,
      isMoe: false,
      kvCacheQuant: 'q4_0',
      railwayEndpointUrl: 'https://relay.example.com/llama/v1',
      activeEndpointUrl: 'https://relay.example.com/llama/v1'
    }
  };
}

async function runTests(): Promise<void> {
  console.log('--- Running test: PrimaryVault (Primary-VM credential vault) ---');

  // 1. Snapshot construction keeps every category needed for remote management.
  const cfg = buildMockConfig();
  const snap = PrimaryVault.buildSnapshot(cfg, 1234567);
  assert.strictEqual(snap.version, 1, 'Snapshot version must be 1');
  assert.strictEqual(snap.userId, '1234567');
  assert.strictEqual(snap.vms.primarySshTarget, 'user@ssh.app.daytona.io:2222');
  assert.strictEqual(snap.vms.secondarySshTarget, 'user@llama.app.daytona.io:2222');
  assert.strictEqual(snap.vms.primaryWorkspaceId, 'ws-primary-1');
  assert.strictEqual(snap.vms.secondaryWorkspaceId, 'ws-secondary-1');
  assert.strictEqual(snap.credentials.daytonaApiKey, 'PRIMARY_KEY_SECRET');
  assert.strictEqual(snap.credentials.secondaryDaytonaApiKey, 'SECONDARY_KEY_SECRET');
  assert.strictEqual(snap.credentials.railwayApiKey, 'railway-key-secret');
  assert.strictEqual(snap.credentials.telegramBotToken, undefined, 'telegram token only when provided');
  assert.strictEqual(snap.connections.railwayDomain, 'relay.example.com');
  assert.strictEqual(snap.llama.modelName, 'Qwen 2.5 7B');
  assert.deepStrictEqual(snap.providers.openai.apiKey, 'PROVIDER_KEY_SECRET');

  // 2. applySnapshotToLocal must drop secondary secrets & secondary SSH — local keeps primary connectivity only.
  const pulled = PrimaryVault.applySnapshotToLocal(snap, {
    ...cfg,
    secondarySshTarget: undefined,
    daytonaApiKey: undefined,
    secondaryDaytonaApiKey: undefined
  });
  assert.strictEqual(pulled.primarySshTarget, 'user@ssh.app.daytona.io:2222', 'local must keep primary SSH target');
  assert.strictEqual(pulled.openclawToken, 'gateway-token-secret', 'local keeps gateway token to reach primary');
  assert.strictEqual(pulled.secondarySshTarget, undefined, 'local must NOT persist secondary SSH target');
  assert.strictEqual(pulled.daytonaApiKey, undefined, 'local must NOT persist provider API key');
  assert.strictEqual(pulled.secondaryDaytonaApiKey, undefined, 'local must NOT persist secondary API key');
  assert.strictEqual(pulled.llama.sshTarget, '', 'local llama SSH target must be blanked');
  assert.strictEqual(pulled.llama.activeEndpointUrl, 'https://relay.example.com/llama/v1', 'connection info preserved');

  // 3. Log mirroring is categorized, capped and sanitized.
  let cappedSnap = PrimaryVault.buildSnapshot(cfg, 1234567);
  for (let i = 0; i < 600; i++) {
    cappedSnap = PrimaryVault.appendLog(cappedSnap, 'provision', `provision event ${i}`);
  }
  assert.ok(cappedSnap.logs.length <= 500, 'vault logs must cap at 500 entries');
  assert.ok(cappedSnap.logs.length === 500, 'vault logs should hold the last 500 entries');

  const leaked = PrimaryVault.appendLog(
    cappedSnap,
    'auth',
    'login token=sk_super_secret_12345 persisted for user'
  );
  const authEntry = leaked.logs[leaked.logs.length - 1];
  assert.strictEqual(authEntry.category, 'auth');
  assert.ok(!authEntry.message.includes('sk_super_secret_12345'), 'log entries must redact leaked secrets');
  assert.ok(authEntry.message.includes('[REDACTED]'), 'redaction marker must appear');

  // 4. Bootstrap script must be idempotent + self-contained (no manual sqlite install).
  const bootstrap = PrimaryVault.getBootstrapProvisionScript();
  assert.ok(bootstrap.includes('mkdir -p'), 'bootstrap must create the vault directory');
  assert.ok(bootstrap.includes('sqlite3'), 'bootstrap must install/verify sqlite3');
  assert.ok(bootstrap.includes('VAULT_BOOTSTRAP_OK'), 'bootstrap must report completion');
  assert.ok(bootstrap.includes('CREATE TABLE IF NOT EXISTS'), 'bootstrap must create schema idempotently');
  const matches = bootstrap.match(/chmod 700/g) || [];
  assert.ok(matches.length >= 1, 'bootstrap must lock down the vault directory');

  // 5. pushSnapshot: no error and correct remote command when SSH succeeds.
  let pushedPayload = '';
  const origExecRemote = VpsProbe.execRemote;
  VpsProbe.execRemote = async (target: string, command: string, _timeoutSec?: number) => {
    assert.strictEqual(target, 'user@ssh.app.daytona.io:2222');
    const m = command.match(/echo '([A-Za-z0-9+/=]+)' \| base64 -d/);
    if (m) {
      pushedPayload = Buffer.from(m[1], 'base64').toString('utf-8');
    }
    return { stdout: '', stderr: '', code: 0 };
  };
  try {
    const pushRes = await PrimaryVault.pushSnapshot('user@ssh.app.daytona.io:2222', snap);
    assert.strictEqual(pushRes.success, true, 'push must succeed on SSH code 0');
  } finally {
    VpsProbe.execRemote = origExecRemote;
  }
  const parsed = JSON.parse(pushedPayload) as PrimaryVaultSnapshot;
  assert.strictEqual(parsed.credentials.daytonaApiKey, 'PRIMARY_KEY_SECRET');
  assert.strictEqual(parsed.credentials.secondaryDaytonaApiKey, 'SECONDARY_KEY_SECRET');
  assert.strictEqual(parsed.vms.secondarySshTarget, 'user@llama.app.daytona.io:2222');

  // 6. pushSnapshot: missing primary target must fail closed.
  const badPush = await PrimaryVault.pushSnapshot('', snap);
  assert.strictEqual(badPush.success, false, 'push without primary target must fail');

  // 7. pullSnapshot: valid remote payload parses.
  const origExecRemote2 = VpsProbe.execRemote;
  VpsProbe.execRemote = async (target: string, _command: string, _timeoutSec?: number) => {
    assert.strictEqual(target, 'user@ssh.app.daytona.io:2222');
    return { stdout: JSON.stringify(snap), stderr: '', code: 0 };
  };
  try {
    const pullRes = await PrimaryVault.pullSnapshot('user@ssh.app.daytona.io:2222');
    assert.strictEqual(pullRes.success, true, 'pull must succeed on valid payload');
    assert.strictEqual(pullRes.snapshot!.vms.secondarySshTarget, 'user@llama.app.daytona.io:2222');
  } finally {
    VpsProbe.execRemote = origExecRemote2;
  }

  // 8. pullSnapshot: missing vault is a clean failure, not a crash.
  const origExecRemote3 = VpsProbe.execRemote;
  VpsProbe.execRemote = async () => ({ stdout: 'VAULT_MISSING\n', stderr: '', code: 0 });
  try {
    const missing = await PrimaryVault.pullSnapshot('user@ssh.app.daytona.io:2222');
    assert.strictEqual(missing.success, false, 'missing vault must report failure');
  } finally {
    VpsProbe.execRemote = origExecRemote3;
  }

  // 9. pushSnapshot errors must never leak secrets into the returned error.
  const origExecRemote4 = VpsProbe.execRemote;
  VpsProbe.execRemote = async () => ({ stdout: '', stderr: 'denied: key=SUPER_SECRET_LEAK', code: 255 });
  try {
    const failed = await PrimaryVault.pushSnapshot('user@ssh.app.daytona.io:2222', snap);
    assert.strictEqual(failed.success, false, 'failed SSH must fail the push');
    assert.ok(!failed.error!.includes('SUPER_SECRET_LEAK'), 'push error must redact secrets');
  } finally {
    VpsProbe.execRemote = origExecRemote4;
  }

  // 10. No local artifact must be created for the vault during these operations.
  const localVaultDir = path.join(process.cwd(), 'data', 'telegram', 'vault');
  assert.ok(!fs.existsSync(localVaultDir), 'vault payload must never be written to the local bot data dir');

  // 11. ensureBootstrap is idempotent + returns success when the primary prints the marker.
  PrimaryVault.capture('provision', 'provisioning started');
  const origExecRemote5 = VpsProbe.execRemote;
  let bootstrapCalls = 0;
  VpsProbe.execRemote = async () => {
    bootstrapCalls++;
    return { stdout: 'VAULT_SQLITE_OK\nVAULT_BOOTSTRAP_OK\n', stderr: '', code: 0 };
  };
  try {
    const ok1 = await PrimaryVault.ensureBootstrap('user@ssh.app.daytona.io:2222');
    const ok2 = await PrimaryVault.ensureBootstrap('user@ssh.app.daytona.io:2222');
    assert.strictEqual(ok1, true, 'first bootstrap must succeed');
    assert.strictEqual(ok2, true, 'second bootstrap must be idempotent');
    assert.strictEqual(bootstrapCalls, 2, 'ensureBootstrap must run the script on each call');
  } finally {
    VpsProbe.execRemote = origExecRemote5;
  }

  // 12. Pending categorized logs flush into the snapshot and reset afterwards.
  assert.ok(PrimaryVault.loadPendingLogs().length > 0, 'captured logs must be buffered');
  const flushedSnap = PrimaryVault.buildSnapshot(cfg, 1234567, PrimaryVault.loadPendingLogs());
  assert.ok(flushedSnap.logs.length > 0, 'snapshot must include captured categorized logs');
  assert.strictEqual(flushedSnap.logs[flushedSnap.logs.length - 1].category, 'provision');
  PrimaryVault.clearPendingLogs();
  assert.strictEqual(PrimaryVault.loadPendingLogs().length, 0, 'pending logs must reset after flush');

  // 13. Missing primary target fails closed for bootstrap too.
  assert.strictEqual(await PrimaryVault.ensureBootstrap(''), false, 'bootstrap without a target must fail');

  console.log('  [OK] PrimaryVault snapshot / apply / logs / push / pull all verified.');
}

await runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
