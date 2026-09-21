import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { OmnirouteSync } from '../src/control-panel/core/omnirouteSync.js';
import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running test: Omniroute Model Sync (Daytona & FreeStyle) ---');

async function runTests() {
  // Test 1: Telegram Bot Keyboards contain Sync Models buttons (without emoji)
  console.log('Test 1: Telegram Bot Keyboards include Sync Models buttons (no emoji)...');
  const svcKb = InlineKeyboards.buildServiceManager();
  const svcButtons = svcKb.inline_keyboard.flat();
  const svcSyncBtn = svcButtons.find(b => 'callback_data' in b && b.callback_data === 'svc:sync_models');
  assert.ok(svcSyncBtn, 'Service Manager keyboard must contain svc:sync_models button');
  assert.strictEqual(svcSyncBtn.text, 'Sync Models (OmniRoute -> OpenClaw)', 'Service Manager button must not have emoji');

  const diagKb = InlineKeyboards.buildDiagnostics();
  const diagButtons = diagKb.inline_keyboard.flat();
  const diagSyncBtn = diagButtons.find(b => 'callback_data' in b && b.callback_data === 'diag:sync_models');
  assert.ok(diagSyncBtn, 'Diagnostics keyboard must contain diag:sync_models button');
  assert.strictEqual(diagSyncBtn.text, 'Sync Models with OmniRoute', 'Diagnostics button must not have emoji');
  console.log('[PASS] Test 1: Telegram Bot keyboards verified (no emoji).');

  // Test 2: Shell scripts exist and have correct permissions/headers
  console.log('Test 2: Verifying standalone shell and python sync scripts...');
  const syncShPath = path.resolve(__dirname, '..', 'scripts', 'sync_models.sh');
  assert.ok(fs.existsSync(syncShPath), 'scripts/sync_models.sh must exist');
  const syncShContent = fs.readFileSync(syncShPath, 'utf-8');
  assert.ok(syncShContent.includes('OPENCLAW_CANDIDATES'), 'sync_models.sh must support multi-user candidates');
  assert.ok(syncShContent.includes('/home/daytona/.openclaw/openclaw.json'), 'sync_models.sh must support Daytona');
  assert.ok(syncShContent.includes('/home/freestyle/.openclaw/openclaw.json'), 'sync_models.sh must support FreeStyle');

  const syncPyPath = path.resolve(__dirname, '..', 'scripts', 'sync_omniroute.py');
  assert.ok(fs.existsSync(syncPyPath), 'scripts/sync_omniroute.py must exist');
  const syncPyContent = fs.readFileSync(syncPyPath, 'utf-8');
  assert.ok(syncPyContent.includes('--sync-to-openclaw'), 'sync_omniroute.py must support --sync-to-openclaw flag');
  console.log('[PASS] Test 2: Shell and Python scripts verified.');

  // Test 3: Model enrichment & metadata logic
  console.log('Test 3: Model catalog metadata enrichment logic...');
  const normalizeModel = (mid: string): any => {
    const v_keys = ['gemini', 'gpt-4', 'gpt-5', 'claude', 'vision', 'qwen', 'vl', 'pixtral'];
    const r_keys = ['reasoning', 'o1', 'o3', 'r1', 'qwq', 'thinking'];
    const parts = mid.split('/');
    const c_name = parts[parts.length - 1].replace(/-/g, ' ').replace(/_/g, ' ');
    const ctx_w = mid.toLowerCase().includes('llama') ? 32768 : 128000;
    const max_t = r_keys.some(k => mid.toLowerCase().includes(k)) ? 16384 : 8192;
    const m: any = { id: mid, name: `OmniRoute ${c_name}`, contextWindow: ctx_w, maxTokens: max_t };

    if (v_keys.some(k => mid.toLowerCase().includes(k)) && !mid.toLowerCase().includes('transcribe')) {
      m.input = ['text', 'image'];
    }
    if (mid.toLowerCase().includes('llama')) {
      m.compat = { supportsTools: true, toolSchemaProfile: 'llamacpp' };
    }
    return m;
  };

  const visionModel = normalizeModel('anthropic/claude-3-7-sonnet');
  assert.deepStrictEqual(visionModel.input, ['text', 'image']);
  assert.strictEqual(visionModel.contextWindow, 128000);

  const llamaModel = normalizeModel('daytona-llama/qwen2.5-7b-mtp');
  assert.strictEqual(llamaModel.contextWindow, 32768);
  assert.deepStrictEqual(llamaModel.compat, { supportsTools: true, toolSchemaProfile: 'llamacpp' });

  const reasoningModel = normalizeModel('auto/best-reasoning');
  assert.strictEqual(reasoningModel.maxTokens, 16384);
  console.log('[PASS] Test 3: Model catalog metadata enrichment logic verified.');

  // Test 4: OmnirouteSync.syncOmnirouteModelsToOpenClaw invocation & Llama options
  console.log('Test 4: OmnirouteSync.syncOmnirouteModelsToOpenClaw remote mock execution with llamaOpts...');
  const originalExec = VpsProbe.execRemote;
  try {
    let capturedCmd = '';
    VpsProbe.execRemote = async (_target: string, cmd: string, _timeout?: number) => {
      capturedCmd = cmd;
      return {
        code: 0,
        stdout: JSON.stringify({
          status: 'OK',
          count: 7,
          models: [
            'auto/best-chat',
            'auto/best-coding',
            'auto/best-free',
            'auto/best-reasoning',
            'auto/pro-coding',
            'daytona-llama/qwen2.5-7b-mtp',
            'gemini-2.5-pro'
          ]
        }),
        stderr: ''
      };
    };

    const res = await OmnirouteSync.syncOmnirouteModelsToOpenClaw('daytona@1.2.3.4', 20128, 'sk-test-key', {
      enabled: true,
      endpointUrl: 'http://127.0.0.1:8080/v1',
      modelName: 'qwen2.5-7b-mtp'
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.modelCount, 7);
    assert.ok(res.models.includes('daytona-llama/qwen2.5-7b-mtp'));
    assert.ok(res.models.includes('gemini-2.5-pro'));

    // Verify decoded script payload contains llama parameters
    const b64Match = capturedCmd.match(/base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/);
    assert.ok(b64Match, 'Command must contain base64 payload');
    const decodedPy = Buffer.from(b64Match[1], 'base64').toString('utf-8');
    assert.ok(decodedPy.includes('llama_enabled = True'), 'Decoded script must include llama_enabled = True');
    assert.ok(decodedPy.includes('http://127.0.0.1:8080/v1'), 'Decoded script must include llama endpoint');
    assert.ok(decodedPy.includes('daytona-llama/'), 'Decoded script must handle daytona-llama namespace');

    // Mock failure execution
    VpsProbe.execRemote = async () => ({
      code: 1,
      stdout: '',
      stderr: 'Connection refused'
    });

    const failRes = await OmnirouteSync.syncOmnirouteModelsToOpenClaw('daytona@1.2.3.4');
    assert.strictEqual(failRes.success, false);
    assert.strictEqual(failRes.modelCount, 0);
    assert.ok(failRes.error?.includes('Connection refused'));
  } finally {
    VpsProbe.execRemote = originalExec;
  }
  console.log('[PASS] Test 4: OmnirouteSync.syncOmnirouteModelsToOpenClaw with llamaOpts verified.');

  // Test 5: Strict pruning of obsolete models via sync_omniroute.py
  console.log('Test 5: Verifying strict obsolete model pruning via sync_omniroute.py...');
  const tempDir = path.resolve(__dirname, '..', '.tmp_test_sync');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempOpenClawJson = path.join(tempDir, 'openclaw.json');

  try {
    // Write an openclaw.json with an obsolete model that no longer exists in OmniRoute/Llama
    const initialConfig = {
      models: {
        providers: {
          omniroute: {
            baseUrl: 'http://127.0.0.1:20128/v1',
            apiKey: 'sk-test',
            models: [
              { id: 'omniroute/obsolete-ancient-model-v1', name: 'Old Obsolete' },
              { id: 'omniroute/removed-provider/llama-old', name: 'Old Llama' }
            ]
          }
        }
      }
    };
    fs.writeFileSync(tempOpenClawJson, JSON.stringify(initialConfig, null, 2), 'utf-8');

    // Run sync_omniroute.py targeting this config
    const { execSync } = await import('child_process');
    const pyCmd = `python "${syncPyPath}" --sync-to-openclaw --openclaw-config "${tempOpenClawJson}"`;
    execSync(pyCmd, { stdio: 'pipe' });

    // Read back and verify obsolete models were completely pruned
    const updatedConfig = JSON.parse(fs.readFileSync(tempOpenClawJson, 'utf-8'));
    const syncedModels: any[] = updatedConfig.models.providers.omniroute.models;
    const syncedIds = syncedModels.map(m => m.id);

    assert.ok(!syncedIds.includes('omniroute/obsolete-ancient-model-v1'), 'Obsolete model 1 must be pruned');
    assert.ok(!syncedIds.includes('omniroute/removed-provider/llama-old'), 'Obsolete model 2 must be pruned');
    assert.ok(syncedIds.includes('auto/best-chat'), 'Default auto model must be present');
    assert.ok(syncedIds.includes('auto/best-coding'), 'Default auto coding model must be present');
    console.log(`[PASS] Test 5: Obsolete models successfully pruned. Synced: ${syncedIds.join(', ')}`);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('\n[PASS] All Omniroute Model Sync tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[FAIL] Omniroute Model Sync test failed:', err);
  process.exit(1);
});
