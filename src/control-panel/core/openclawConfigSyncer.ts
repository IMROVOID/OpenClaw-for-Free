import { VpsProbe } from './vpsProbe.js';

export class OpenclawConfigSyncer {
  /**
   * Non-destructively merge gateway token and bot credentials into openclaw.json on remote VPS
   */
  static async sync(
    primaryTarget: string,
    token?: string,
    telegramToken?: string,
    discordToken?: string,
    discordGuildId?: string
  ): Promise<void> {
    if (!primaryTarget) return;

    const payload = JSON.stringify({
      token: token && token.length > 5 ? token : '',
      telegramToken: telegramToken && telegramToken.toLowerCase() !== 'skip' ? telegramToken : '',
      discordToken: discordToken && discordToken.toLowerCase() !== 'skip' ? discordToken : '',
      discordGuildId: discordGuildId && discordGuildId.toLowerCase() !== 'skip' ? discordGuildId : ''
    });

    const pythonCode = `
import json, os, subprocess
params = json.loads('''${payload.replace(/'/g, "'\\''")}''')
paths = [
    '/home/ubuntu/.openclaw/openclaw.json',
    '/root/.openclaw/openclaw.json',
    '/home/daytona/.openclaw/openclaw.json',
    '/home/freestyle/.openclaw/openclaw.json',
    os.path.expanduser('~/.openclaw/openclaw.json')
]

for p in paths:
    if os.path.exists(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                d = json.load(f)
            
            # Non-destructively merge gateway
            if 'gateway' not in d or not isinstance(d['gateway'], dict):
                d['gateway'] = {}
            d['gateway'].pop('token', None)
            if params.get('token'):
                if 'auth' not in d['gateway'] or not isinstance(d['gateway']['auth'], dict):
                    d['gateway']['auth'] = {}
                d['gateway']['auth']['mode'] = 'token'
                d['gateway']['auth']['token'] = params['token']
            
            # Non-destructively merge channels
            if 'channels' not in d or not isinstance(d['channels'], dict):
                d['channels'] = {}
            
            if params.get('telegramToken'):
                if 'telegram' not in d['channels'] or not isinstance(d['channels']['telegram'], dict):
                    d['channels']['telegram'] = {}
                d['channels']['telegram']['enabled'] = True
                d['channels']['telegram']['botToken'] = params['telegramToken']
            
            if params.get('discordToken'):
                if 'discord' not in d['channels'] or not isinstance(d['channels']['discord'], dict):
                    d['channels']['discord'] = {}
                d['channels']['discord']['enabled'] = True
                d['channels']['discord']['token'] = params['discordToken']
                if params.get('discordGuildId'):
                    if 'guilds' not in d['channels']['discord'] or not isinstance(d['channels']['discord']['guilds'], dict):
                        d['channels']['discord']['guilds'] = {}
                    d['channels']['discord']['guilds'][params['discordGuildId']] = {'requireMention': False}
            
            # Maintain proxy settings on Daytona / Xray relay environments
            has_relay = os.path.exists('/home/daytona/.xray/config.json') or os.path.exists('/etc/supervisor/conf.d/xray.conf')
            if has_relay:
                if 'telegram' in d['channels'] and isinstance(d['channels']['telegram'], dict):
                    d['channels']['telegram']['proxy'] = 'http://127.0.0.1:10808'
                    if 'network' not in d['channels']['telegram'] or not isinstance(d['channels']['telegram']['network'], dict):
                        d['channels']['telegram']['network'] = {}
                    d['channels']['telegram']['network']['autoSelectFamily'] = False
                if 'discord' in d['channels'] and isinstance(d['channels']['discord'], dict):
                    d['channels']['discord']['proxy'] = 'http://127.0.0.1:10808'
                    d['channels']['discord'].pop('network', None)
            
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(d, f, indent=2)
            os.chmod(p, 0o600)
        except Exception:
            pass

# Validate config (warn only, do not block restart)
subprocess.call('openclaw config validate 2>/dev/null || true', shell=True)

# Robust restart supporting systemd user sessions over non-interactive SSH, openclaw CLI, and supervisor
restart_cmd = """
export XDG_RUNTIME_DIR="/run/user/$(id -u 2>/dev/null || echo 1000)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u 2>/dev/null || echo 1000)/bus"
sudo supervisorctl restart openclaw 2>/dev/null || \\
supervisorctl restart openclaw 2>/dev/null || \\
openclaw gateway restart 2>/dev/null || \\
systemctl --user restart openclaw-gateway.service 2>/dev/null || \\
systemctl --user restart openclaw-gateway 2>/dev/null || \\
(pkill -f "openclaw" 2>/dev/null; sleep 1; nohup openclaw gateway run --port 18789 --allow-unconfigured >/dev/null 2>&1 &) || true
"""
subprocess.call(restart_cmd, shell=True)
`;

    // Base64 encode to prevent SSH / Windows quote or newline corruption
    const b64 = Buffer.from(pythonCode).toString('base64');
    const cmd = `python3 -c "import base64; exec(base64.b64decode('${b64}').decode('utf-8'))" 2>/dev/null || true`;

    await VpsProbe.execRemote(primaryTarget, cmd, 15);
  }

  /**
   * Reads the active gateway auth token directly from the remote VPS
   */
  static async fetchLiveToken(primaryTarget: string): Promise<string | undefined> {
    if (!primaryTarget) return undefined;
    const pythonCode = `
import json, os
paths = [
    '/home/ubuntu/.openclaw/openclaw.json',
    '/root/.openclaw/openclaw.json',
    '/home/daytona/.openclaw/openclaw.json',
    '/home/freestyle/.openclaw/openclaw.json',
    os.path.expanduser('~/.openclaw/openclaw.json')
]
for p in paths:
    if os.path.exists(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                d = json.load(f)
            t = d.get('gateway', {}).get('auth', {}).get('token') or d.get('gateway', {}).get('token') or d.get('token')
            if t:
                print(t)
                exit(0)
        except Exception:
            pass
`;
    const b64 = Buffer.from(pythonCode).toString('base64');
    const cmd = `python3 -c "import base64; exec(base64.b64decode('${b64}').decode('utf-8'))" 2>/dev/null || openclaw config get gateway.auth.token 2>/dev/null || true`;
    const res = await VpsProbe.execRemote(primaryTarget, cmd, 10);
    const token = (res.stdout || '').trim();
    return token && token.length > 5 ? token : undefined;
  }
}
