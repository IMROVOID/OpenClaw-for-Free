import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface BootstrapIngressOptions {
  openclawPort?: number;
  omniroutePort?: number;
  llamaPort?: number;
  isSeparateVps?: boolean;
}

export function buildIngressArgument(domain: string, options: BootstrapIngressOptions = {}): string {
  if (options.isSeparateVps || (options.openclawPort ?? 18789) !== 18789 ||
      (options.omniroutePort ?? 20128) !== 20128 || (options.llamaPort ?? 8080) !== 8080) {
    throw new Error('Unsupported ingress topology: default ports and colocated llama required.');
  }
  const normalized = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  if (normalized.length > 253 || !/^[a-z0-9.-]+$/.test(normalized) || normalized.split('.').length < 2 ||
      normalized.split('.').some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error('Invalid ingress domain: expected a DNS hostname without port or path.');
  }
  return `'--ingress-domain=${normalized}'`;
}

const getDirname = (): string => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch (_) {
    return process.cwd();
  }
};

function bundleIngress(bootstrap: string, ingress = embeddedIngress): string {
  return `setup_web_ingress() (\n${ingress.trim()}\n)\n${bootstrap}`.replace(/\r\n/g, '\n');
}

export function getBootstrapNodeScript(): string {
  const currentDir = getDirname();
  // Check local filesystem first if in project repository
  const localPaths = [
    path.resolve(process.cwd(), 'scripts', 'bootstrap_node.sh'),
    path.resolve(currentDir, '..', '..', '..', 'scripts', 'bootstrap_node.sh'),
    path.resolve(currentDir, 'scripts', 'bootstrap_node.sh')
  ];

  for (const p of localPaths) {
    if (fs.existsSync(p)) {
      try {
        return bundleIngress(fs.readFileSync(p, 'utf-8'), fs.readFileSync(path.join(path.dirname(p), 'setup_web_ingress.sh'), 'utf-8'));
      } catch (_) {}
    }
  }

  // Fallback embedded script
  return bundleIngress(`#!/usr/bin/env bash
set -euo pipefail
PROVIDER="freestyle"
ROLE="agent"
INGRESS_DOMAIN=""
MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf"
MODEL_FILENAME="Qwen2.5-7B-Instruct-Q4_K_M.gguf"
for arg in "$@"; do
  case $arg in
    --provider=*) PROVIDER="\${arg#*=}" ; shift ;;
    --role=*) ROLE="\${arg#*=}" ; shift ;;
    --ingress-domain=*) INGRESS_DOMAIN="\${arg#*=}" ; shift ;;
    --model-url=*) MODEL_URL="\${arg#*=}" ; shift ;;
    --model-filename=*) MODEL_FILENAME="\${arg#*=}" ; shift ;;
  esac
done
if [ -n "\${INGRESS_DOMAIN}" ]; then
  if [ "$ROLE" != agent ]; then echo "[ERROR] Ingress requires agent role." >&2; exit 1; fi
  if ! declare -F setup_web_ingress >/dev/null; then echo "[ERROR] Ingress script missing." >&2; exit 1; fi
  setup_web_ingress "$INGRESS_DOMAIN" --validate-only
fi
sudo apt-get update -qq
if [ "\${ROLE}" = "agent" ]; then
  sudo apt-get install -y -qq curl jq supervisor git build-essential sqlite3 python3 python3-pip
  NODE_MAJOR=0
  if command -v node >/dev/null 2>&1; then NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v'); fi
  if [ "$NODE_MAJOR" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  if ! command -v openclaw >/dev/null 2>&1; then sudo npm install -g @openclaw/cli || sudo npm install -g openclaw; fi
  if ! command -v omniroute >/dev/null 2>&1; then sudo npm install -g omniroute || true; fi
  for bin in node npm openclaw omniroute; do
    P=$(which "$bin" 2>/dev/null || true)
    if [ -z "$P" ] && [ -d /usr/local/nvm/versions/node ]; then
      P=$(find /usr/local/nvm/versions/node -name "$bin" -type l -o -name "$bin" -type f 2>/dev/null | head -n 1 || true)
    fi
    if [ -n "$P" ] && [ "$P" != "/usr/local/bin/$bin" ]; then sudo ln -sf "$P" "/usr/local/bin/$bin" 2>/dev/null || true; fi
  done
  [ -d /usr/local/nvm ] && sudo chown -R root:root /usr/local/nvm && sudo chmod -R 777 /usr/local/nvm 2>/dev/null || true
  mkdir -p "\${HOME}/.openclaw/workspace" "\${HOME}/.openclaw/logs" "\${HOME}/.omniroute"
  sudo mkdir -p /root/.openclaw/workspace /root/.openclaw/logs /root/.omniroute 2>/dev/null || true
  sudo chmod -R 775 "\${HOME}/.openclaw" "\${HOME}/.omniroute" 2>/dev/null || true
  if [ ! -f "\${HOME}/.openclaw/openclaw.json" ]; then
    cat << 'EOF' > "\${HOME}/.openclaw/openclaw.json"
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
    sudo cp -f "\${HOME}/.openclaw/openclaw.json" /root/.openclaw/openclaw.json 2>/dev/null || true
  fi
  sudo loginctl enable-linger "\${CURRENT_USER}" 2>/dev/null || true
  chmod 700 "\${HOME}/.openclaw" "\${HOME}/.config" "\${HOME}/.config/systemd" "\${HOME}/.config/systemd/user" 2>/dev/null || true
  sudo chown -R "\${CURRENT_USER}:\${CURRENT_USER}" "\${HOME}/.openclaw" "\${HOME}/.config" 2>/dev/null || true
  sudo tee /etc/supervisor/conf.d/omniroute.conf > /dev/null << EOF
[program:omniroute]
command=/usr/local/bin/omniroute serve --port 20128 --no-open
directory=\${HOME}
user=root
autostart=true
autorestart=true
startsecs=5
redirect_stderr=true
stdout_logfile=\${HOME}/.omniroute/omniroute.log
environment=HOME="\${HOME}",USER="root",PATH="/usr/local/bin:/usr/bin:/bin"
EOF
  if pidof systemd >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
    sudo rm -f /etc/supervisor/conf.d/openclaw.conf 2>/dev/null || true
    openclaw gateway install --force --port 18789 2>/dev/null || true
    openclaw gateway start 2>/dev/null || true
  else
    sudo tee /etc/supervisor/conf.d/openclaw.conf > /dev/null << EOF
[program:openclaw]
command=/usr/local/bin/openclaw gateway run --port 18789 --allow-unconfigured
directory=\${HOME}
user=root
autostart=true
autorestart=true
startsecs=5
redirect_stderr=true
stdout_logfile=\${HOME}/.openclaw/logs/gateway.log
environment=HOME="\${HOME}",USER="root",PATH="/usr/local/bin:/usr/bin:/bin",OPENCLAW_SERVICE_REPAIR_POLICY="external"
EOF
  fi
  sudo supervisorctl reread 2>/dev/null || true
  sudo supervisorctl update 2>/dev/null || true
  printf 'CHANGEME' | omniroute reset-password --password-stdin 2>/dev/null || true
  sudo supervisorctl restart omniroute 2>/dev/null || true
  if [ -n "\${INGRESS_DOMAIN}" ]; then
    setup_web_ingress "$INGRESS_DOMAIN"
  fi
elif [ "\${ROLE}" = "llama" ]; then
  sudo apt-get install -y -qq supervisor aria2 tmux curl wget
  if ! command -v llama-server >/dev/null 2>&1; then
    TMP_LLAMA="/tmp/llama_prebuilt_$$"
    mkdir -p "\${TMP_LLAMA}"
    if curl -fsSL -o "\${TMP_LLAMA}/llama.tar.gz" "https://github.com/ggml-org/llama.cpp/releases/download/b10930/llama-b10930-bin-ubuntu-x64.tar.gz"; then
      tar -xzf "\${TMP_LLAMA}/llama.tar.gz" -C "\${TMP_LLAMA}"
      EXTRACTED_DIR=$(find "\${TMP_LLAMA}" -maxdepth 1 -type d -name "llama-*" | head -n 1)
      if [ -n "\${EXTRACTED_DIR}" ]; then
        sudo cp "\${EXTRACTED_DIR}"/llama-* /usr/local/bin/
        sudo cp "\${EXTRACTED_DIR}"/*.so* /usr/local/bin/
        sudo cp "\${EXTRACTED_DIR}"/*.so* /usr/local/lib/ 2>/dev/null || true
        sudo ldconfig 2>/dev/null || true
      fi
      rm -rf "\${TMP_LLAMA}"
    fi
  fi
  MODEL_DIR="\${HOME}/models"
  mkdir -p "\${MODEL_DIR}"
  MODEL_PATH="\${MODEL_DIR}/\${MODEL_FILENAME}"
  if [ ! -f "\${MODEL_PATH}" ]; then
    aria2c -x 8 -s 8 -k 1M --summary-interval=5 -d "\${MODEL_DIR}" -o "\${MODEL_FILENAME}" "\${MODEL_URL}" || true
  fi
  CURRENT_USER=$(whoami)
  cat << EOF > "\${HOME}/start-server.sh"
#!/usr/bin/env bash
sudo supervisorctl restart llama 2>/dev/null || (pkill -f llama-server; sleep 1; nohup /usr/local/bin/llama-server -m "\${MODEL_PATH}" --host 0.0.0.0 --port 8080 -t 4 -c 32768 -b 512 -ub 512 -fa on --cache-type-k q4_0 --cache-type-v q4_0 --kv-unified --cache-reuse 256 --jinja --timeout 0 --metrics > \${HOME}/llama-server.log 2>&1 &)
EOF
  cat << 'EOF' > "\${HOME}/stop-server.sh"
#!/usr/bin/env bash
sudo supervisorctl stop llama 2>/dev/null || pkill -f llama-server || true
EOF
  cat << 'EOF' > "\${HOME}/status-server.sh"
#!/usr/bin/env bash
curl -s http://localhost:8080/health && echo "" || echo "llama-server not responding"
EOF
  chmod +x "\${HOME}/start-server.sh" "\${HOME}/stop-server.sh" "\${HOME}/status-server.sh"
  sudo tee /etc/supervisor/conf.d/llama.conf > /dev/null << EOF
[program:llama]
command=/usr/local/bin/llama-server -m \${MODEL_PATH} --host 0.0.0.0 --port 8080 -t 4 -c 32768 -b 512 -ub 512 -fa on --cache-type-k q4_0 --cache-type-v q4_0 --kv-unified --cache-reuse 256 --jinja --timeout 0 --metrics
directory=\${HOME}
user=root
autostart=true
autorestart=true
startsecs=5
redirect_stderr=true
stdout_logfile=\${HOME}/llama-server.log
environment=HOME="\${HOME}",USER="root",PATH="/usr/local/bin:/usr/bin:/bin"
EOF
  sudo supervisorctl reread 2>/dev/null || true
  sudo supervisorctl update 2>/dev/null || true
  sudo supervisorctl restart llama 2>/dev/null || true
fi
`);
}

const embeddedIngress = `#!/usr/bin/env bash
set -euo pipefail
BASE_DOMAIN="\${1:-\${BASE_DOMAIN:-}}"
CLEAN_DOMAIN="\${BASE_DOMAIN#https://}"
CLEAN_DOMAIN="\${CLEAN_DOMAIN#http://}"
CLEAN_DOMAIN="\${CLEAN_DOMAIN%/}"
CLEAN_DOMAIN="\${CLEAN_DOMAIN,,}"
if [ \${#CLEAN_DOMAIN} -gt 253 ] || [[ ! "$CLEAN_DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "[ERROR] Invalid ingress domain." >&2
  exit 1
fi
IFS='.' read -r -a labels <<< "$CLEAN_DOMAIN"
for label in "\${labels[@]}"; do
  if [ \${#label} -gt 63 ]; then echo "[ERROR] Invalid ingress domain label." >&2; exit 1; fi
done
if [ "\${2:-}" = "--validate-only" ]; then exit 0; fi
echo "=========================================================="
echo "Setting up Caddy ingress for https://\${CLEAN_DOMAIN}"
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi
sudo mkdir -p /etc/caddy
sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
\${CLEAN_DOMAIN} {
    handle_path /openclaw/* {
        reverse_proxy 127.0.0.1:18789 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }
    handle_path /omniroute/* {
        reverse_proxy 127.0.0.1:20128 {
            flush_interval -1
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }
    handle_path /llama/* {
        reverse_proxy 127.0.0.1:8080 {
            flush_interval -1
            transport http {
                response_header_timeout 3600s
                read_timeout 3600s
            }
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }
    handle {
        reverse_proxy 127.0.0.1:18789 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
    }
    encode zstd gzip
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
if pidof systemd >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
  sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy
  sudo systemctl enable caddy 2>/dev/null || true
else
  sudo pkill -f caddy || true
  sleep 1
  nohup caddy run --config /etc/caddy/Caddyfile > /var/log/caddy.log 2>&1 &
  CADDY_PID=$!
  sleep 1
  kill -0 "$CADDY_PID" || { echo "[ERROR] Caddy failed to start." >&2; exit 1; }
fi
echo "Caddy Web Ingress Configured Successfully: https://\${CLEAN_DOMAIN}"
`;
