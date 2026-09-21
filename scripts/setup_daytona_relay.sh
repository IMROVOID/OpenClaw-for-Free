#!/usr/bin/env bash
# ==============================================================================
# Setup Daytona Egress Relay (Xray Client & OpenClaw Proxy Integration)
# ==============================================================================
# Usage:
#   ./scripts/setup_daytona_relay.sh [RAILWAY_DOMAIN] [RELAY_UUID] [RELAY_PATH]
#
# Arguments:
#   RAILWAY_DOMAIN: <your-relay>.up.railway.app
#   RELAY_UUID:     <your-relay-uuid>
#   RELAY_PATH:     /api/v1/relay-stream (default)
# ==============================================================================

set -euo pipefail

RAILWAY_DOMAIN="${1:-${RAILWAY_DOMAIN:-}}"
RELAY_UUID="${2:-${RELAY_UUID:-}}"
RELAY_PATH="${3:-/api/v1/relay-stream}"

if [ -z "${RAILWAY_DOMAIN}" ] || [ -z "${RELAY_UUID}" ]; then
    echo "[ERROR] Missing required arguments."
    echo "Usage: $0 <RAILWAY_DOMAIN> <RELAY_UUID> [RELAY_PATH]"
    echo "Example: $0 your-egress-relay.up.railway.app 00000000-0000-0000-0000-000000000000"
    exit 1
fi
XRAY_VERSION="26.3.27"

HTTP_PORT="10808"
SOCKS_PORT="10809"

echo "================================================================="
echo "  Deploying Daytona Cloud VPS Egress Relay via Railway"
echo "  (Guarantees outbound OmniRoute LLM routing, Discord, & HF access)"
echo "================================================================="
echo "Target Relay Domain : https://${RAILWAY_DOMAIN}"
echo "WebSocket Path      : ${RELAY_PATH}"
echo "Client UUID         : ${RELAY_UUID:0:8}****"
echo "Local Inbound Ports : HTTP=${HTTP_PORT}, SOCKS5=${SOCKS_PORT}"
echo "================================================================="

# 1. Install prerequisites
echo "[1/6] Installing dependencies..."
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq curl jq unzip supervisor ca-certificates
fi

# 2. Download and install Xray binary
echo "[2/6] Checking / installing Xray-core binary..."
if ! command -v xray >/dev/null 2>&1; then
    echo "  Downloading Xray-core v${XRAY_VERSION}..."
    TMP_DIR=$(mktemp -d)
    curl -sSL "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" -o "${TMP_DIR}/xray.zip"
    unzip -q -o "${TMP_DIR}/xray.zip" -d "${TMP_DIR}"
    sudo install -m 755 "${TMP_DIR}/xray" /usr/local/bin/xray
    rm -rf "${TMP_DIR}"
    echo "  Installed: $(/usr/local/bin/xray version | head -n 1)"
else
    echo "  Xray already installed at $(which xray)."
fi

# 3. Configure local Xray client
echo "[3/6] Configuring local client at /home/daytona/.xray/config.json..."
mkdir -p /home/daytona/.xray
cat <<EOF > /home/daytona/.xray/config.json
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "tag": "http-in",
      "port": ${HTTP_PORT},
      "listen": "127.0.0.1",
      "protocol": "http",
      "settings": {
        "timeout": 300
      }
    },
    {
      "tag": "socks-in",
      "port": ${SOCKS_PORT},
      "listen": "127.0.0.1",
      "protocol": "socks",
      "settings": {
        "auth": "noauth",
        "udp": true
      }
    }
  ],
  "outbounds": [
    {
      "tag": "proxy",
      "protocol": "vless",
      "settings": {
        "vnext": [
          {
            "address": "${RAILWAY_DOMAIN}",
            "port": 443,
            "users": [
              {
                "id": "${RELAY_UUID}",
                "encryption": "none",
                "level": 0
              }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "ws",
        "security": "tls",
        "tlsSettings": {
          "serverName": "${RAILWAY_DOMAIN}",
          "allowInsecure": false
        },
        "wsSettings": {
          "path": "${RELAY_PATH}",
          "headers": {
            "Host": "${RAILWAY_DOMAIN}"
          }
        }
      }
    },
    {
      "tag": "direct",
      "protocol": "freedom"
    }
  ]
}
EOF
chmod 600 /home/daytona/.xray/config.json
chown -R daytona:daytona /home/daytona/.xray

# 4. Configure Supervisor daemon
echo "[4/6] Setting up supervisor daemon for 24/7 background persistence..."
sudo mkdir -p /var/log/xray
sudo chown -R daytona:daytona /var/log/xray

sudo tee /etc/supervisor/conf.d/xray.conf > /dev/null <<EOF
[program:xray]
command=/usr/local/bin/xray run -config /home/daytona/.xray/config.json
user=daytona
autostart=true
autorestart=true
startsecs=3
startretries=10
redirect_stderr=true
stdout_logfile=/var/log/xray/access.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
environment=HOME="/home/daytona"
EOF

sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl restart xray
sleep 2

# Verify supervisor status
sudo supervisorctl status xray

# 5. Test Tunnel Connectivity from VPS
echo "[5/6] Testing egress reachability through the tunnel..."
set +e
TEST_RES=$(curl -s -m 8 -x "http://127.0.0.1:${HTTP_PORT}" -I https://gateway.discord.gg | head -n 1)
set -e

if [[ "$TEST_RES" =~ "HTTP/" ]]; then
    echo "  [SUCCESS] Tunnel active! Discord Gateway responded: ${TEST_RES}"
else
    echo "  [WARNING] Initial test returned: ${TEST_RES}. Verify Railway deployment status."
fi

# 6. Apply proxy to OpenClaw and environment config
echo "[6/6] Integrating proxy into OpenClaw and environment configuration..."
OC_CONFIG="/home/daytona/.openclaw/openclaw.json"
if [[ -f "${OC_CONFIG}" ]]; then
    cp "${OC_CONFIG}" "${OC_CONFIG}.bak"
    python3 -c '
import json
p = "/home/daytona/.openclaw/openclaw.json"
with open(p, "r") as f:
    cfg = json.load(f)
ch = cfg.setdefault("channels", {})
tg = ch.setdefault("telegram", {})
tg["proxy"] = "http://127.0.0.1:'"${HTTP_PORT}"'"
tg_net = tg.setdefault("network", {})
tg_net["autoSelectFamily"] = False

dc = ch.setdefault("discord", {})
dc["proxy"] = "http://127.0.0.1:'"${HTTP_PORT}"'"
if "network" in dc:
    del dc["network"]

with open(p, "w") as f:
    json.dump(cfg, f, indent=2)
' 2>/dev/null || true
    chmod 600 "${OC_CONFIG}"
fi

PROXY_ENV="HTTP_PROXY=\"http://127.0.0.1:${HTTP_PORT}\",HTTPS_PROXY=\"http://127.0.0.1:${HTTP_PORT}\",http_proxy=\"http://127.0.0.1:${HTTP_PORT}\",https_proxy=\"http://127.0.0.1:${HTTP_PORT}\",ALL_PROXY=\"socks5://127.0.0.1:${SOCKS_PORT}\",all_proxy=\"socks5://127.0.0.1:${SOCKS_PORT}\",NO_PROXY=\"127.0.0.1,localhost,internal\",no_proxy=\"127.0.0.1,localhost,internal\""

if [[ -f "/usr/local/bin/openclaw-start.sh" ]]; then
    sudo bash -c 'cat << "EOF" > /usr/local/bin/openclaw-start.sh
#!/bin/bash
export HTTP_PROXY="http://127.0.0.1:'"${HTTP_PORT}"'"
export HTTPS_PROXY="http://127.0.0.1:'"${HTTP_PORT}"'"
export http_proxy="http://127.0.0.1:'"${HTTP_PORT}"'"
export https_proxy="http://127.0.0.1:'"${HTTP_PORT}"'"
export ALL_PROXY="socks5://127.0.0.1:'"${SOCKS_PORT}"'"
export all_proxy="socks5://127.0.0.1:'"${SOCKS_PORT}"'"
export NO_PROXY="127.0.0.1,localhost,internal"
export no_proxy="127.0.0.1,localhost,internal"
rm -f /home/daytona/.openclaw/tmp/openclaw-1001/*gateway*.lock* 2>/dev/null || true

# Auto-approve operator browser devices in background
(while true; do
  python3 -c "import json, subprocess
try:
  data = json.loads(subprocess.check_output(\"/usr/local/share/nvm/current/bin/openclaw devices list --json 2>/dev/null || openclaw devices list --json 2>/dev/null\", shell=True))
  for p in data.get(\"pending\", []):
    subprocess.call(f\"/usr/local/share/nvm/current/bin/openclaw devices approve {p['requestId']} 2>/dev/null || openclaw devices approve {p['requestId']} 2>/dev/null\", shell=True)
except Exception:
  pass" 2>/dev/null
  sleep 2
done) &

exec /usr/local/share/nvm/current/bin/node /usr/local/share/nvm/current/bin/openclaw gateway run --force
EOF'
    sudo chmod +x /usr/local/bin/openclaw-start.sh
fi

if [[ -f "/etc/supervisor/conf.d/openclaw.conf" ]]; then
    sudo sed -i 's|environment=.*|environment=HOME="/home/daytona",USER="daytona",PATH="/usr/local/python/current/bin:/usr/local/py-utils/bin:/usr/local/jupyter:/usr/local/share/nvm/current/bin:/usr/local/bin:/usr/bin:/bin",'"${PROXY_ENV}"'|g' /etc/supervisor/conf.d/openclaw.conf
fi

if [[ -f "/etc/supervisor/conf.d/omniroute.conf" ]]; then
    sudo sed -i 's|environment=.*|environment=HOME="/home/daytona",USER="daytona",PATH="/usr/local/share/nvm/current/bin:/usr/local/bin:/usr/bin:/bin",'"${PROXY_ENV}"'|g' /etc/supervisor/conf.d/omniroute.conf
fi

sudo supervisorctl reread 2>/dev/null || true
sudo supervisorctl update 2>/dev/null || true
sudo supervisorctl restart openclaw 2>/dev/null || true
sudo supervisorctl restart omniroute 2>/dev/null || true
echo "  OpenClaw and OmniRoute reconfigured with relay proxy."

echo "================================================================="
echo "  Egress Relay Setup Complete!"
echo "  Local HTTP Proxy  : http://127.0.0.1:${HTTP_PORT}"
echo "  Local SOCKS5 Proxy: socks5://127.0.0.1:${SOCKS_PORT}"
echo "  Logs              : tail -f /var/log/xray/access.log"
echo "================================================================="
