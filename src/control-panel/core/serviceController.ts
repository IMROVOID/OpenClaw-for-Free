import { VpsProbe } from './vpsProbe.js';
import { ControlPanelConfig } from './types.js';

export type ServiceAction = 'start' | 'stop' | 'restart';
export type ManagedService = 'openclaw' | 'omniroute' | 'xray' | 'llama' | 'all';

export class ServiceController {
  static async executeServiceAction(
    config: ControlPanelConfig,
    service: ManagedService,
    action: ServiceAction
  ): Promise<{ success: boolean; message: string }> {
    if (service === 'llama') {
      const target = config.llama.isSeparateVps
        ? (config.llama.sshTarget || config.secondarySshTarget || config.primarySshTarget)
        : config.primarySshTarget;

      let cmd = `sudo supervisorctl ${action} llama 2>/dev/null`;
      if (action === 'restart') {
        cmd += ' || (pkill -f llama-server; sleep 1; nohup ~/start-server.sh > ~/llama.log 2>&1 &)';
      } else if (action === 'start') {
        cmd += ' || (nohup ~/start-server.sh > ~/llama.log 2>&1 &)';
      } else if (action === 'stop') {
        cmd += ' || pkill -f llama-server';
      }

      const res = await VpsProbe.execRemote(target, cmd, 10);
      const ok = res.code === 0 || res.stdout.includes('started') || res.stdout.includes('stopped');
      return {
        success: ok,
        message: res.stdout.trim() || res.stderr.trim() || `Llama ${action} issued.`
      };
    }

    // Primary services
    const target = config.primarySshTarget;
    let cmd: string;
    if (service === 'openclaw') {
      cmd = `openclaw gateway ${action} 2>/dev/null || systemctl --user ${action} openclaw-gateway.service 2>/dev/null || sudo supervisorctl ${action} openclaw`;
    } else if (service === 'all') {
      cmd = `sudo supervisorctl ${action} all; systemctl --user ${action} openclaw-gateway.service 2>/dev/null || true`;
    } else {
      cmd = `sudo supervisorctl ${action} ${service}`;
    }
    const res = await VpsProbe.execRemote(target, cmd, 10);

    const ok = res.code === 0 || !res.stderr.includes('ERROR');
    return {
      success: ok,
      message: res.stdout.trim() || res.stderr.trim() || `${service} ${action} issued.`
    };
  }

  static async restartAll(config: ControlPanelConfig): Promise<{ success: boolean; message: string }> {
    const resPrimary = await this.executeServiceAction(config, 'all', 'restart');
    if (config.llama.enabled) {
      await this.executeServiceAction(config, 'llama', 'restart');
    }
    return resPrimary;
  }

  static async updateService(
    config: ControlPanelConfig,
    service: ManagedService
  ): Promise<{ success: boolean; message: string }> {
    if (service === 'openclaw') {
      const target = config.primarySshTarget;
      const cmd = 'openclaw update --yes || (sudo npm install -g openclaw@latest && openclaw doctor --fix --yes && (openclaw gateway restart || systemctl --user restart openclaw-gateway.service))';
      const res = await VpsProbe.execRemote(target, cmd, 90);
      const verRes = await VpsProbe.execRemote(target, 'openclaw --version 2>/dev/null || true', 10);
      const ver = verRes.stdout.trim() || 'latest';
      const ok = res.code === 0 || !res.stderr.includes('npm error');
      return {
        success: ok,
        message: ok ? `OpenClaw updated to ${ver} and restarted.` : `Update error: ${res.stderr || res.stdout}`
      };
    }

    if (service === 'omniroute') {
      const target = config.primarySshTarget;
      const cmd = 'sudo npm install -g omniroute@latest && sudo supervisorctl restart omniroute';
      const res = await VpsProbe.execRemote(target, cmd, 60);
      const ok = res.code === 0 || !res.stderr.includes('npm error');
      return {
        success: ok,
        message: ok ? 'OmniRoute updated to latest and restarted.' : `Update error: ${res.stderr || res.stdout}`
      };
    }

    if (service === 'llama') {
      const target = config.llama.isSeparateVps
        ? (config.llama.sshTarget || config.secondarySshTarget || config.primarySshTarget)
        : config.primarySshTarget;
      const res = await VpsProbe.execRemote(target, 'sudo supervisorctl restart llama', 15);
      return {
        success: res.code === 0,
        message: res.code === 0 ? 'Llama server refreshed and restarted.' : `Restart error: ${res.stderr || res.stdout}`
      };
    }

    if (service === 'xray') {
      const target = config.primarySshTarget;
      await VpsProbe.execRemote(target, 'sudo supervisorctl restart xray 2>/dev/null || true', 10);
      return { success: true, message: 'Railway relay daemon restarted.' };
    }

    return { success: false, message: 'Select a valid service to update.' };
  }
}
