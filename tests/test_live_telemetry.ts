import { VpsProbe } from '../src/control-panel/core/vpsProbe.js';

async function main() {
  console.log('Testing Primary VM Telemetry...');
  const prim = await VpsProbe.queryVpsTelemetry(
    'openclaw-primary:X6i7KNBba1WyMQ2X.4URvNGDE7Ddfrxop@beta-ssh.freestyle.sh',
    true,
    'Primary'
  );
  console.log('Primary Services:', prim.services.map((s) => `${s.name} (${s.status})`));
  console.log('Primary Hardware:', prim.hardware);

  console.log('\nTesting Secondary VM Telemetry...');
  const sec = await VpsProbe.queryVpsTelemetry(
    'openclaw-llama:4prCb539xYpuQcFn.FxPMezeLiJ1s8UeV@beta-ssh.freestyle.sh',
    false,
    'Secondary'
  );
  console.log('Secondary Services:', sec.services.map((s) => `${s.name} (${s.status})`));
  console.log('Secondary Hardware:', sec.hardware);
}

main().catch(console.error);
