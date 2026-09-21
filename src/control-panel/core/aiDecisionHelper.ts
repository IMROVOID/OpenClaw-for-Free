import http from 'http';
import { ControlPanelConfig, LlamaSettings } from './types.js';

export interface AiDiagnosisResult {
  recommendedAction: string;
  adaptedSettings?: Partial<LlamaSettings>;
  explanation: string;
}

export class AiDecisionHelper {
  static canUseAi(config: ControlPanelConfig): { ready: boolean; reason?: string } {
    const activeProviders = Object.values(config.providers).filter((p) => p.enabled && p.validated);
    if (activeProviders.length === 0) {
      return { ready: false, reason: 'No active validated AI provider configured with available credit' };
    }
    return { ready: true };
  }

  static async consultErrorDiagnosis(
    errorLogs: string,
    currentSettings: LlamaSettings,
    config: ControlPanelConfig
  ): Promise<AiDiagnosisResult> {
    const readyCheck = this.canUseAi(config);
    if (!readyCheck.ready) {
      return {
        recommendedAction: 'Reduce context size and batch size',
        adaptedSettings: { contextSize: 8192, batchSize: 256 },
        explanation: `AI Assistant unavailable (${readyCheck.reason}). Falling back to conservative heuristics.`
      };
    }

    const prompt = `You are a systems engineer optimizing llama.cpp on a low-RAM Linux VPS.
Analyze the following crash / failure logs:
---
${errorLogs.slice(-1500)}
---
Current settings: Context=${currentSettings.contextSize}, Batch=${currentSettings.batchSize}, KV=${currentSettings.kvCacheQuant}, MTP=${currentSettings.enableMtp}
Diagnose why it crashed (OOM, CUDA/AVX, context overflow, or parameter mismatch).
Respond in valid JSON only with keys:
"recommendedAction": string,
"adaptedSettings": {"contextSize": number, "batchSize": number, "enableMtp": boolean, "kvCacheQuant": "q4_0" | "f16"},
"explanation": string`;

    try {
      const responseText = await this.queryOmniRoute(config.omniroutePort, config.omniroutePassword, prompt);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          recommendedAction: parsed.recommendedAction || 'Adjust memory settings',
          adaptedSettings: parsed.adaptedSettings,
          explanation: parsed.explanation || 'AI analysis completed.'
        };
      }
    } catch (_) {}

    return {
      recommendedAction: 'Lower context window to 8192 and disable MTP',
      adaptedSettings: { contextSize: 8192, batchSize: 256, enableMtp: false },
      explanation: 'Heuristic fallback applied after inference diagnosis.'
    };
  }

  private static queryOmniRoute(port: number, password: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model: 'auto/best-coding',
        messages: [
          { role: 'system', content: 'You are an autonomous systems troubleshooter. Return JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 350
      });

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer sk-omniroute-openclaw-key`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.choices?.[0]?.message?.content || '');
          } catch (e) {
            reject(new Error('Invalid JSON from OmniRoute'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OmniRoute query timed out'));
      });

      req.write(payload);
      req.end();
    });
  }
}
