import { ControlPanelConfig, ProviderConfig } from './types.js';
import { VpsProbe } from './vpsProbe.js';

export class OmnirouteSync {
  static async syncProvidersToRemoteVps(
    targetSsh: string,
    providers: Record<string, ProviderConfig>,
    onProgress?: (msg: string) => void
  ): Promise<{ success: boolean; syncedCount: number; error?: string }> {
    const activeProviders = Object.values(providers).filter((p) => p.enabled && p.apiKey);
    if (activeProviders.length === 0) {
      return { success: true, syncedCount: 0 };
    }

    if (onProgress) onProgress(`Synchronizing ${activeProviders.length} providers to OmniRoute storage on ${targetSsh}...`);

    // Prepare Python script payload to update ~/.omniroute/storage.sqlite
    const payload = JSON.stringify(activeProviders);
    const pyScript = `
import sqlite3, json, os
db_path = os.path.expanduser('~/.omniroute/storage.sqlite')
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    providers = json.loads(${JSON.stringify(payload)})
    for p in providers:
        c.execute('INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)',
                  ('providers', p['id'], json.dumps(p)))
    conn.commit()
    conn.close()
    print('SYNC_OK')
else:
    print('DB_NOT_FOUND')
`;

    const b64 = Buffer.from(pyScript, 'utf-8').toString('base64');
    const pythonCmd = `python3 -c "import base64; exec(base64.b64decode('${b64}').decode('utf-8'))"`;

    const res = await VpsProbe.execRemote(targetSsh, pythonCmd, 10);
    if (res.code === 0 && res.stdout.includes('SYNC_OK')) {
      // Reload or restart omniroute service to pick up changes
      await VpsProbe.execRemote(targetSsh, 'sudo supervisorctl restart omniroute 2>/dev/null || true', 8);
      return { success: true, syncedCount: activeProviders.length };
    }

    return {
      success: false,
      syncedCount: 0,
      error: res.stderr || res.stdout.trim() || 'Failed to sync to OmniRoute SQLite'
    };
  }

  static async registerLlamaInOpenClaw(
    targetSsh: string,
    endpointUrl: string,
    modelName: string,
    _apiKey = 'sk-llama-local'
  ): Promise<boolean> {
    const rawEndpoint = endpointUrl.replace(/\/+$/, '');
    const v1Endpoint = rawEndpoint.endsWith('/v1') ? rawEndpoint : `${rawEndpoint}/v1`;
    const cleanModel = modelName.split('/').pop() || 'qwen2.5-7b-mtp';
    const fullModelId = `daytona-llama/${cleanModel}`;

    const pyScript = `
import sqlite3, json, os, uuid, datetime

endpoint = ${JSON.stringify(v1Endpoint)}
clean_model = ${JSON.stringify(cleanModel)}
full_model_id = ${JSON.stringify(fullModelId)}

# 1. Update OmniRoute SQLite upstream provider connection
db_path = os.path.expanduser('~/.omniroute/storage.sqlite')
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute('SELECT id, provider_specific_data FROM provider_connections')
    rows = c.fetchall()
    found = False
    for cid, psd in rows:
        try:
            data = json.loads(psd or '{}')
            if data.get('prefix') == 'daytona-llama':
                data['baseUrl'] = endpoint
                c.execute('UPDATE provider_connections SET provider_specific_data=?, is_active=1 WHERE id=?', (json.dumps(data), cid))
                found = True
                break
        except Exception:
            pass

    if not found:
        new_id = str(uuid.uuid4())
        prov_id = f'openai-compatible-chat-{uuid.uuid4()}'
        psd = json.dumps({'prefix': 'daytona-llama', 'apiType': 'chat', 'baseUrl': endpoint, 'nodeName': 'Daytona Local Llama', 'apiKeyHealth': {}})
        now = datetime.datetime.utcnow().isoformat() + 'Z'
        c.execute('INSERT INTO provider_connections (id, provider, auth_type, name, priority, is_active, provider_specific_data, created_at, updated_at, proxy_enabled, quota_visible) VALUES (?, ?, "apikey", "Daytona Llama", 1, 1, ?, ?, ?, 1, 1)', (new_id, prov_id, psd, now, now))
    c.execute("SELECT value FROM key_value WHERE namespace='customModels' AND key='daytona-llama'")
    if not c.fetchone():
        custom_models = [{'id': clean_model, 'name': f'Daytona Local Llama ({clean_model})', 'source': 'manual', 'apiFormat': 'chat-completions', 'supportedEndpoints': ['chat']}]
        c.execute("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('customModels', 'daytona-llama', ?)", (json.dumps(custom_models),))
    conn.commit()
    conn.close()

# 2. Update OpenClaw config: remove separate llama_local provider and route model via omniroute
candidates = ['/home/freestyle/.openclaw/openclaw.json', '/root/.openclaw/openclaw.json', '/home/ubuntu/.openclaw/openclaw.json', '/home/daytona/.openclaw/openclaw.json', os.path.expanduser('~/.openclaw/openclaw.json')]
p = next((c for c in candidates if os.path.exists(c)), None)
if p:
    with open(p, 'r', encoding='utf-8') as f:
        data = json.load(f)
    provs = data.setdefault('models', {}).setdefault('providers', {})
    if 'llama_local' in provs:
        del provs['llama_local']
    omni = provs.setdefault('omniroute', {})
    omni_models = omni.setdefault('models', [])
    if not any(m.get('id') == full_model_id for m in omni_models):
        omni_models.append({
            'id': full_model_id,
            'name': f'Daytona Local Llama ({clean_model})',
            'contextWindow': 32768,
            'maxTokens': 8192,
            'compat': {'supportsTools': True, 'toolSchemaProfile': 'llamacpp'}
        })
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    try:
        os.chmod(p, 0o600)
    except Exception:
        pass
    print('OPENCLAW_REGISTER_OK')
`;

    const b64 = Buffer.from(pyScript, 'utf-8').toString('base64');
    const cmd = `python3 -c "import base64; exec(base64.b64decode('${b64}').decode('utf-8'))"`;
    const res = await VpsProbe.execRemote(targetSsh, cmd, 15);
    if (res.code === 0 && res.stdout.includes('OPENCLAW_REGISTER_OK')) {
      await VpsProbe.execRemote(
        targetSsh,
        'openclaw config validate 2>/dev/null && sudo supervisorctl restart omniroute openclaw 2>/dev/null || true',
        15
      );
      return true;
    }
    return false;
  }

  static async syncPassword(
    targetSsh: string,
    password = 'CHANGEME'
  ): Promise<{ success: boolean; error?: string }> {
    const safePwd = password.replace(/'/g, "'\\''");
    const cmd = `printf '%s' '${safePwd}' | omniroute reset-password --password-stdin >/dev/null 2>&1 && sudo supervisorctl restart omniroute >/dev/null 2>&1 && echo PWD_SYNC_OK`;
    const res = await VpsProbe.execRemote(targetSsh, cmd, 10);
    if (res.code === 0 && res.stdout.includes('PWD_SYNC_OK')) {
      return { success: true };
    }
    return {
      success: false,
      error: res.stderr || res.stdout.trim() || 'Failed to sync OmniRoute password'
    };
  }

  static async syncOmnirouteModelsToOpenClaw(
    targetSsh: string,
    port = 20128,
    apiKey = 'sk-omniroute-openclaw-key',
    llamaOpts?: { enabled?: boolean; endpointUrl?: string; modelName?: string }
  ): Promise<{ success: boolean; modelCount: number; models: string[]; error?: string }> {
    const pyScript = `
import json, os, sqlite3, subprocess, urllib.request

port = ${port}
api_key = ${JSON.stringify(apiKey)}
llama_enabled = ${llamaOpts?.enabled ? 'True' : 'False'}
llama_endpoint = ${JSON.stringify(llamaOpts?.endpointUrl || '')}
llama_model = ${JSON.stringify(llamaOpts?.modelName || '')}

oc_paths = ['/home/freestyle/.openclaw/openclaw.json', '/home/daytona/.openclaw/openclaw.json', '/home/ubuntu/.openclaw/openclaw.json', '/root/.openclaw/openclaw.json', os.path.expanduser('~/.openclaw/openclaw.json')]
oc_file = next((p for p in oc_paths if os.path.exists(p)), None)
if not oc_file:
    oc_file = os.path.expanduser('~/.openclaw/openclaw.json')
    os.makedirs(os.path.dirname(oc_file), exist_ok=True)
    with open(oc_file, 'w', encoding='utf-8') as f: json.dump({'models': {'providers': {}}}, f, indent=2)

try:
    with open(oc_file, 'r', encoding='utf-8') as f: data = json.load(f)
except Exception: data = {}

provs = data.setdefault('models', {}).setdefault('providers', {})
omni = provs.setdefault('omniroute', {})
omni['baseUrl'] = f"http://127.0.0.1:{port}/v1"
omni['apiKey'] = omni.get('apiKey') or api_key
omni['api'] = 'openai-completions'

discovered = {'auto/best-chat', 'auto/best-coding', 'auto/best-free', 'auto/best-reasoning', 'auto/pro-coding'}

try:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/models")
    req.add_header('Authorization', f"Bearer {omni['apiKey']}")
    with urllib.request.urlopen(req, timeout=5) as resp:
        for item in json.loads(resp.read().decode('utf-8')).get('data', []):
            if item.get('id'): discovered.add(item['id'])
except Exception: pass

sqlite_paths = ['/home/freestyle/.omniroute/storage.sqlite', '/home/daytona/.omniroute/storage.sqlite', '/home/ubuntu/.omniroute/storage.sqlite', '/root/.omniroute/storage.sqlite', os.path.expanduser('~/.omniroute/storage.sqlite')]
sql_file = next((p for p in sqlite_paths if os.path.exists(p)), None)
if sql_file:
    try:
        conn = sqlite3.connect(sql_file)
        c = conn.cursor()
        for k, v in c.execute("SELECT key, value FROM key_value WHERE namespace='customModels'").fetchall():
            try:
                for cm in json.loads(v):
                    if cm.get('id'): discovered.add(f"{k}/{cm['id']}" if not cm['id'].startswith(f"{k}/") else cm['id'])
            except Exception: pass
        for k, _ in c.execute("SELECT key, value FROM key_value WHERE namespace='modelAliases'").fetchall():
            if k: discovered.add(k)
        conn.close()
    except Exception: pass

llama_targets = []
if llama_endpoint: llama_targets.append(llama_endpoint)
llama_targets.extend(['http://127.0.0.1:8080/v1', 'http://127.0.0.1:8080'])
if llama_model:
    clean_m = llama_model.split('/')[-1] or 'qwen2.5-7b-mtp'
    discovered.add(f"daytona-llama/{clean_m}")

for lt in llama_targets:
    try:
        l_url = lt.rstrip('/') + ('/models' if lt.endswith('/v1') else '/v1/models')
        with urllib.request.urlopen(l_url, timeout=3) as l_resp:
            for item in json.loads(l_resp.read().decode('utf-8')).get('data', []):
                mid = item.get('id')
                if mid: discovered.add(f"daytona-llama/{mid.split('/')[-1]}")
            break
    except Exception: pass

old_models = {m.get('id'): m for m in omni.get('models', []) if isinstance(m, dict) and m.get('id')}
v_keys = ['gemini', 'gpt-4', 'gpt-5', 'claude', 'vision', 'qwen', 'vl', 'pixtral']
r_keys = ['reasoning', 'o1', 'o3', 'r1', 'qwq', 'thinking']
final_list = []
for mid in sorted(discovered):
    if not mid: continue
    if mid in old_models:
        m = old_models[mid]
    else:
        c_name = mid.split('/')[-1].replace('-', ' ').replace('_', ' ').title()
        ctx_w = 32768 if 'llama' in mid.lower() else 128000
        max_t = 16384 if any(rk in mid.lower() for rk in r_keys) else 8192
        m = {'id': mid, 'name': f"OmniRoute {c_name}", 'contextWindow': ctx_w, 'maxTokens': max_t}
    if any(k in mid.lower() for k in v_keys) and 'transcribe' not in mid.lower():
        m['input'] = ['text', 'image']
    if 'llama' in mid.lower():
        m.setdefault('compat', {})
        m['compat']['supportsTools'] = True
        m['compat']['toolSchemaProfile'] = 'llamacpp'
    final_list.append(m)

omni['models'] = final_list
curr_prim = data.get('agents', {}).get('defaults', {}).get('model', {}).get('primary', '')
valid_prim_ids = [m['id'] for m in final_list] + [f"omniroute/{m['id']}" for m in final_list]
if curr_prim and curr_prim not in valid_prim_ids:
    data.setdefault('agents', {}).setdefault('defaults', {}).setdefault('model', {})['primary'] = 'omniroute/auto/best-chat'

with open(oc_file, 'w', encoding='utf-8') as f: json.dump(data, f, indent=2)
try: os.chmod(oc_file, 0o600)
except Exception: pass

subprocess.call('openclaw config validate 2>/dev/null || true', shell=True)
restart_cmd = """
export XDG_RUNTIME_DIR="/run/user/$(id -u 2>/dev/null || echo 1000)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u 2>/dev/null || echo 1000)/bus"
sudo supervisorctl restart openclaw 2>/dev/null || \\
supervisorctl restart openclaw 2>/dev/null || \\
openclaw gateway restart 2>/dev/null || \\
systemctl --user restart openclaw-gateway.service 2>/dev/null || \\
systemctl --user restart openclaw-gateway 2>/dev/null || true
"""
subprocess.call(restart_cmd, shell=True)
print(json.dumps({'status': 'OK', 'count': len(final_list), 'models': [m['id'] for m in final_list]}))
`;
    const b64 = Buffer.from(pyScript, 'utf-8').toString('base64');
    const cmd = `python3 -c "import base64; exec(base64.b64decode('${b64}').decode('utf-8'))" 2>/dev/null`;
    const res = await VpsProbe.execRemote(targetSsh, cmd, 15);
    try {
      const match = res.stdout.match(/\{"status":\s*"OK".*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { success: true, modelCount: parsed.count, models: parsed.models || [] };
      }
    } catch (_) {}

    return {
      success: false,
      modelCount: 0,
      models: [],
      error: res.stderr || res.stdout.trim() || 'Failed to sync models with OmniRoute'
    };
  }
}
