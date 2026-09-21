import { VpsProbe } from './vpsProbe.js';
import { ControlPanelConfig } from './types.js';

export type LogServiceType = 'openclaw' | 'omniroute' | 'xray' | 'llama';

export class VpsLogFetcher {
  static async fetchLogs(
    config: ControlPanelConfig,
    service: LogServiceType,
    lineCount = 50
  ): Promise<{ service: LogServiceType; lines: string[]; target: string }> {
    let target = config.primarySshTarget;
    let cmd = '';

    switch (service) {
      case 'openclaw':
        target = config.primarySshTarget;
        cmd = `journalctl --user -u openclaw-gateway.service -n ${lineCount} --no-pager 2>/dev/null || sudo journalctl -u openclaw -n ${lineCount} --no-pager 2>/dev/null || tail -n ${lineCount} ~/.openclaw/logs/gateway.log 2>/dev/null || tail -n ${lineCount} /var/log/supervisor/openclaw*.log 2>/dev/null || echo "No active OpenClaw logs found."`;
        break;

      case 'omniroute':
        target = config.primarySshTarget;
        cmd = `tail -n ${lineCount} /var/log/supervisor/omniroute*.log 2>/dev/null || cat ~/.omniroute/omniroute.log 2>/dev/null | tail -n ${lineCount} || echo "No active OmniRoute logs found."`;
        break;

      case 'xray':
        target = config.primarySshTarget;
        cmd = `tail -n ${lineCount} /var/log/supervisor/xray*.log 2>/dev/null || cat ~/.xray/xray.log 2>/dev/null | tail -n ${lineCount} || echo "No active Railway Relay (Xray) logs found."`;
        break;

      case 'llama':
        target = config.llama.isSeparateVps
          ? (config.llama.sshTarget || config.secondarySshTarget || config.primarySshTarget)
          : config.primarySshTarget;
        cmd = `tail -n ${lineCount} /var/log/supervisor/llama*.log 2>/dev/null || tail -n ${lineCount} ~/llama.log 2>/dev/null || tail -n ${lineCount} /tmp/llama-server.log 2>/dev/null || echo "No active llama-server logs found."`;
        break;
    }

    const res = await VpsProbe.execRemote(target, cmd, 8);
    const raw = res.code === 0 && res.stdout.trim() ? res.stdout : (res.stderr || 'Unable to retrieve remote service logs.');
    const logLines = raw.split('\n');

    return { service, lines: logLines, target };
  }
}
