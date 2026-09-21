import { LlamaSettings } from './types.js';
import { HuggingFaceInspector } from './huggingfaceInspector.js';
import { ansi, badges } from '../tui/ansi.js';
import { BackStepSignal, isBackInput } from './backSignal.js';

export class CustomModelStep {
  /**
   * Interactive Hugging Face repository inspection & quantization picker
   */
  static async promptCustomModel(
    askFn: (question: string, defaultValue?: string) => Promise<string>,
    targetRamGb = 8
  ): Promise<Partial<LlamaSettings>> {
    console.log(`\n${ansi.cyan}=== Hugging Face Custom GGUF Model Setup ===${ansi.reset}`);
    console.log(`Enter a Hugging Face model repo (e.g. Qwen/Qwen2.5-7B-Instruct-GGUF) or direct .gguf URL.`);
    console.log(`Type ${ansi.bold}'0'${ansi.reset} or ${ansi.bold}'ESC'${ansi.reset} to return to model selection.\n`);

    while (true) {
      const input = await askFn('Hugging Face Repo / GGUF URL (or 0 to go back)');
      const cleanInput = input.trim();
      if (!cleanInput) continue;
      if (isBackInput(cleanInput)) {
        throw new BackStepSignal();
      }

      process.stdout.write(`Inspecting model on Hugging Face... `);
      let info;
      try {
        info = await HuggingFaceInspector.inspectModel(cleanInput, targetRamGb);
      } catch (err: any) {
        console.log(`${ansi.red}[Error: ${err.message || 'Failed to inspect model'}]${ansi.reset}`);
        continue;
      }

      if (!info.isGguf) {
        console.log(`${ansi.yellow}[WARN: Not a GGUF repository]${ansi.reset}`);
        console.log(`The repository ${ansi.bold}${info.repoId}${ansi.reset} contains no .gguf weight files.`);
        console.log(`Please provide a repository containing quantized GGUF models.\n`);
        continue;
      }

      console.log(`${ansi.green}[Verified GGUF]${ansi.reset}`);
      console.log(`\n${ansi.bold}Model Architecture Analysis:${ansi.reset}`);
      console.log(`  Repository    : ${ansi.brightYellow}${info.repoId}${ansi.reset}`);
      console.log(`  Architecture  : ${info.isMoe ? ansi.yellow + 'MoE (Mixture of Experts)' : 'Dense'}${ansi.reset}`);
      console.log(`  MTP Support   : ${info.hasMtp ? ansi.green + 'Supported (Speculative Multi-Token)' : ansi.dim + 'Standard Single-Token'}${ansi.reset}`);
      console.log(`  Target RAM    : ${targetRamGb} GB\n`);

      if (info.quantizations.length === 0) {
        console.log(`${ansi.red}[Error: No quantization files discovered]${ansi.reset}\n`);
        continue;
      }

      console.log(`${ansi.bold}Available Quantizations:${ansi.reset}`);
      let defaultIdx = 1;
      info.quantizations.forEach((q, idx) => {
        const num = idx + 1;
        const fitBadge = q.fitsRam
          ? `${ansi.green}[Fits RAM]${ansi.reset}`
          : `${ansi.red}[Exceeds RAM ${targetRamGb}GB]${ansi.reset}`;
        const recBadge = q.quant === info.recommendedQuant ? ` ${ansi.cyan}${ansi.bold}(Recommended)${ansi.reset}` : '';
        if (q.quant === info.recommendedQuant) defaultIdx = num;
        const sizeStr = q.sizeGb > 0 ? `${q.sizeGb} GB` : 'Unknown size';
        console.log(`  ${num}. ${ansi.bold}${q.quant.padEnd(10)}${ansi.reset} (${sizeStr}) ${fitBadge}${recBadge}`);
      });
      console.log(`  0. Back (or ESC)`);

      console.log('');
      const choice = await askFn('Select quantization number (or 0 to go back)', String(defaultIdx));
      if (isBackInput(choice)) {
        throw new BackStepSignal();
      }
      const chosenIdx = parseInt(choice, 10) - 1;
      const selected = info.quantizations[chosenIdx] || info.quantizations[defaultIdx - 1] || info.quantizations[0];

      if (!selected.fitsRam) {
        console.log(`\n${ansi.yellow}[WARNING] Selected quantization (${selected.quant}, ${selected.sizeGb}GB) exceeds RAM limit (${targetRamGb}GB).${ansi.reset}`);
        const proceed = await askFn('Risk potential Out-Of-Memory error and proceed anyway? (y/N)', 'N');
        if (proceed.toLowerCase() !== 'y') {
          console.log('Re-selecting quantization...\n');
          continue;
        }
      }

      const shortName = info.repoId.split('/').pop() || 'custom-model';
      const cleanModelName = `${shortName} ${selected.quant}`;

      return {
        enabled: true,
        modelName: cleanModelName,
        modelUrl: selected.downloadUrl,
        quantization: selected.quant.toLowerCase(),
        contextSize: 32768,
        batchSize: 512,
        threads: 4,
        enableMtp: info.hasMtp,
        enableFlashAttn: true,
        isMoe: info.isMoe,
        kvCacheQuant: 'q4_0'
      };
    }
  }
}
