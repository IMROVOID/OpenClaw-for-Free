import https from 'https';
import { URL } from 'url';
import { HuggingFaceModelInfo } from './types.js';

export class HuggingFaceInspector {
  static parseRepoId(input: string): { repoId: string; specificFilename?: string } {
    let clean = input.trim().replace(/^https?:\/\/huggingface\.co\//i, '');
    clean = clean.replace(/\/+$/, '');

    // Check for direct resolve URL
    const resolveMatch = clean.match(/^([^\/]+\/[^\/]+)\/resolve\/[^\/]+\/(.+\.gguf)$/i);
    if (resolveMatch) {
      return { repoId: resolveMatch[1], specificFilename: resolveMatch[2] };
    }

    const parts = clean.split('/');
    if (parts.length >= 2) {
      return { repoId: `${parts[0]}/${parts[1]}` };
    }
    return { repoId: clean };
  }

  static async inspectModel(urlOrRepo: string, vpsRamGb = 8): Promise<HuggingFaceModelInfo> {
    const { repoId, specificFilename } = this.parseRepoId(urlOrRepo);
    const apiUrl = `https://huggingface.co/api/models/${repoId}`;

    const rawData = await this.fetchJson(apiUrl);
    const siblings: Array<{ rfilename: string; size?: number }> = rawData.siblings || [];
    const tags: string[] = (rawData.tags || []).map((t: string) => t.toLowerCase());
    const modelIdLower = repoId.toLowerCase();

    // 1. GGUF verification
    const ggufFiles = siblings.filter((s) => s.rfilename.toLowerCase().endsWith('.gguf'));
    const isGguf = ggufFiles.length > 0 || modelIdLower.includes('gguf');

    if (!isGguf) {
      return {
        repoId,
        isGguf: false,
        isMoe: false,
        hasMtp: false,
        quantizations: [],
        minSizeBytes: 0,
        minSizeGb: 0
      };
    }

    // 2. MoE Detection
    const isMoe = tags.includes('moe') ||
      modelIdLower.includes('moe') ||
      modelIdLower.includes('mixtral') ||
      modelIdLower.includes('deepseek-v') ||
      modelIdLower.includes('deepseek-r1') ||
      Boolean(rawData.config?.num_local_experts);

    // 3. MTP Detection
    const hasMtp = modelIdLower.includes('mtp') ||
      tags.includes('mtp') ||
      ggufFiles.some((f) => f.rfilename.toLowerCase().includes('mtp'));

    // 4. Quantization parsing & RAM sizing
    const quantList: HuggingFaceModelInfo['quantizations'] = [];
    for (const file of ggufFiles) {
      const fn = file.rfilename;
      const sizeBytes = file.size || 0;
      const sizeGb = sizeBytes > 0 ? Number((sizeBytes / (1024 ** 3)).toFixed(2)) : 0;
      const quant = this.extractQuantName(fn);
      const downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${fn}`;

      // Reserve at least 1.5GB for OS & KV cache
      const fitsRam = sizeGb > 0 ? (sizeGb + 1.5) <= vpsRamGb : true;

      quantList.push({
        quant,
        filename: fn,
        sizeBytes,
        sizeGb,
        downloadUrl,
        fitsRam
      });
    }

    // Sort by file size ascending
    quantList.sort((a, b) => a.sizeBytes - b.sizeBytes);

    const minSizeBytes = quantList.length > 0 ? quantList[0].sizeBytes : 0;
    const minSizeGb = quantList.length > 0 ? quantList[0].sizeGb : 0;

    // Pick recommended quant: best quant that fits comfortably in RAM
    let recommendedQuant = quantList.length > 0 ? quantList[0].quant : undefined;
    const fittingQuants = quantList.filter((q) => q.fitsRam);
    if (fittingQuants.length > 0) {
      // Prioritize IQ3_M, Q4_K_M, Q4_0, or highest fitting
      const preferred = fittingQuants.find((q) => /IQ3_M|Q4_K_M|Q4_0/i.test(q.quant));
      recommendedQuant = preferred ? preferred.quant : fittingQuants[fittingQuants.length - 1].quant;
    }

    if (specificFilename) {
      const match = quantList.find((q) => q.filename.toLowerCase() === specificFilename.toLowerCase());
      if (match) recommendedQuant = match.quant;
    }

    return {
      repoId,
      isGguf: true,
      isMoe,
      hasMtp,
      quantizations: quantList,
      minSizeBytes,
      minSizeGb,
      recommendedQuant
    };
  }

  private static extractQuantName(filename: string): string {
    const fn = filename.replace(/\.gguf$/i, '');
    const m = fn.match(/(IQ\d_[A-Z0-9_]+|Q\d_[A-Z0-9_]+|FP16|BF16)/i);
    if (m) return m[1].toUpperCase();
    const parts = fn.split('-');
    return parts[parts.length - 1] || 'DEFAULT';
  }

  private static fetchJson(urlStr: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const req = https.get(u, {
        headers: { 'User-Agent': 'OpenClaw-Control-Panel/1.0' },
        timeout: 8000
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(this.fetchJson(res.headers.location));
        }
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Hugging Face API returned HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse Hugging Face JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Hugging Face API connection timed out'));
      });
    });
  }
}
