import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getBootstrapNodeScript } from '../src/control-panel/core/bootstrapLoader.js';
import { OnboardingSteps } from '../src/control-panel/core/onboardingSteps.js';
import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';

const originalRemote = VpsProbe.execRemoteWithStdin;
VpsProbe.execRemoteWithStdin = async () => { throw new Error('Remote execution forbidden in local regression'); };

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const ingress = fs.readFileSync(new URL('../scripts/setup_web_ingress.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(new URL('../scripts/bootstrap_node.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const run = (script: string, args: string[] = []) => spawnSync(bash, ['--noprofile', '--norc', '-s', '--', ...args], {
  input: script, encoding: 'utf8', timeout: 5000,
  env: { ...process.env, BASH_ENV: '', ENV: '' }
});
let failures = 0;
let total = 0;
async function test(name: string, action: () => void | Promise<void>) {
  total++;
  try { await action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}
const local = getBootstrapNodeScript();
const originalRead = fs.readFileSync;
let embedded: string;
try {
  fs.readFileSync = (() => { throw new Error('Simulated missing script assets'); }) as typeof fs.readFileSync;
  embedded = getBootstrapNodeScript();
} finally { fs.readFileSync = originalRead; }

for (const [name, script] of [['source', local], ['embedded', embedded]] as const) {
  await test(`${name}: includes exact ingress script`, () => assert.ok(script.includes(ingress.trim()), 'missing self-contained ingress payload'));
  await test(`${name}: bash syntax`, () => {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-n'], { input: script, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
  await test(`${name}: stdin delivers ingress and propagates failure`, () => {
    const block = script.match(/  if \[ -n "\$\{INGRESS_DOMAIN\}" \]; then[\s\S]*?\n  fi/);
    assert.ok(block, 'missing ingress dispatch');
    assert.match(block[0], /setup_web_ingress/);
    for (const status of [0, 47]) {
      const result = run(`set -euo pipefail\nsetup_web_ingress() { printf 'INGRESS:%s\\n' "$1"; return ${status}; }\nINGRESS_DOMAIN=panel.example.com\n${block[0]}\necho COMPLETE\n`);
      assert.equal(result.status, status, result.stderr);
      assert.match(result.stdout, /INGRESS:panel.example.com/);
      assert.equal(result.stdout.includes('COMPLETE'), status === 0);
    }
  });
}
await test('domain normalized and shell quoted', () => {
  assert.match(OnboardingSteps.buildProvisioningCommand('agent', 'freestyle', undefined, 'https://Panel.Example.com/'), /'--ingress-domain=panel\.example\.com'/);
});
await test('malformed domains rejected before command construction', () => {
  for (const domain of ['', 'bad domain', '-bad.example', 'bad-.example', 'a..example', 'example.com/path', 'example.com:443', 'a'.repeat(64) + '.example', 'user@example.com', 'example.com\n', 'example.com;false', '$(false).example', "example.com'", 'example.com{']) {
    assert.throws(() => OnboardingSteps.buildProvisioningCommand('agent', 'freestyle', undefined, domain), /domain/i, JSON.stringify(domain));
  }
});
await test('shell rejects malformed domain before installers', () => {
  const validation = ingress.split('echo "=========================================================="')[0];
  for (const domain of ['bad domain', 'a..example', 'example.com/path', 'example.com;false']) {
    const result = run(validation, [domain, '--validate-only']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /domain/i);
  }
});
await test('unsupported topology rejected', async () => {
  const build = OnboardingSteps.buildProvisioningCommand as (...args: unknown[]) => string;
  for (const options of [{ openclawPort: 9000 }, { omniroutePort: 9000 }, { llamaPort: 9000 }, { isSeparateVps: true }]) {
    assert.throws(() => build('agent', 'freestyle', undefined, 'panel.example.com', options), /unsupported/i);
  }
  assert.throws(() => build('llama', 'freestyle', undefined, 'panel.example.com'), /ingress/i);
  await assert.rejects(OnboardingSteps.runRemoteProvisioning('unused', 'unused-secondary', 'freestyle', true, undefined, 'panel.example.com'), /unsupported/i);
});
await test('unbundled stdin fails before installers', () => {
  const preflight = source.split('echo "=========================================================="')[0];
  const result = run(preflight, ['--ingress-domain=panel.example.com']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /ingress.*(missing|unavailable)/i);
});
await test('remote bootstrap failure rejects ingress provisioning', async () => {
  VpsProbe.execRemoteWithStdin = async () => ({ code: 47, stdout: '', stderr: 'Ingress failed' });
  await assert.rejects(OnboardingSteps.runRemoteProvisioning('unused', undefined, 'freestyle', false, undefined, 'panel.example.com'), /ingress.*47/i);
});
VpsProbe.execRemoteWithStdin = originalRemote;
console.log(`${total - failures}/${total} passed`);
process.exitCode = failures ? 1 : 0;
