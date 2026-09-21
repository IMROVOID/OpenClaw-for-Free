import http from 'http';
import { LlamaSettings, VpsSpecs } from './types.js';
import { VpsProbe } from './vpsProbe.js';
import { LlamaConfigGenerator } from './llamaConfigGenerator.js';

export interface StressTestResult {
  passed: boolean;
  attempts: number;
  finalSettings: LlamaSettings;
  latencyMs: number;
  tokensGenerated: number;
  error?: string;
  logs?: string;
}

export class LlamaStressTester {
  static async runStressTest(
    targetSsh: string,
    initialSettings: LlamaSettings,
    specs: VpsSpecs,
    modelFilePath: string,
    maxAttempts = 3,
    onProgress?: (msg: string) => void
  ): Promise<StressTestResult> {
    let currentSettings = { ...initialSettings };
    let lastError = '';
    let lastLogs = '';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        currentSettings = LlamaConfigGenerator.getAdaptedConfigForRetry(currentSettings, attempt);
        if (onProgress) onProgress(`[RETRY ${attempt}/${maxAttempts}] Adapting config: context=${currentSettings.contextSize}, batch=${currentSettings.batchSize}`);

        // Restart server with adapted config
        const script = LlamaConfigGenerator.generateServerScript(currentSettings, specs, modelFilePath);
        await VpsProbe.execRemote(targetSsh, `cat << 'EOF' > /home/daytona/start-server.sh\n${script}\nEOF\nchmod +x /home/daytona/start-server.sh`);
        await VpsProbe.execRemote(targetSsh, 'bash /home/daytona/stop-server.sh 2>/dev/null || pkill -f llama-server || true');
        await new Promise((r) => setTimeout(r, 1000));
        await VpsProbe.execRemote(targetSsh, 'bash /home/daytona/start-server.sh');
      }

      if (onProgress) onProgress(`Waiting for llama-server initialization on ${targetSsh}...`);

      // Wait up to 30s for /health
      let healthy = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const check = await VpsProbe.execRemote(targetSsh, 'curl -s -m 2 http://127.0.0.1:8080/health || true', 4);
        if (check.stdout.includes('"status":') || check.stdout.includes('ok')) {
          healthy = true;
          break;
        }
      }

      if (!healthy) {
        lastError = 'llama-server did not respond to /health within 30s';
        const logRes = await VpsProbe.execRemote(targetSsh, 'tail -n 25 /home/daytona/llama-server.log 2>/dev/null || true', 5);
        lastLogs = logRes.stdout;
        continue;
      }

      if (onProgress) onProgress('Sending inference stress test request (multi-turn reasoning)...');

      // Send inference payload
      const testPrompt = JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a fast reasoning engine. Answer concisely.' },
          { role: 'user', content: 'Count from 1 to 5 and explain in 1 sentence why 5 is prime.' }
        ],
        max_tokens: 64,
        temperature: 0.2
      });

      const startTime = Date.now();
      const inferRes = await VpsProbe.execRemote(
        targetSsh,
        `curl -s -m 25 -X POST http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d '${testPrompt.replace(/'/g, "'\\''")}'`,
        30
      );
      const latencyMs = Date.now() - startTime;

      if (inferRes.code === 0 && inferRes.stdout.includes('"choices"')) {
        let tokensGenerated = 0;
        try {
          const parsed = JSON.parse(inferRes.stdout);
          tokensGenerated = parsed.usage?.completion_tokens || 20;
        } catch (_) {}

        if (onProgress) onProgress(`[OK] Stress test passed successfully! Generated ${tokensGenerated} tokens in ${latencyMs}ms`);

        return {
          passed: true,
          attempts: attempt + 1,
          finalSettings: currentSettings,
          latencyMs,
          tokensGenerated
        };
      }

      lastError = `Inference failed (exit code ${inferRes.code}): ${inferRes.stderr || inferRes.stdout.slice(0, 100)}`;
      const logRes = await VpsProbe.execRemote(targetSsh, 'tail -n 25 /home/daytona/llama-server.log 2>/dev/null || true', 5);
      lastLogs = logRes.stdout;
    }

    return {
      passed: false,
      attempts: maxAttempts,
      finalSettings: currentSettings,
      latencyMs: 0,
      tokensGenerated: 0,
      error: lastError,
      logs: lastLogs
    };
  }
}
