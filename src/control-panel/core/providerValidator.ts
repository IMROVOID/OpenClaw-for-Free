import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface ProviderDefinition {
  id: string;
  name: string;
  defaultBaseUrl: string;
  validationType: 'openai' | 'anthropic' | 'gemini' | 'openrouter';
  description: string;
}

export const COMMON_PROVIDERS: ProviderDefinition[] = [
  { id: 'anthropic', name: 'Anthropic Direct', defaultBaseUrl: 'https://api.anthropic.com', validationType: 'anthropic', description: 'Claude 3.7 Sonnet, Claude 3.5 Sonnet & Haiku' },
  { id: 'openai', name: 'OpenAI Direct', defaultBaseUrl: 'https://api.openai.com/v1', validationType: 'openai', description: 'GPT-4o, o3-mini, GPT-4.5-preview' },
  { id: 'gemini', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', validationType: 'gemini', description: 'Gemini 2.5 Pro, Flash, Flash-Thinking' },
  { id: 'openrouter', name: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', validationType: 'openrouter', description: 'Aggregator: Claude, DeepSeek-R1, Llama 3.3' },
  { id: 'nvidia', name: 'Nvidia NIM', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', validationType: 'openai', description: 'Nvidia NIM hosted DeepSeek-R1 & Llama 70B' },
  { id: 'deepseek', name: 'DeepSeek Direct', defaultBaseUrl: 'https://api.deepseek.com/v1', validationType: 'openai', description: 'DeepSeek-V3 & DeepSeek-R1 Reasoner' },
  { id: 'groq', name: 'Groq Cloud', defaultBaseUrl: 'https://api.groq.com/openai/v1', validationType: 'openai', description: 'Ultra-fast LPU inference for Llama & Mixtral' },
  { id: 'mistral', name: 'Mistral AI', defaultBaseUrl: 'https://api.mistral.ai/v1', validationType: 'openai', description: 'Mistral Large, Codestral, Pixtral' },
  { id: 'bai', name: 'B.AI Gateway', defaultBaseUrl: 'https://api.b.ai/v1', validationType: 'openai', description: 'Unified B.AI pooled tokens' },
  { id: 'dashscope', name: 'Qwen DashScope', defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', validationType: 'openai', description: 'Alibaba Qwen 2.5, QwQ reasoning models' }
];

export class ProviderValidator {
  static async validateKey(providerId: string, apiKey: string, baseUrl?: string): Promise<{ valid: boolean; error?: string; details?: string }> {
    const p = COMMON_PROVIDERS.find((x) => x.id === providerId);
    const targetUrl = baseUrl || (p ? p.defaultBaseUrl : 'https://api.openai.com/v1');
    const type = p ? p.validationType : 'openai';

    try {
      if (type === 'anthropic') {
        return await this.validateAnthropic(apiKey, targetUrl);
      } else if (type === 'gemini') {
        return await this.validateGemini(apiKey, targetUrl);
      } else if (type === 'openrouter') {
        return await this.validateOpenRouter(apiKey, targetUrl);
      } else {
        return await this.validateOpenAiCompatible(apiKey, targetUrl);
      }
    } catch (err: any) {
      return { valid: false, error: err.message || 'Validation request failed' };
    }
  }

  private static async validateOpenAiCompatible(apiKey: string, baseUrl: string): Promise<{ valid: boolean; error?: string; details?: string }> {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const res = await this.httpRequest(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'OpenClaw-Control-Panel/1.0'
      }
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { valid: true, details: 'OpenAI-compatible models endpoint responded OK' };
    }
    return {
      valid: false,
      error: `HTTP ${res.statusCode}: ${res.body.slice(0, 120)}`
    };
  }

  private static async validateAnthropic(apiKey: string, baseUrl: string): Promise<{ valid: boolean; error?: string; details?: string }> {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const payload = JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }]
    });

    const res = await this.httpRequest(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      },
      body: payload
    });

    if (res.statusCode === 200 || res.statusCode === 400) {
      // 400 may mean credit/model restriction, but key is authenticated
      if (res.body.includes('authentication_error')) {
        return { valid: false, error: 'Invalid Anthropic API Key' };
      }
      return { valid: true, details: 'Anthropic authentication succeeded' };
    }
    return { valid: false, error: `HTTP ${res.statusCode}: ${res.body.slice(0, 120)}` };
  }

  private static async validateGemini(apiKey: string, baseUrl: string): Promise<{ valid: boolean; error?: string; details?: string }> {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await this.httpRequest(endpoint, { method: 'GET' });

    if (res.statusCode === 200) {
      return { valid: true, details: 'Gemini API models list retrieved' };
    }
    return { valid: false, error: `HTTP ${res.statusCode}: ${res.body.slice(0, 120)}` };
  }

  private static async validateOpenRouter(apiKey: string, baseUrl: string): Promise<{ valid: boolean; error?: string; details?: string }> {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/auth/key`;
    const res = await this.httpRequest(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'OpenClaw-Control-Panel/1.0'
      }
    });

    if (res.statusCode === 200) {
      try {
        const data = JSON.parse(res.body);
        const credit = data.data?.limit ? `$${data.data.usage}/${data.data.limit}` : 'Active';
        return { valid: true, details: `OpenRouter key verified (${credit})` };
      } catch (_) {
        return { valid: true, details: 'OpenRouter key verified' };
      }
    }
    return { valid: false, error: `HTTP ${res.statusCode}: ${res.body.slice(0, 120)}` };
  }

  private static httpRequest(urlStr: string, options: { method?: string; headers?: Record<string, any>; body?: string }): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(u, {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 6000
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body: data });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Network request timed out (6s)'));
      });

      if (options.body) req.write(options.body);
      req.end();
    });
  }
}
