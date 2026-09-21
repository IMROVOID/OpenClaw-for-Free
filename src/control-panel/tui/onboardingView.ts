import { ansi, badges } from './ansi.js';
import { Box } from './box.js';
import { ControlPanelConfig, HuggingFaceModelInfo } from '../core/types.js';
import { ProviderDefinition } from '../core/providerValidator.js';

export interface OnboardingHitbox {
  type: 'checkbox' | 'button' | 'quant';
  id: string | number;
  row: number;
  colStart: number;
  colEnd: number;
}

export type OnboardingStep =
  | 'ssh_specs'
  | 'railway_setup'
  | 'providers_select'
  | 'provider_keys'
  | 'llama_setup'
  | 'llama_quant_select'
  | 'complete';

export class OnboardingView {
  static hitboxes: OnboardingHitbox[] = [];

  static renderHeader(stepName: string, stepNum: number, totalSteps: number, boxWidth: number): string[] {
    const lines: string[] = [];
    lines.push(Box.header(`SETUP ASSISTANT [Step ${stepNum}/${totalSteps}: ${stepName}]`, boxWidth, ansi.cyan, ansi.brightCyan + ansi.bold));
    return lines;
  }

  static renderSshSpecsStep(
    target: string,
    specs: { cpuCores: number; ramGb: number; storageGb: number },
    inputBuffer: string,
    activeField: 'target' | 'cores' | 'ram' | 'storage',
    width: number
  ): string[] {
    const boxWidth = Math.min(width, 92);
    const lines = this.renderHeader('Daytona VPS Targets & Specs', 1, 5, boxWidth);

    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`${ansi.bold}Primary SSH Target :${ansi.reset} ${activeField === 'target' ? ansi.brightYellow + (inputBuffer || target) + ansi.reset + ' █' : target}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`${ansi.bold}CPU Cores          :${ansi.reset} ${activeField === 'cores' ? ansi.brightYellow + (inputBuffer || specs.cpuCores) + ansi.reset + ' █' : specs.cpuCores}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`${ansi.bold}RAM (GB)           :${ansi.reset} ${activeField === 'ram' ? ansi.brightYellow + (inputBuffer || specs.ramGb) + ansi.reset + ' █' : specs.ramGb + ' GB'}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`${ansi.bold}Storage (GB)       :${ansi.reset} ${activeField === 'storage' ? ansi.brightYellow + (inputBuffer || specs.storageGb) + ansi.reset + ' █' : specs.storageGb + ' GB'}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[ENTER] Next Field / Confirm  ·  [TAB] Switch Field  ·  [ESC] Cancel', boxWidth, ansi.cyan));
    return lines;
  }

  static renderRailwayStep(enabled: boolean, domain: string, inputBuffer: string, width: number): string[] {
    const boxWidth = Math.min(width, 92);
    const lines = this.renderHeader('Railway Egress & Llama Relay', 2, 5, boxWidth);
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row('Railway Relay provides egress for Discord and public HTTPS for Llama.', boxWidth, ansi.cyan));
    lines.push(Box.row(`Enable Railway Relay: ${enabled ? badges.ok + ' (YES)' : ansi.dim + '[NO]' + ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row(`Relay Target Domain : ${ansi.brightYellow}${inputBuffer || domain}${ansi.reset}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[SPACE] Toggle Yes/No  ·  [ENTER] Confirm Domain & Next  ·  [ESC] Back', boxWidth, ansi.cyan));
    return lines;
  }

  static renderProviderChecklist(
    providers: ProviderDefinition[],
    selectedIds: Set<string>,
    cursorIndex: number,
    width: number,
    startRow = 1
  ): { lines: string[]; hitboxes: OnboardingHitbox[] } {
    this.hitboxes = [];
    const boxWidth = Math.min(width, 92);
    const lines = this.renderHeader('Select AI Providers to Configure', 3, 5, boxWidth);
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row('Select providers to integrate with OmniRoute. Each key will be verified:', boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.divider(boxWidth, ansi.cyan));

    lines.push(Box.row('', boxWidth, ansi.cyan));
    providers.forEach((p, idx) => {
      const isSelected = selectedIds.has(p.id);
      const isHovered = idx === cursorIndex;
      const check = isSelected ? `${ansi.brightGreen}[✔]${ansi.reset}` : `${ansi.dim}[ ]${ansi.reset}`;
      const name = isHovered ? `${ansi.bold}${ansi.brightWhite}${p.name}${ansi.reset}` : p.name;
      const desc = isHovered ? `${ansi.brightWhite}— ${p.description.slice(0, 48)}${ansi.reset}` : `${ansi.dim}— ${p.description.slice(0, 48)}${ansi.reset}`;

      const row = startRow + lines.length;
      this.hitboxes.push({
        type: 'checkbox',
        id: p.id,
        row,
        colStart: 3,
        colEnd: boxWidth - 3
      });

      const bg = isHovered ? ansi.bgSelect : '';
      lines.push(Box.row(` ${check} ${name.padEnd(20)} ${desc}`, boxWidth, ansi.cyan, bg));
    });

    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[SPACE / Click] Toggle Checkbox  ·  [↑/↓] Navigate  ·  [ENTER] Next Step', boxWidth, ansi.cyan));
    return { lines, hitboxes: this.hitboxes };
  }

  static renderKeyPrompt(providerName: string, inputKey: string, statusMsg: string, width: number): string[] {
    const boxWidth = Math.min(width, 92);
    const lines = this.renderHeader(`Enter API Key for ${providerName}`, 4, 5, boxWidth);
    const masked = inputKey.length > 8 ? inputKey.slice(0, 4) + '•'.repeat(inputKey.length - 8) + inputKey.slice(-4) : inputKey;
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`API Key : ${ansi.brightYellow}${masked}${ansi.reset} █`, boxWidth, ansi.cyan));
    lines.push(Box.row(`Status  : ${statusMsg}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[ENTER] Validate & Submit  ·  [S] Skip Provider  ·  [ESC] Back', boxWidth, ansi.cyan));
    return lines;
  }

  static renderLlamaSetup(
    urlInput: string,
    modelInfo: HuggingFaceModelInfo | null,
    statusMsg: string,
    width: number
  ): string[] {
    const boxWidth = Math.min(width, 92);
    const lines = this.renderHeader('llama.cpp & Hugging Face Setup', 5, 5, boxWidth);
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.row(`Model Repo / URL : ${ansi.brightYellow}${urlInput}${ansi.reset} █`, boxWidth, ansi.cyan));

    if (modelInfo) {
      const ggufBadge = modelInfo.isGguf ? badges.ok : badges.error;
      const moeBadge = modelInfo.isMoe ? `${ansi.brightYellow}[MoE Detected]${ansi.reset}` : `${ansi.dim}[Dense Architecture]${ansi.reset}`;
      const mtpBadge = modelInfo.hasMtp ? `${ansi.brightGreen}[MTP Draft Enabled]${ansi.reset}` : `${ansi.dim}[Standard Speculation]${ansi.reset}`;

      lines.push(Box.row('', boxWidth, ansi.cyan));
      lines.push(Box.divider(boxWidth, ansi.cyan, 'MODEL SPECIFICATIONS'));
      lines.push(Box.row('', boxWidth, ansi.cyan));
      lines.push(Box.row(`Format: ${ggufBadge} GGUF Weights    ${moeBadge}    ${mtpBadge}`, boxWidth, ansi.cyan));
      lines.push(Box.row(`Compatible Quantizations Found: ${modelInfo.quantizations.length} files (Min: ${modelInfo.minSizeGb} GB)`, boxWidth, ansi.cyan));
    }

    lines.push(Box.row(`Status: ${statusMsg}`, boxWidth, ansi.cyan));
    lines.push(Box.row('', boxWidth, ansi.cyan));
    lines.push(Box.footer('[ENTER] Inspect Model & Continue  ·  [S] Skip Llama Setup  ·  [ESC] Back', boxWidth, ansi.cyan));
    return lines;
  }
}
