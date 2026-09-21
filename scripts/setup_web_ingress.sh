#!/usr/bin/env bash
set -euo pipefail
BASE_DOMAIN="${1:-${BASE_DOMAIN:-}}"
CLEAN_DOMAIN="${BASE_DOMAIN#https://}"
CLEAN_DOMAIN="${CLEAN_DOMAIN#http://}"
CLEAN_DOMAIN="${CLEAN_DOMAIN%/}"
CLEAN_DOMAIN="${CLEAN_DOMAIN,,}"
if [ ${#CLEAN_DOMAIN} -gt 253 ] || [[ ! "$CLEAN_DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "[ERROR] Invalid ingress domain." >&2
  exit 1
fi
IFS='.' read -r -a labels <<< "$CLEAN_DOMAIN"
for label in "${labels[@]}"; do
  if [ ${#label} -gt 63 ]; then echo "[ERROR] Invalid ingress domain label." >&2; exit 1; fi
done
if [ "${2:-}" = "--validate-only" ]; then exit 0; fi
echo "=========================================================="
echo "Setting up Caddy ingress for https://${CLEAN_DOMAIN}"
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
${CLEAN_DOMAIN} {
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
echo "Caddy Web Ingress Configured Successfully: https://${CLEAN_DOMAIN}"
