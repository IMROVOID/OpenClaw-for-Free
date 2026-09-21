import { spawn } from 'child_process';
import { ControlPanelConfig } from './types.js';

export class SshTerminalLauncher {
  static buildSshCommand(target: string, label = 'VPS', providerName = 'Cloud'): string {
    const cleanTarget = target.trim().replace(/^ssh\s+/i, '');
    const cleanLabel = label.replace(/['"]/g, '');
    return `title ${providerName} SSH [${cleanLabel}] - ${cleanTarget} && ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 ${cleanTarget}`;
  }

  static openSshWindow(target: string, label = 'VPS', providerName = 'Cloud'): boolean {
    if (!target || !target.trim()) {
      console.warn(`[WARN] SSH target is empty for ${label}`);
      return false;
    }

    const cleanTarget = target.trim().replace(/^ssh\s+/i, '');

    // If Freestyle target, validate slug and token presence
    if (cleanTarget.includes('beta-ssh.freestyle.sh')) {
      const userPart = cleanTarget.split('@')[0];
      if (!userPart || !userPart.includes(':')) {
        console.warn(`[WARN] Invalid Freestyle SSH target: missing slug or token (${cleanTarget})`);
      }
    }

    try {
      const cmdStr = this.buildSshCommand(cleanTarget, label, providerName);
      let child: ReturnType<typeof spawn> | null = null;
      if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmdStr], {
          detached: true,
          stdio: 'ignore'
        });
      } else if (process.platform === 'darwin') {
        child = spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmdStr.replace(/"/g, '\\"')}"`], {
          detached: true,
          stdio: 'ignore'
        });
      } else {
        child = spawn('x-terminal-emulator', ['-e', cmdStr], {
          detached: true,
          stdio: 'ignore'
        });
      }
      if (child) {
        child.on('error', () => {});
        child.unref();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  static launchPrimary(config: ControlPanelConfig): boolean {
    const providerLabel = config.provider === 'freestyle' ? 'Freestyle' : 'Daytona';
    return this.openSshWindow(config.primarySshTarget, 'Primary VPS', providerLabel);
  }

  static launchSecondary(config: ControlPanelConfig): boolean {
    const sec = config.secondarySshTarget ||
      (config.llama.enabled && config.llama.isSeparateVps ? config.llama.sshTarget : undefined);
    if (!sec) return false;
    const providerLabel = config.provider === 'freestyle' ? 'Freestyle' : 'Daytona';
    return this.openSshWindow(sec, 'Secondary Llama VPS', providerLabel);
  }
}
