import assert from 'assert';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';

async function testVpsConfigDetector() {
  console.log('--- Running test: VpsConfigDetector ---');

  // Test 1: Empty SSH target handling
  const emptyRes = await VpsConfigDetector.inspect('');
  assert.strictEqual(emptyRes.reachable, false, 'Empty SSH target should return reachable: false');
  assert.strictEqual(emptyRes.openclawInstalled, false, 'Empty SSH target should return openclawInstalled: false');
  assert.strictEqual(emptyRes.telegramBotToken, undefined, 'Empty SSH target should have undefined telegramBotToken');

  // Test 2: Verify probe command construction
  const probeCmd = VpsConfigDetector.getProbeCommand();
  assert(probeCmd.startsWith('echo "') && probeCmd.includes('base64 -d | sh'), 'Probe command must use base64 decoding pipeline');
  const b64Match = probeCmd.match(/echo "([^"]+)"/);
  assert(b64Match, 'Must contain base64 payload');
  const decoded = Buffer.from(b64Match[1], 'base64').toString('utf8');
  assert(decoded.includes('TG_TOKEN='), 'Probe must check TG_TOKEN');
  assert(decoded.includes('DC_TOKEN='), 'Probe must check DC_TOKEN');
  assert(decoded.includes('OR_ACTIVE='), 'Probe must check OR_ACTIVE');
  assert(decoded.includes('LLAMA_INST='), 'Probe must check LLAMA_INST');
  assert(decoded.includes('storage.sqlite') || decoded.includes('provider_connections'), 'Probe must check OmniRoute SQLite for upstream Llama');

  // Test 3: Parse simulated stdout from remote VM probe (Fully configured VM)
  const mockStdout = [
    'OC_BIN:/usr/local/bin/openclaw',
    'OC_CONF:/home/daytona/.openclaw/openclaw.json',
    'OC_TOKEN:64477d7110f8fe4c1b089704ad69067bc06c8032371f430d',
    'TG_TOKEN:mock-telegram-token-123456789:ABCDEF',
    'DC_TOKEN:mock-discord-token-123456789.ABCDEF.GHIJKL',
    'DC_GUILD:805770150464192522',
    'OR_BIN:/usr/local/bin/omniroute',
    'OR_DIR:/home/daytona/.omniroute',
    'OR_ACTIVE:YES',
    'XRAY_CONF:/etc/xray/config.json',
    'XRAY_ACTIVE:YES',
    'RW_DOMAIN:egress-relay-production.up.railway.app',
    'RW_UUID:e4d2607b-7cb0-44f9-afb3-3ff0cfad6565',
    'LLAMA_INST:YES',
    'LLAMA_RUN:YES',
    'LL_TOP:same_vm',
    'LL_URL:http://127.0.0.1:8080/v1',
    'LL_MOD:qwen2.5-7b-mtp'
  ].join('\n');

  const parsed = VpsConfigDetector.parseProbeOutput(mockStdout);
  assert.strictEqual(parsed.openclawInstalled, true);
  assert.strictEqual(parsed.openclawToken, '64477d7110f8fe4c1b089704ad69067bc06c8032371f430d');
  assert.strictEqual(parsed.telegramBotToken, 'mock-telegram-token-123456789:ABCDEF');
  assert.strictEqual(parsed.discordBotToken, 'mock-discord-token-123456789.ABCDEF.GHIJKL');
  assert.strictEqual(parsed.discordGuildId, '805770150464192522');
  assert.strictEqual(parsed.omnirouteInstalled, true);
  assert.strictEqual(parsed.omnirouteActive, true);
  assert.strictEqual(parsed.railwayRelayConfigured, true);
  assert.strictEqual(parsed.railwayDomain, 'egress-relay-production.up.railway.app');
  assert.strictEqual(parsed.railwayUuid, 'e4d2607b-7cb0-44f9-afb3-3ff0cfad6565');
  assert.strictEqual(parsed.llamaInstalled, true);
  assert.strictEqual(parsed.llamaRunning, true);
  assert.strictEqual(parsed.llamaTopology, 'same_vm');
  assert.strictEqual(parsed.llamaModel, 'qwen2.5-7b-mtp');

  // Test 4: Parse simulated stdout for fresh/unconfigured VM
  const freshStdout = [
    'OC_BIN:',
    'OC_CONF:',
    'OC_TOKEN:',
    'TG_TOKEN:',
    'DC_TOKEN:',
    'DC_GUILD:',
    'OR_BIN:',
    'OR_DIR:',
    'OR_ACTIVE:NO',
    'XRAY_CONF:',
    'XRAY_ACTIVE:NO',
    'RW_DOMAIN:',
    'RW_UUID:',
    'LLAMA_INST:NO',
    'LLAMA_RUN:NO',
    'LL_TOP:',
    'LL_URL:',
    'LL_MOD:'
  ].join('\n');

  const parsedFresh = VpsConfigDetector.parseProbeOutput(freshStdout);
  assert.strictEqual(parsedFresh.openclawInstalled, false);
  assert.strictEqual(parsedFresh.telegramBotToken, undefined);
  assert.strictEqual(parsedFresh.discordBotToken, undefined);
  assert.strictEqual(parsedFresh.omnirouteInstalled, false);
  assert.strictEqual(parsedFresh.omnirouteActive, false);
  assert.strictEqual(parsedFresh.railwayRelayConfigured, false);
  assert.strictEqual(parsedFresh.llamaInstalled, false);

  // Test 5: Dedicated second VM topology parsing with model file details
  const secondVmStdout = [
    'OC_BIN:',
    'OC_CONF:',
    'OC_TOKEN:',
    'TG_TOKEN:',
    'DC_TOKEN:',
    'DC_GUILD:',
    'OR_BIN:',
    'OR_DIR:',
    'OR_ACTIVE:NO',
    'XRAY_CONF:',
    'XRAY_ACTIVE:NO',
    'RW_DOMAIN:',
    'RW_UUID:',
    'LLAMA_INST:YES',
    'LLAMA_RUN:YES',
    'LL_TOP:second_vm',
    'LL_URL:http://127.0.0.1:8080/v1',
    'LL_MOD:Qwen 2.5 7B MTP',
    'LL_MODEL_PATH:/home/daytona/models/qwen2.5-7b-instruct-q4_k_m.gguf',
    'LL_MODEL_FILE:qwen2.5-7b-instruct-q4_k_m.gguf',
    'LL_MODEL_NAME:Qwen 2.5 7B MTP',
    'LL_MODEL_SIZE:4.7G'
  ].join('\n');

  const parsedSecond = VpsConfigDetector.parseProbeOutput(secondVmStdout);
  assert.strictEqual(parsedSecond.llamaInstalled, true);
  assert.strictEqual(parsedSecond.llamaRunning, true);
  assert.strictEqual(parsedSecond.llamaTopology, 'second_vm');
  assert.strictEqual(parsedSecond.llamaModel, 'Qwen 2.5 7B MTP');
  assert.strictEqual(parsedSecond.llamaModelFile, 'qwen2.5-7b-instruct-q4_k_m.gguf');
  assert.strictEqual(parsedSecond.llamaModelPath, '/home/daytona/models/qwen2.5-7b-instruct-q4_k_m.gguf');
  // Test 6: Verify shell script quote balance and syntax dry-run
  const probeScript = Buffer.from(b64Match[1], 'base64').toString('utf8');
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < probeScript.length; i++) {
    const ch = probeScript[i];
    const prev = i > 0 ? probeScript[i - 1] : '';
    if (!inSingle && ch === '"' && prev !== '\\') {
      inDouble = !inDouble;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
    }
  }
  assert.strictEqual(inDouble, false, 'Probe script must not contain unclosed double quotes');
  assert.strictEqual(inSingle, false, 'Probe script must not contain unclosed single quotes');

  try {
    const { execSync } = await import('child_process');
    execSync('bash -n', { input: probeScript, stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (err: any) {
    // If bash is not present on the host OS, skip the external process check
    if (!err.message?.includes('ENOENT')) {
      throw new Error(`Probe command has shell syntax errors: ${err.stderr?.toString() || err.message}`);
    }
  }

  // Test 7: Model name with absolute path and .gguf is sanitized
  const rawPathStdout = [
    'LLAMA_INST:YES',
    'LLAMA_RUN:YES',
    'LL_TOP:second_vm',
    'LL_URL:http://127.0.0.1:8080/v1',
    'LL_MODEL_PATH:/home/daytona/models/Qwen3.5-9B-Instruct-Q4_K_M.gguf',
    'LL_MODEL_FILE:Qwen3.5-9B-Instruct-Q4_K_M.gguf',
    'LL_MODEL_NAME:/home/daytona/models/Qwen3.5-9B-Instruct-Q4_K_M.gguf',
    'LL_MODEL_SIZE:5.4G'
  ].join('\n');
  const parsedRawPath = VpsConfigDetector.parseProbeOutput(rawPathStdout);
  assert.strictEqual(parsedRawPath.llamaModel, 'Qwen3.5-9B-Instruct-Q4_K_M', 'Model name must be stripped of path and .gguf');

  console.log('[PASS] VpsConfigDetector tests completed successfully!');
}

testVpsConfigDetector().catch((err) => {
  console.error('[FAIL] test_vps_config_detector:', err);
  process.exit(1);
});
