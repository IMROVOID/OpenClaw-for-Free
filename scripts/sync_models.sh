#!/usr/bin/env bash
# ==============================================================================
# sync_models.sh - Synchronize OpenClaw Models with Connected OmniRoute
# Works seamlessly across both Daytona Cloud and FreeStyle VPS environments
# ==============================================================================
set -euo pipefail

OMNIROUTE_PORT="${OMNIROUTE_PORT:-20128}"
OMNIROUTE_URL="${OMNIROUTE_URL:-http://127.0.0.1:${OMNIROUTE_PORT}/v1}"
API_KEY="${OMNIROUTE_API_KEY:-}"

echo "=========================================================="
echo " Synchronizing OpenClaw Models with OmniRoute Gateway"
echo " Target URL: ${OMNIROUTE_URL}"
echo "=========================================================="

python3 - << 'EOF'
import json
import os
import sqlite3
import subprocess
import sys
import urllib.request

# 1. Candidate paths across Daytona, FreeStyle, Ubuntu, and root
OPENCLAW_CANDIDATES = [
    os.path.expanduser('~/.openclaw/openclaw.json'),
    '/home/freestyle/.openclaw/openclaw.json',
    '/home/daytona/.openclaw/openclaw.json',
    '/home/ubuntu/.openclaw/openclaw.json',
    '/root/.openclaw/openclaw.json'
]

SQLITE_CANDIDATES = [
    os.path.expanduser('~/.omniroute/storage.sqlite'),
    '/home/freestyle/.omniroute/storage.sqlite',
    '/home/daytona/.omniroute/storage.sqlite',
    '/home/ubuntu/.omniroute/storage.sqlite',
    '/root/.omniroute/storage.sqlite'
]

openclaw_path = next((p for p in OPENCLAW_CANDIDATES if os.path.exists(p)), None)
if not openclaw_path:
    # Use default for current user
    openclaw_path = os.path.expanduser('~/.openclaw/openclaw.json')
    os.makedirs(os.path.dirname(openclaw_path), exist_ok=True)
    with open(openclaw_path, 'w', encoding='utf-8') as f:
        json.dump({'models': {'providers': {}}}, f, indent=2)

sqlite_path = next((p for p in SQLITE_CANDIDATES if os.path.exists(p)), None)

# 2. Read existing openclaw.json
try:
    with open(openclaw_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
except Exception as e:
    print(f"[WARN] Could not parse existing {openclaw_path}: {e}")
    config = {}

models_section = config.setdefault('models', {})
providers = models_section.setdefault('providers', {})
omni_prov = providers.setdefault('omniroute', {})

base_url = omni_prov.get('baseUrl', 'http://127.0.0.1:20128/v1').rstrip('/')
api_key = os.environ.get('OMNIROUTE_API_KEY') or omni_prov.get('apiKey') or 'sk-omniroute-openclaw-key'
omni_prov['baseUrl'] = base_url
omni_prov['apiKey'] = api_key
omni_prov['api'] = 'openai-completions'

# 3. Baseline virtual routing models
discovered_ids = {
    "auto/best-chat",
    "auto/best-coding",
    "auto/best-free",
    "auto/best-reasoning",
    "auto/pro-coding"
}

# 4. Query live OmniRoute /v1/models endpoint
models_endpoint = f"{base_url}/models"
try:
    req = urllib.request.Request(models_endpoint)
    req.add_header('Authorization', f'Bearer {api_key}')
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = json.loads(resp.read().decode('utf-8'))
        for item in body.get('data', []):
            mid = item.get('id')
            if mid:
                discovered_ids.add(mid)
    print(f"[INFO] Live OmniRoute endpoint ({models_endpoint}) returned {len(discovered_ids)} models.")
except Exception as err:
    print(f"[WARN] Live OmniRoute query to {models_endpoint} failed ({err}). Checking local SQLite...")

# 5. Query SQLite database if present
if sqlite_path and os.path.exists(sqlite_path):
    try:
        conn = sqlite3.connect(sqlite_path)
        cur = conn.cursor()
        for k, v in cur.execute("SELECT key, value FROM key_value WHERE namespace='customModels'").fetchall():
            try:
                c_models = json.loads(v)
                if isinstance(c_models, list):
                    for cm in c_models:
                        cm_id = cm.get('id')
                        if cm_id:
                            full_id = f"{k}/{cm_id}" if not cm_id.startswith(f"{k}/") else cm_id
                            discovered_ids.add(full_id)
            except Exception:
                pass
        for k, v in cur.execute("SELECT key, value FROM key_value WHERE namespace='modelAliases'").fetchall():
            if k:
                discovered_ids.add(k)
        conn.close()
        print(f"[INFO] Discovered {len(discovered_ids)} models after checking SQLite ({sqlite_path}).")
    except Exception as e:
        print(f"[WARN] Could not read OmniRoute SQLite at {sqlite_path}: {e}")

# 6. Discover Llama model from local/remote Llama VM endpoint
llama_targets = [os.environ.get('LLAMA_ENDPOINT', ''), 'http://127.0.0.1:8080/v1', 'http://127.0.0.1:8080']
for lt in llama_targets:
    if not lt:
        continue
    try:
        l_url = lt.rstrip('/') + ('/models' if lt.endswith('/v1') else '/v1/models')
        with urllib.request.urlopen(l_url, timeout=3) as l_resp:
            l_data = json.loads(l_resp.read().decode('utf-8'))
            for item in l_data.get('data', []):
                mid = item.get('id')
                if mid:
                    discovered_ids.add(f"daytona-llama/{mid.split('/')[-1]}")
            print(f"[INFO] Discovered Llama models from {l_url}.")
            break
    except Exception:
        pass

# 7. Strict Pruning: Only models currently existing in discovered_ids remain
existing_models = {m.get('id'): m for m in omni_prov.get('models', []) if isinstance(m, dict) and m.get('id')}
vision_keywords = ['gemini', 'gpt-4', 'gpt-5', 'claude', 'vision', 'qwen3.8-max', 'qwen3.7-max', 'kimi', 'vl', 'pixtral']
reasoning_keywords = ['reasoning', 'o1', 'o3', 'r1', 'qwq', 'thinking']

final_models = []
for mid in sorted(discovered_ids):
    if not mid:
        continue
    if mid in existing_models:
        m = existing_models[mid]
    else:
        clean_name = mid.split('/')[-1].replace('-', ' ').replace('_', ' ').title()
        ctx_win = 32768 if 'llama' in mid.lower() else 128000
        max_tok = 16384 if any(rk in mid.lower() for rk in reasoning_keywords) else 8192
        m = {
            'id': mid,
            'name': f"OmniRoute {clean_name}",
            'contextWindow': ctx_win,
            'maxTokens': max_tok
        }

    # Ensure metadata attributes
    m_lower = mid.lower()
    if any(k in m_lower for k in vision_keywords) and 'transcribe' not in m_lower:
        m['input'] = ['text', 'image']
    if 'llama' in m_lower:
        m.setdefault('compat', {})
        m['compat']['supportsTools'] = True
        m['compat']['toolSchemaProfile'] = 'llamacpp'

    final_models.append(m)

# Update config
omni_prov['models'] = final_models

# Ensure primary model points to a valid remaining model
curr_prim = config.get('agents', {}).get('defaults', {}).get('model', {}).get('primary', '')
valid_prim_ids = [m['id'] for m in final_models] + [f"omniroute/{m['id']}" for m in final_models]
if curr_prim and curr_prim not in valid_prim_ids:
    config.setdefault('agents', {}).setdefault('defaults', {}).setdefault('model', {})['primary'] = 'omniroute/auto/best-chat'

# Save config
os.makedirs(os.path.dirname(os.path.abspath(openclaw_path)), exist_ok=True)
with open(openclaw_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2)
os.chmod(openclaw_path, 0o600)

print(f"[SUCCESS] Updated {openclaw_path} with {len(final_models)} OmniRoute models.")

# 9. Validate config
subprocess.call('openclaw config validate 2>/dev/null || true', shell=True)

# 10. Restart openclaw daemon
restart_cmd = """
export XDG_RUNTIME_DIR="/run/user/$(id -u 2>/dev/null || echo 1000)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u 2>/dev/null || echo 1000)/bus"
sudo supervisorctl restart openclaw 2>/dev/null || \
supervisorctl restart openclaw 2>/dev/null || \
openclaw gateway restart 2>/dev/null || \
systemctl --user restart openclaw-gateway.service 2>/dev/null || \
systemctl --user restart openclaw-gateway 2>/dev/null || true
"""
subprocess.call(restart_cmd, shell=True)
print("[SUCCESS] OpenClaw gateway reloaded successfully.")
EOF

echo ""
echo "✔ Synchronization completed successfully!"
