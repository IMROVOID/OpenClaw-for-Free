import { DetectedVmConfig } from './types.js';
import { VpsProbe } from './vpsProbe.js';

export class VpsConfigDetector {
  /**
   * Universal POSIX single-line probe command for VM inspection
   */
  static getProbeCommand(): string {
    const lines = [
      'OC_CONF=""',
      'for p in ~/.openclaw/openclaw.json /home/daytona/.openclaw/openclaw.json /home/ubuntu/.openclaw/openclaw.json /root/.openclaw/openclaw.json /home/freestyle/.openclaw/openclaw.json; do',
      '  if [ -f "$p" ]; then OC_CONF="$p"; break; fi;',
      'done',
      'OC_BIN=$(command -v openclaw 2>/dev/null || true)',
      'if [ -z "$OC_BIN" ]; then for b in /usr/local/bin/openclaw /usr/bin/openclaw ~/.npm-global/bin/openclaw; do if [ -x "$b" ]; then OC_BIN="$b"; break; fi; done; fi',
      'OC_TOKEN=""',
      'TG_TOKEN=""',
      'DC_TOKEN=""',
      'DC_GUILD=""',
      'LL_TOP=""',
      'LL_URL=""',
      'LL_MOD=""',
      'if [ -n "$OC_CONF" ]; then',
      '  if command -v python3 >/dev/null 2>&1; then',
      '    OC_TOKEN=$(python3 -c "import json; d=json.load(open(\'$OC_CONF\')); print(d.get(\'gateway\',{}).get(\'auth\',{}).get(\'token\') or d.get(\'gateway\',{}).get(\'token\') or d.get(\'token\') or \'\')" 2>/dev/null || true)',
      '  fi',
      '  if [ -z "$OC_TOKEN" ] && [ -n "$OC_BIN" ]; then',
      '    OC_TOKEN=$($OC_BIN config get gateway.auth.token 2>/dev/null || true)',
      '  fi',
      '  if [ -z "$OC_TOKEN" ]; then',
      '    OC_TOKEN=$(grep -oE \'"token":\\s*"[^"]+"\' "$OC_CONF" 2>/dev/null | head -n 1 | cut -d\'"\' -f4 || true)',
      '  fi',
      '  TG_TOKEN=$(grep -oE \'[0-9]{8,12}:[A-Za-z0-9_-]{30,50}\' "$OC_CONF" 2>/dev/null | head -n 1 || true)',
      '  DC_TOKEN=$(grep -oE \'[A-Za-z0-9_-]{24,28}\\.[A-Za-z0-9_-]{6,7}\\.[A-Za-z0-9_-]{27,38}\' "$OC_CONF" 2>/dev/null | head -n 1 || true)',
      '  DC_GUILD=$(grep -oE \'"guilds":\\s*\\{\\s*"[0-9]{17,20}"\' "$OC_CONF" 2>/dev/null | grep -oE \'[0-9]{17,20}\' | head -n 1 || true)',
      '  if [ -z "$DC_GUILD" ]; then DC_GUILD=$(grep -oE \'"guildId":\\s*"[0-9]{17,20}"\' "$OC_CONF" 2>/dev/null | grep -oE \'[0-9]{17,20}\' | head -n 1 || true); fi;',
      '  LL_URL=$(grep -oE \'"baseUrl":\\s*"[^"]+"\' "$OC_CONF" 2>/dev/null | grep -v 20128 | head -n 1 | cut -d\'"\' -f4 || true)',
      '  if echo "$LL_URL" | grep -qE "127\\.0\\.0\\.1|localhost"; then LL_TOP="same_vm"; elif [ -n "$LL_URL" ]; then LL_TOP="second_vm"; fi;',
      '  LL_MOD=$(grep -oE \'"id":\\s*"[^"]+"\' "$OC_CONF" 2>/dev/null | grep -vE "openclaw|omniroute" | head -n 1 | cut -d\'"\' -f4 || true)',
      'fi',
      'OR_BIN=$(command -v omniroute 2>/dev/null || true)',
      'if [ -z "$OR_BIN" ]; then for b in /usr/local/bin/omniroute /usr/bin/omniroute ~/.npm-global/bin/omniroute /usr/local/share/nvm/current/bin/omniroute /usr/local/nvm/current/bin/omniroute /home/*/.nvm/versions/node/*/bin/omniroute /root/.nvm/versions/node/*/bin/omniroute; do if [ -x "$b" ]; then OR_BIN="$b"; break; fi; done; fi',
      'if [ -z "$OR_BIN" ] && [ -f /etc/supervisor/conf.d/omniroute.conf ]; then OR_BIN=$(grep -oE "command=[^ ]+" /etc/supervisor/conf.d/omniroute.conf 2>/dev/null | cut -d= -f2- || true); fi',
      'OR_DIR=""',
      'for p in ~/.omniroute /home/daytona/.omniroute /home/ubuntu/.omniroute /root/.omniroute /home/freestyle/.omniroute; do',
      '  if [ -d "$p" ]; then OR_DIR="$p"; break; fi;',
      'done',
      'OR_ACTIVE="NO"',
      'if curl -s -m 2 http://127.0.0.1:20128 >/dev/null 2>&1 || curl -s -m 2 -H "Authorization: Bearer sk-omniroute-openclaw-key" http://127.0.0.1:20128/v1/models >/dev/null 2>&1 || pgrep -f "omniroute" >/dev/null 2>&1 || sudo -n supervisorctl status omniroute 2>/dev/null | grep -qi "running" || ss -tlpn 2>/dev/null | grep -q ":20128 " || netstat -tlpn 2>/dev/null | grep -q ":20128 "; then OR_ACTIVE="YES"; fi',
      'OR_DB=""',
      'for p in "$OR_DIR/storage.sqlite" ~/.omniroute/storage.sqlite /home/daytona/.omniroute/storage.sqlite /home/ubuntu/.omniroute/storage.sqlite /root/.omniroute/storage.sqlite /home/freestyle/.omniroute/storage.sqlite; do',
      '  if [ -f "$p" ]; then OR_DB="$p"; break; fi;',
      'done',
      'OR_LL_URL=""',
      'OR_LL_MOD=""',
      'if [ -n "$OR_DB" ]; then',
      '  if command -v sqlite3 >/dev/null 2>&1; then',
      '    OR_LL_URL=$(sqlite3 "$OR_DB" "SELECT provider_specific_data FROM provider_connections;" 2>/dev/null | grep "daytona-llama" | grep -oE \'"baseUrl":\\s*"[^"]+"\' | head -n 1 | cut -d\'"\' -f4 || true)',
      '    OR_LL_MOD=$(sqlite3 "$OR_DB" "SELECT value FROM key_value WHERE namespace=\'customModels\' AND key=\'daytona-llama\';" 2>/dev/null | grep -oE \'"id":\\s*"[^"]+"\' | head -n 1 | cut -d\'"\' -f4 || true)',
      '  fi',
      '  if [ -z "$OR_LL_URL" ] && command -v python3 >/dev/null 2>&1; then',
      '    OR_LL_URL=$(python3 -c "import sqlite3, json; conn=sqlite3.connect(\'$OR_DB\'); c=conn.cursor(); c.execute(\'SELECT provider_specific_data FROM provider_connections\'); rows=c.fetchall(); [print(json.loads(r[0]).get(\'baseUrl\',\'\')) for r in rows if \'daytona-llama\' in (r[0] or \'\')]" 2>/dev/null | head -n 1 || true)',
      '  fi',
      '  if [ -z "$OR_LL_URL" ]; then',
      '    OR_LL_URL=$(grep -a -oE \'https?://[a-zA-Z0-9.-]+:[0-9]+(/v1)?\' "$OR_DB" 2>/dev/null | grep -v 20128 | head -n 1 || true)',
      '  fi',
      '  if [ -z "$LL_URL" ] && [ -n "$OR_LL_URL" ]; then LL_URL="$OR_LL_URL"; fi',
      '  if [ -z "$LL_MOD" ] && [ -n "$OR_LL_MOD" ]; then LL_MOD="$OR_LL_MOD"; fi',
      'fi',
      'if [ -z "$LL_MOD" ] && [ "$OR_ACTIVE" = "YES" ]; then',
      '  OR_MOD_CURL=$(curl -s -m 2 http://127.0.0.1:20128/v1/models 2>/dev/null | grep -oE \'"id":\\s*"daytona-llama/[^"]+"\' | head -n 1 | cut -d\'"\' -f4 || true)',
      '  if [ -n "$OR_MOD_CURL" ]; then LL_MOD="${OR_MOD_CURL#daytona-llama/}"; fi;',
      'fi',
      'XRAY_CONF=""',
      'for p in ~/.xray/config.json /home/daytona/.xray/config.json /home/ubuntu/.xray/config.json /root/.xray/config.json /etc/xray/config.json; do',
      '  if [ -f "$p" ]; then XRAY_CONF="$p"; break; fi;',
      'done',
      'XRAY_ACTIVE="NO"',
      'if sudo -n supervisorctl status xray 2>/dev/null | grep -qi "running" || ss -tlpn 2>/dev/null | grep -q "10808"; then XRAY_ACTIVE="YES"; fi',
      'RW_DOMAIN=""',
      'RW_UUID=""',
      'if [ -n "$XRAY_CONF" ]; then',
      '  RW_DOMAIN=$(grep -oE "[a-zA-Z0-9.-]+\\.up\\.railway\\.app" "$XRAY_CONF" 2>/dev/null | head -n 1 || true)',
      '  RW_UUID=$(grep -oE "[0-9a-fA-F-]{36}" "$XRAY_CONF" 2>/dev/null | head -n 1 || true)',
      'fi',
      'LLAMA_RUN="NO"',
      'LLAMA_INST="NO"',
      'LL_MODEL_PATH=""',
      'LL_MODEL_FILE=""',
      'LL_MODEL_NAME=""',
      'LL_MODEL_SIZE=""',
      'if [ -x /usr/local/bin/llama-server ] || [ -x /usr/bin/llama-server ] || command -v llama-server >/dev/null 2>&1; then LLAMA_INST="YES"; fi',
      'if curl -s -m 2 http://127.0.0.1:8080/health >/dev/null 2>&1 || pgrep -f llama-server >/dev/null 2>&1 || sudo -n supervisorctl status llama 2>/dev/null | grep -qi "running" || tmux has-session -t llama 2>/dev/null; then LLAMA_RUN="YES"; LLAMA_INST="YES"; [ -z "$LL_TOP" ] && LL_TOP="same_vm"; fi',
      'if [ "$LLAMA_RUN" = "YES" ]; then M_JSON=$(curl -s -m 2 http://127.0.0.1:8080/v1/models 2>/dev/null || true); if [ -n "$M_JSON" ]; then RAW_ID=$(echo "$M_JSON" | grep -oE \'"id":\\s*"[^"]+"\' | head -n 1 | cut -d\'"\' -f4 || true); if [ -n "$RAW_ID" ]; then LL_MODEL_NAME=$(basename "$RAW_ID"); LL_MODEL_NAME="${LL_MODEL_NAME%.gguf}"; fi; fi; fi',
      'if [ -z "$LL_MODEL_PATH" ]; then PROC_M=$(ps aux 2>/dev/null | grep -v grep | grep llama-server | grep -oE -- "(-m|--model)[ =]+[^ ]+" | head -n 1 | awk \'{print $2}\' | tr -d \'\\042\\047\' || true); [ -n "$PROC_M" ] && LL_MODEL_PATH="$PROC_M"; fi',
      'if [ -z "$LL_MODEL_PATH" ]; then for s in ~/start-server.sh /home/daytona/start-server.sh /home/ubuntu/start-server.sh /root/start-server.sh /etc/supervisor/conf.d/llama.conf; do if [ -f "$s" ]; then LLAMA_INST="YES"; FM=$(grep -E "(-m|--model)[ =]" "$s" 2>/dev/null | head -n 1 | sed -E "s/.*(-m|--model)[ =]+//" | awk \'{print $1}\' | tr -d \'\\042\\047\' || true); if [ -z "$FM" ] || [ "$FM" = \'$MODEL\' ]; then FM=$(grep -E "^MODEL=" "$s" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d \'\\042\\047\' || true); fi; if [ -z "$FM" ] || [ "$FM" = \'$MODEL_PATH\' ]; then FM=$(grep -E "^MODEL_PATH=" "$s" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d \'\\042\\047\' || true); fi; if [ -n "$FM" ]; then LL_MODEL_PATH="$FM"; break; fi; fi; done; fi',
      'if [ -z "$LL_MODEL_PATH" ] || [ ! -f "$LL_MODEL_PATH" ]; then for d in ~/models /home/daytona/models /home/ubuntu/models /root/models /home/freestyle/models /models; do if [ -d "$d" ]; then LLAMA_INST="YES"; FG=$(ls -1 "$d"/*.gguf 2>/dev/null | head -n 1 || true); if [ -n "$FG" ]; then LL_MODEL_PATH="$FG"; break; fi; fi; done; fi',
      'if [ -z "$LL_MODEL_PATH" ] || [ ! -f "$LL_MODEL_PATH" ]; then DG=$(find /home /root /opt -maxdepth 3 -name "*.gguf" 2>/dev/null | head -n 1 || true); if [ -n "$DG" ]; then LL_MODEL_PATH="$DG"; LLAMA_INST="YES"; fi; fi',
      'if [ -n "$LL_MODEL_PATH" ]; then LL_MODEL_FILE=$(basename "$LL_MODEL_PATH"); [ -f "$LL_MODEL_PATH" ] && LL_MODEL_SIZE=$(ls -lh "$LL_MODEL_PATH" 2>/dev/null | awk \'{print $5}\' || true); if [ -z "$LL_MODEL_NAME" ]; then if echo "$LL_MODEL_FILE" | grep -qi "qwen2.5-7b"; then LL_MODEL_NAME="Qwen 2.5 7B MTP"; elif echo "$LL_MODEL_FILE" | grep -qi "qwen2.5-14b"; then LL_MODEL_NAME="Qwen 2.5 14B Q4_0"; else LL_MODEL_NAME="${LL_MODEL_FILE%.gguf}"; fi; fi; fi',
      'if [ -n "$LL_URL" ]; then',
      '  if echo "$LL_URL" | grep -qE "127\\.0\\.0\\.1|localhost"; then [ -z "$LL_TOP" ] && LL_TOP="same_vm"; else [ -z "$LL_TOP" ] && LL_TOP="second_vm"; fi;',
      '  if [ "$LL_TOP" = "same_vm" ]; then',
      '    LLAMA_INST="YES"',
      '    if curl -s -m 2 "$LL_URL/health" >/dev/null 2>&1 || curl -s -m 2 "$LL_URL/v1/models" >/dev/null 2>&1 || curl -s -m 2 "$LL_URL/models" >/dev/null 2>&1; then LLAMA_RUN="YES"; fi;',
      '  fi',
      'fi',
      '[ -z "$LL_MOD" ] && [ -n "$LL_MODEL_NAME" ] && LL_MOD="$LL_MODEL_NAME"',
      'echo "OC_BIN:${OC_BIN}"',
      'echo "OC_CONF:${OC_CONF}"',
      'echo "OC_TOKEN:${OC_TOKEN}"',
      'echo "TG_TOKEN:${TG_TOKEN}"',
      'echo "DC_TOKEN:${DC_TOKEN}"',
      'echo "DC_GUILD:${DC_GUILD}"',
      'echo "OR_BIN:${OR_BIN}"',
      'echo "OR_DIR:${OR_DIR}"',
      'echo "OR_ACTIVE:${OR_ACTIVE}"',
      'echo "XRAY_CONF:${XRAY_CONF}"',
      'echo "XRAY_ACTIVE:${XRAY_ACTIVE}"',
      'echo "RW_DOMAIN:${RW_DOMAIN}"',
      'echo "RW_UUID:${RW_UUID}"',
      'echo "LLAMA_INST:${LLAMA_INST}"',
      'echo "LLAMA_RUN:${LLAMA_RUN}"',
      'echo "LL_TOP:${LL_TOP}"',
      'echo "LL_URL:${LL_URL}"',
      'echo "LL_MOD:${LL_MOD}"',
      'echo "LL_MODEL_PATH:${LL_MODEL_PATH}"',
      'echo "LL_MODEL_FILE:${LL_MODEL_FILE}"',
      'echo "LL_MODEL_NAME:${LL_MODEL_NAME}"',
      'echo "LL_MODEL_SIZE:${LL_MODEL_SIZE}"'
    ];

    const script = lines.join('\n');
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    return `echo "${b64}" | base64 -d | sh`;
  }

  /**
   * Parse probe stdout stream into DetectedVmConfig
   */
  static parseProbeOutput(stdout: string, reachable = true): DetectedVmConfig {
    const ocBin = stdout.match(/OC_BIN:(.*)/)?.[1]?.trim() || '';
    const ocConf = stdout.match(/OC_CONF:(.*)/)?.[1]?.trim() || '';
    const ocToken = stdout.match(/OC_TOKEN:(.*)/)?.[1]?.trim() || '';
    const tgToken = stdout.match(/TG_TOKEN:(.*)/)?.[1]?.trim() || '';
    const dcToken = stdout.match(/DC_TOKEN:(.*)/)?.[1]?.trim() || '';
    const dcGuild = stdout.match(/DC_GUILD:(.*)/)?.[1]?.trim() || '';
    const orBin = stdout.match(/OR_BIN:(.*)/)?.[1]?.trim() || '';
    const orDir = stdout.match(/OR_DIR:(.*)/)?.[1]?.trim() || '';
    const orActive = stdout.match(/OR_ACTIVE:(.*)/)?.[1]?.trim() === 'YES';
    const xrayConf = stdout.match(/XRAY_CONF:(.*)/)?.[1]?.trim() || '';
    const xrayActive = stdout.match(/XRAY_ACTIVE:(.*)/)?.[1]?.trim() === 'YES';
    const rwDomain = stdout.match(/RW_DOMAIN:(.*)/)?.[1]?.trim() || '';
    const rwUuid = stdout.match(/RW_UUID:(.*)/)?.[1]?.trim() || '';
    const llamaInst = stdout.match(/LLAMA_INST:(.*)/)?.[1]?.trim() === 'YES';
    const llamaRun = stdout.match(/LLAMA_RUN:(.*)/)?.[1]?.trim() === 'YES';
    const llTop = stdout.match(/LL_TOP:(.*)/)?.[1]?.trim() || '';
    const llUrl = stdout.match(/LL_URL:(.*)/)?.[1]?.trim() || '';
    const llMod = stdout.match(/LL_MOD:(.*)/)?.[1]?.trim() || '';
    const llModelPath = stdout.match(/LL_MODEL_PATH:(.*)/)?.[1]?.trim() || '';
    const llModelFile = stdout.match(/LL_MODEL_FILE:(.*)/)?.[1]?.trim() || '';
    const llModelName = stdout.match(/LL_MODEL_NAME:(.*)/)?.[1]?.trim() || '';
    const llModelSize = stdout.match(/LL_MODEL_SIZE:(.*)/)?.[1]?.trim() || '';

    const openclawInstalled = !!(ocBin || ocConf);
    const omnirouteInstalled = !!(orBin || orDir || orActive);
    const railwayRelayConfigured = !!(xrayConf || xrayActive || rwDomain);
    const llamaInstalled = llamaInst || llamaRun || !!llModelPath || (llTop === 'same_vm' && !!llUrl);

    return {
      reachable,
      openclawInstalled,
      openclawToken: ocToken || undefined,
      telegramBotToken: tgToken || undefined,
      discordBotToken: dcToken || undefined,
      discordGuildId: dcGuild || undefined,
      omnirouteInstalled,
      omnirouteActive: orActive,
      railwayRelayConfigured,
      railwayDomain: rwDomain || undefined,
      railwayUuid: rwUuid || undefined,
      llamaInstalled,
      llamaRunning: llamaRun,
      llamaTopology: llTop === 'second_vm' ? 'second_vm' : (llTop === 'same_vm' ? 'same_vm' : undefined),
      llamaEndpoint: llUrl || undefined,
      llamaModel: (() => {
        const raw = llModelName || llMod || (llModelFile ? llModelFile.replace(/\.gguf$/i, '') : '');
        if (!raw) return undefined;
        const parts = raw.split('/');
        return (parts[parts.length - 1] || raw).replace(/\.gguf$/i, '');
      })(),
      llamaModelFile: llModelFile || undefined,
      llamaModelPath: llModelPath || undefined,
      llamaModelSize: llModelSize || undefined
    };
  }

  /**
   * Deep-probe remote VPS to inspect OpenClaw, Bot tokens, Relay, and Llama status
   */
  static async inspect(sshTarget: string): Promise<DetectedVmConfig> {
    if (!sshTarget) {
      return this.emptyConfig(false);
    }

    const cmd = this.getProbeCommand();
    const res = await VpsProbe.execRemote(sshTarget, cmd, 15);
    if (res.code !== 0) {
      return this.emptyConfig(false);
    }

    return this.parseProbeOutput(res.stdout, true);
  }

  /**
   * Targeted probe for Secondary VM (Dedicated LLM)
   */
  static async detectSecondaryLlama(sshTarget: string): Promise<DetectedVmConfig> {
    return this.inspect(sshTarget);
  }

  private static emptyConfig(reachable: boolean): DetectedVmConfig {
    return {
      reachable,
      openclawInstalled: false,
      omnirouteInstalled: false,
      omnirouteActive: false,
      railwayRelayConfigured: false,
      llamaInstalled: false,
      llamaRunning: false
    };
  }
}
