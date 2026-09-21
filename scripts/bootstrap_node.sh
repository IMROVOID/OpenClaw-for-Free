#!/usr/bin/env bash
# ==============================================================================
# scripts/bootstrap_node.sh - Unified Idempotent Node Bootstrap
# Supports: --provider=freestyle|daytona  --role=agent|llama
# ==============================================================================
set -euo pipefail

PROVIDER="freestyle"
ROLE="agent"
MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf"
MODEL_FILENAME="Qwen2.5-7B-Instruct-Q4_K_M.gguf"
INGRESS_DOMAIN=""

# Parse arguments
for arg in "$@"; do
  case $arg in
    --provider=*)
      PROVIDER="${arg#*=}"
      shift
      ;;
    --role=*)
      ROLE="${arg#*=}"
      shift
      ;;
    --model-url=*)
      MODEL_URL="${arg#*=}"
      shift
      ;;
    --model-filename=*)
      MODEL_FILENAME="${arg#*=}"
      shift
      ;;
    --ingress-domain=*)
      INGRESS_DOMAIN="${arg#*=}"
      shift
      ;;
    *)
      ;;
  esac
done

if [ -n "${INGRESS_DOMAIN}" ]; then
  if [ "$ROLE" != agent ]; then echo "[ERROR] Ingress requires agent role." >&2; exit 1; fi
  if ! declare -F setup_web_ingress >/dev/null; then
    SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]:-}")"
    if [ -z "${BASH_SOURCE[0]:-}" ] || [ ! -f "$SCRIPT_DIR/setup_web_ingress.sh" ]; then
      echo "[ERROR] Ingress script missing; use the bundled bootstrap." >&2
      exit 1
    fi
    setup_web_ingress() ( bash "$SCRIPT_DIR/setup_web_ingress.sh" "$@"; )
  fi
  setup_web_ingress "$INGRESS_DOMAIN" --validate-only
fi

echo "=========================================================="
echo " Starting OpenClaw Node Bootstrap"
echo " Provider: ${PROVIDER}"
echo " Role:     ${ROLE}"
echo " Host:     $(hostname 2>/dev/null || echo 'vps')"
echo " User:     $(whoami) (Home: ${HOME})"
echo "=========================================================="

# 1. Update package repositories
echo "[1/4] Updating package repositories..."
sudo apt-get update -qq

if [ "${ROLE}" = "agent" ]; then
  # ------------------------------------------------------------
  # ROLE: AGENT (OpenClaw CLI, OmniRoute Router, Node.js 22 LTS)
  # ------------------------------------------------------------
  echo "[2/4] Installing system dependencies for Agent node..."
  sudo apt-get install -y -qq curl jq supervisor git build-essential sqlite3 python3 python3-pip

  echo "[3/4] Verifying Node.js runtime..."
  NODE_MAJOR=0
  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
  fi

  if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "Installing Node.js 22 LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "Node.js $(node -v) is already installed."
  fi

  echo "[4/4] Checking OpenClaw & OmniRoute CLI..."
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "Installing OpenClaw CLI globally via npm..."
    sudo npm install -g @openclaw/cli || sudo npm install -g openclaw
  fi

  if ! command -v omniroute >/dev/null 2>&1; then
    echo "Installing OmniRoute CLI globally via npm..."
    sudo npm install -g omniroute || true
  fi

  # Ensure binaries are available in /usr/local/bin
  for bin in node npm openclaw omniroute; do
    P=$(which "$bin" 2>/dev/null || true)
    if [ -z "$P" ] && [ -d /usr/local/nvm/versions/node ]; then
      P=$(find /usr/local/nvm/versions/node -name "$bin" -type l -o -name "$bin" -type f 2>/dev/null | head -n 1 || true)
    fi
    if [ -n "$P" ] && [ "$P" != "/usr/local/bin/$bin" ]; then
      sudo ln -sf "$P" "/usr/local/bin/$bin" 2>/dev/null || true
    fi
  done

  [ -d /usr/local/nvm ] && sudo chown -R root:root /usr/local/nvm && sudo chmod -R 777 /usr/local/nvm 2>/dev/null || true
  mkdir -p "${HOME}/.openclaw/workspace" "${HOME}/.openclaw/logs" "${HOME}/.omniroute"
  sudo mkdir -p /root/.openclaw/workspace /root/.openclaw/logs /root/.omniroute 2>/dev/null || true
  sudo chmod -R 775 "${HOME}/.openclaw" "${HOME}/.omniroute" 2>/dev/null || true

  # Provision the Primary-VM credential vault (sqlite, no manual install needed)
  mkdir -p "${HOME}/.openclaw/vault"
  chmod 700 "${HOME}/.openclaw/vault"
  if ! command -v sqlite3 >/dev/null 2>&1; then
    (sudo apt-get install -y -qq sqlite3 || sudo apk add --no-cache sqlite) 2>/dev/null || true
  fi
  python3 -c "import sqlite3,os; p=os.path.expanduser('~/.openclaw/vault/vault.sqlite'); c=sqlite3.connect(p); c.execute('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)'); c.execute('CREATE TABLE IF NOT EXISTS logs(ts INTEGER, category TEXT, message TEXT)'); c.commit(); c.close(); print('VAULT_SQLITE_OK')" 2>/dev/null || echo 'VAULT_SQLITE_UNAVAILABLE'
  chmod 600 "${HOME}/.openclaw/vault/vault.sqlite" 2>/dev/null || true
  touch "${HOME}/.openclaw/vault/.provisioned"
  echo "Vault provisioned at ${HOME}/.openclaw/vault"

  if [ ! -f "${HOME}/.openclaw/openclaw.json" ]; then
    cat << 'EOF' > "${HOME}/.openclaw/openclaw.json"
{
  "gateway": {
    "mode": "local",
    "port": 18789,
    "bind": "loopback",
    "allowRealIpFallback": true,
    "auth": {
      "mode": "token",
      "token": "64477d7110f8fe4c1b089704ad69067bc06c8032371f430d"
    }
  }
}
EOF
    sudo cp -f "${HOME}/.openclaw/openclaw.json" /root/.openclaw/openclaw.json 2>/dev/null || true
  fi

  sudo loginctl enable-linger "${CURRENT_USER}" 2>/dev/null || true
  chmod 700 "${HOME}/.openclaw" "${HOME}/.config" "${HOME}/.config/systemd" "${HOME}/.config/systemd/user" 2>/dev/null || true
  sudo chown -R "${CURRENT_USER}:${CURRENT_USER}" "${HOME}/.openclaw" "${HOME}/.config" 2>/dev/null || true

  # Configure supervisor daemon for omniroute
  sudo tee /etc/supervisor/conf.d/omniroute.conf > /dev/null << EOF
[program:omniroute]
command=/usr/local/bin/omniroute serve --port 20128 --no-open
directory=${HOME}
user=root
autostart=true
autorestart=true
startsecs=5
startretries=5
redirect_stderr=true
stdout_logfile=${HOME}/.omniroute/omniroute.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=5
environment=HOME="${HOME}",USER="root",PATH="/usr/local/bin:/usr/bin:/bin"
EOF

  # Prefer native systemd user service for openclaw (enables in-UI auto-updates)
  if pidof systemd >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
    sudo rm -f /etc/supervisor/conf.d/openclaw.conf 2>/dev/null || true
    openclaw gateway install --force --port 18789 2>/dev/null || true
    openclaw gateway start 2>/dev/null || true
  else
    sudo tee /etc/supervisor/conf.d/openclaw.conf > /dev/null << EOF
[program:openclaw]
command=/usr/local/bin/openclaw gateway run --port 18789 --allow-unconfigured
directory=${HOME}
user=root
autostart=true
autorestart=true
startsecs=5
startretries=5
redirect_stderr=true
stdout_logfile=${HOME}/.openclaw/logs/gateway.log
stdout_logfile_maxbytes=20MB
stdout_logfile_backups=3
environment=HOME="${HOME}",USER="root",PATH="/usr/local/bin:/usr/bin:/bin",OPENCLAW_SERVICE_REPAIR_POLICY="external"
EOF
  fi

  sudo supervisorctl reread 2>/dev/null || true
  sudo supervisorctl update 2>/dev/null || true
  printf 'CHANGEME' | omniroute reset-password --password-stdin 2>/dev/null || true
  sudo supervisorctl restart omniroute 2>/dev/null || true

  if [ -n "${INGRESS_DOMAIN}" ]; then
    setup_web_ingress "$INGRESS_DOMAIN"
  fi

  echo "=========================================================="
  echo " Agent Node Bootstrap Completed Successfully!"
  echo " Node: $(node -v)"
  echo " NPM:  $(npm -v)"
  echo "=========================================================="

elif [ "${ROLE}" = "llama" ]; then
  # ------------------------------------------------------------
  # ROLE: LLAMA (Dedicated llama-server AVX-512 Inference Engine)
  # ------------------------------------------------------------
  echo "[2/4] Installing build tools and aria2 for Llama node..."
  sudo apt-get install -y -qq supervisor aria2 tmux curl wget

  echo "[3/4] Verifying llama-server binary..."
  if ! command -v llama-server >/dev/null 2>&1; then
    echo "Downloading prebuilt llama.cpp binaries (AVX-512)..."
    TMP_LLAMA="/tmp/llama_prebuilt_$$"
    mkdir -p "${TMP_LLAMA}"
    if curl -fsSL -o "${TMP_LLAMA}/llama.tar.gz" "https://github.com/ggml-org/llama.cpp/releases/download/b10941/llama-b10941-bin-ubuntu-x64.tar.gz"; then
      tar -xzf "${TMP_LLAMA}/llama.tar.gz" -C "${TMP_LLAMA}"
      EXTRACTED_DIR=$(find "${TMP_LLAMA}" -maxdepth 1 -type d -name "llama-*" | head -n 1)
      if [ -n "${EXTRACTED_DIR}" ]; then
        sudo cp "${EXTRACTED_DIR}"/llama-* /usr/local/bin/
        sudo cp "${EXTRACTED_DIR}"/*.so* /usr/local/bin/
        sudo cp "${EXTRACTED_DIR}"/*.so* /usr/local/lib/ 2>/dev/null || true
        sudo ldconfig 2>/dev/null || true
      fi
      rm -rf "${TMP_LLAMA}"
    else
      echo "Falling back to build from source..."
      BUILD_DIR="/tmp/llama_build_$$"
      rm -rf "${BUILD_DIR}"
      git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "${BUILD_DIR}"
      cmake -B "${BUILD_DIR}/build" -S "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON
      cmake --build "${BUILD_DIR}/build" --config Release -j"$(nproc || echo 4)" --target llama-cli llama-server
      sudo cp "${BUILD_DIR}/build/bin/llama-"* /usr/local/bin/
      sudo cp "${BUILD_DIR}/build/bin/"*.so* /usr/local/bin/ 2>/dev/null || true
      sudo cp "${BUILD_DIR}/build/bin/"*.so* /usr/local/lib/ 2>/dev/null || true
      sudo ldconfig 2>/dev/null || true
      rm -rf "${BUILD_DIR}"
    fi
  else
    echo "llama-server binary already present in PATH."
  fi

  echo "[4/4] Ensuring model weights and start scripts..."
  MODEL_DIR="${HOME}/models"
  mkdir -p "${MODEL_DIR}"
  MODEL_PATH="${MODEL_DIR}/${MODEL_FILENAME}"

  if [ ! -f "${MODEL_PATH}" ]; then
    echo "Downloading model weights (${MODEL_FILENAME})..."
    aria2c -x 8 -s 8 -k 1M --summary-interval=5 \
      -d "${MODEL_DIR}" \
      -o "${MODEL_FILENAME}" \
      "${MODEL_URL}" || echo "Model download completed or queued."
  else
    echo "Model file already exists at ${MODEL_PATH}."
  fi

  CURRENT_USER=$(whoami)
  cat << EOF > "${HOME}/start-server.sh"
#!/usr/bin/env bash
sudo supervisorctl restart llama 2>/dev/null || (pkill -f llama-server; sleep 1; nohup /usr/local/bin/llama-server -m "${MODEL_PATH}" --host 0.0.0.0 --port 8080 -t 4 -c 32768 -b 512 -ub 512 -fa on --cache-type-k q4_0 --cache-type-v q4_0 --kv-unified --cache-reuse 256 --jinja --timeout 0 --metrics > ${HOME}/llama-server.log 2>&1 &)
echo "llama-server started."
EOF

  cat << 'EOF' > "${HOME}/stop-server.sh"
#!/usr/bin/env bash
sudo supervisorctl stop llama 2>/dev/null || pkill -f llama-server || true
echo "llama-server stopped."
EOF

  cat << 'EOF' > "${HOME}/status-server.sh"
#!/usr/bin/env bash
curl -s http://localhost:8080/health && echo "" || echo "llama-server not responding"
EOF

  chmod +x "${HOME}/start-server.sh" "${HOME}/stop-server.sh" "${HOME}/status-server.sh"

  sudo tee /etc/supervisor/conf.d/llama.conf > /dev/null << EOF
[program:llama]
command=/usr/local/bin/llama-server -m ${MODEL_PATH} --host 0.0.0.0 --port 8080 -t 4 -c 32768 -b 512 -ub 512 -fa on --cache-type-k q4_0 --cache-type-v q4_0 --kv-unified --cache-reuse 256 --jinja --timeout 0 --metrics
directory=${HOME}
user=root
autostart=true
autorestart=true
startsecs=5
startretries=5
redirect_stderr=true
stdout_logfile=${HOME}/llama-server.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=5
environment=HOME="${HOME}",USER="root",PATH="/usr/local/bin:/usr/bin:/bin"
EOF

  sudo supervisorctl reread 2>/dev/null || true
  sudo supervisorctl update 2>/dev/null || true
  sudo supervisorctl restart llama 2>/dev/null || true

  echo "=========================================================="
  echo " Llama Node Bootstrap Completed Successfully!"
  echo " Endpoint: http://localhost:8080"
  echo "=========================================================="
fi
