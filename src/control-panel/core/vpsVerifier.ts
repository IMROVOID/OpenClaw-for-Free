import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VpsProbe } from './vpsProbe.js';

export interface VerificationStepResult {
  step: number;
  name: string;
  passed: boolean;
  message: string;
  info?: boolean;
}

export interface VerificationReport {
  success: boolean;
  totalFailed: number;
  steps: VerificationStepResult[];
  rawOutput: string;
}

const EMBEDDED_VERIFY_SCRIPT = `#!/usr/bin/env bash
# verify_setup.sh - Automated Diagnostics & Health Verification for OpenClaw
set -euo pipefail

FAILED=0

# 1. Check Supervisor Service Status
echo ""
echo "[1/6] Checking Supervisor Daemon Services..."
if sudo supervisorctl status; then
    echo "✔ Supervisor services are active."
else
    echo "✘ Supervisor check failed!"
    FAILED=$((FAILED + 1))
fi

# 2. Validate OpenClaw Configuration File
echo ""
echo "[2/6] Validating OpenClaw Configuration..."
if openclaw config validate; then
    echo "✔ OpenClaw configuration is valid."
else
    echo "✘ OpenClaw configuration validation failed!"
    FAILED=$((FAILED + 1))
fi

# 3. Check Channel Connection Status
echo ""
echo "[3/6] Checking Channels Status (Telegram & Discord)..."
if openclaw channels status; then
    echo "✔ Channels status reported."
else
    echo "✘ Channel status check failed!"
    FAILED=$((FAILED + 1))
fi

# 4. Check OpenClaw Models Count
echo ""
echo "[4/6] Checking Active Models Catalog..."
MODEL_COUNT=$(openclaw models list 2>/dev/null | grep -E '^omniroute/' | wc -l || true)
echo "Total OmniRoute models loaded in OpenClaw: $MODEL_COUNT"
if [ "$MODEL_COUNT" -gt 0 ]; then
    echo "✔ Models catalog is populated."
else
    echo "✘ No models loaded in OpenClaw!"
    FAILED=$((FAILED + 1))
fi

# 5. Check OmniRoute Gateway Health (if active)
echo ""
echo "[5/6] Checking OmniRoute Gateway Endpoint (if applicable)..."
OMNIROUTE_KEY="\${OMNIROUTE_API_KEY:-sk-omniroute-openclaw-key}"
if curl -s -f -H "Authorization: Bearer \${OMNIROUTE_KEY}" http://127.0.0.1:20128/v1/models >/dev/null 2>&1; then
    GATEWAY_COUNT=$(curl -s -H "Authorization: Bearer \${OMNIROUTE_KEY}" http://127.0.0.1:20128/v1/models | jq '.data | length' 2>/dev/null || echo "0")
    echo "✔ OmniRoute is responding with $GATEWAY_COUNT active models."
else
    echo "ℹ OmniRoute not responding or not enabled (port 20128)."
fi

# 6. Check Egress Relay Health (if Xray active)
echo ""
echo "[6/6] Checking Egress Relay & Discord Gateway Tunnel..."
if sudo supervisorctl status xray >/dev/null 2>&1; then
    if curl -s -m 5 -x http://127.0.0.1:10808 -I https://gateway.discord.gg >/dev/null 2>&1; then
        echo "✔ Egress Relay active (Discord Gateway reachable through tunnel)."
    else
        echo "✘ Egress Relay running but tunnel request failed!"
        FAILED=$((FAILED + 1))
    fi
else
    echo "ℹ Xray egress relay not installed or not managed by supervisor."
fi

if [ "$FAILED" -eq 0 ]; then
    echo "All verification tests passed successfully!"
    exit 0
else
    echo "Diagnostics finished with $FAILED failures. Check logs above."
    exit 1
fi
`;

const getDirname = (): string => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

export class VpsVerifier {
  static getVerifyScript(): string {
    const currentDir = getDirname();
    const localPaths = [
      path.resolve(process.cwd(), 'scripts', 'verify_setup.sh'),
      path.resolve(currentDir, '..', '..', '..', 'scripts', 'verify_setup.sh'),
      path.resolve(currentDir, 'scripts', 'verify_setup.sh')
    ];

    for (const p of localPaths) {
      if (fs.existsSync(p)) {
        try {
          return fs.readFileSync(p, 'utf-8');
        } catch (_) {}
      }
    }
    return EMBEDDED_VERIFY_SCRIPT;
  }

  static parseReport(rawOutput: string, exitCode: number): VerificationReport {
    const stepNames = [
      'Supervisor Daemon Services',
      'OpenClaw Configuration',
      'Channel Connections',
      'Active Models Catalog',
      'OmniRoute Gateway',
      'Egress Relay & Tunnel'
    ];

    const steps: VerificationStepResult[] = [];
    const stepRegex = /\[(\d)\/6\]\s+([^\n]+)/g;
    let match: RegExpExecArray | null;
    const indices: Array<{ step: number; title: string; index: number }> = [];

    while ((match = stepRegex.exec(rawOutput)) !== null) {
      indices.push({
        step: parseInt(match[1], 10),
        title: match[2].trim(),
        index: match.index
      });
    }

    for (let i = 0; i < indices.length; i++) {
      const cur = indices[i];
      const nextIndex = i + 1 < indices.length ? indices[i + 1].index : rawOutput.length;
      const sectionText = rawOutput.slice(cur.index, nextIndex);

      const hasFail = sectionText.includes('✘');
      const hasPass = sectionText.includes('✔');
      const hasInfo = sectionText.includes('ℹ');

      let message = '';
      const lines = sectionText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('✔') || trimmed.startsWith('✘') || trimmed.startsWith('ℹ')) {
          message = trimmed;
          break;
        }
      }

      steps.push({
        step: cur.step,
        name: stepNames[cur.step - 1] || cur.title,
        passed: !hasFail,
        message: message || (hasFail ? 'Check failed' : hasPass ? 'Check passed' : 'Skipped/Not applicable'),
        info: hasInfo && !hasFail
      });
    }

    // Fill missing steps if any
    while (steps.length < 6) {
      const idx = steps.length + 1;
      steps.push({
        step: idx,
        name: stepNames[idx - 1] || `Step ${idx}`,
        passed: exitCode === 0,
        message: exitCode === 0 ? 'Passed' : 'Unknown status'
      });
    }

    const totalFailed = steps.filter((s) => !s.passed).length;
    return {
      success: exitCode === 0 && totalFailed === 0,
      totalFailed,
      steps,
      rawOutput
    };
  }

  static async verify(target: string, timeoutSec = 45): Promise<VerificationReport> {
    const cleanTarget = target ? target.trim() : '';
    if (!cleanTarget || (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+(:[0-9]+)?$/.test(cleanTarget) && !/^[a-zA-Z0-9_.-]+$/.test(cleanTarget))) {
      return {
        success: false,
        totalFailed: 1,
        steps: [],
        rawOutput: 'Error: Invalid SSH target format.'
      };
    }

    const script = this.getVerifyScript();
    const res = await VpsProbe.execRemoteWithStdin(target, 'bash -s', script, timeoutSec);
    const combinedOutput = `${res.stdout}\n${res.stderr}`.trim();
    return this.parseReport(combinedOutput, res.code);
  }

  static formatTelegramReport(report: VerificationReport, host: string): string {
    const statusHeader = report.success
      ? '🟢 *ALL CHECKS PASSED*'
      : `🔴 *${report.totalFailed} ${report.totalFailed === 1 ? 'FAILURE' : 'FAILURES'} DETECTED*`;

    let text = `*OPENCLAW & VPS VERIFICATION REPORT*\n` +
      `Host: \`${host}\`\n\n` +
      `*Health Verification Results:*\n`;

    for (const s of report.steps) {
      const badge = s.passed ? (s.info ? 'ℹ️' : '✔') : '✘';
      text += `${badge} *[${s.step}/6] ${s.name}*\n    _${s.message.replace(/^[✔✘ℹ]\s*/, '')}_\n`;
    }

    text += `\n*Overall Status*: ${statusHeader}`;
    if (!report.success) {
      text += `\n\n_Tip: Use the Service Manager to restart or update failed services._`;
    }

    return text;
  }
}
