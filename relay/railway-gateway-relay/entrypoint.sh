#!/usr/bin/env bash
set -e

# Defaults if not supplied by environment
export PORT="${PORT:-8080}"
export RELAY_PATH="${RELAY_PATH:-/api/v1/relay-stream}"

if [ -z "${RELAY_UUID:-}" ]; then
  echo "[relay] ERROR: RELAY_UUID environment variable is required!"
  exit 1
fi

echo "[relay] Initializing Egress Relay Service..."
echo "[relay] Listening on dynamic port: ${PORT}"
echo "[relay] WebSocket path: ${RELAY_PATH}"
echo "[relay] Authenticated UUID configured: ${RELAY_UUID:0:8}****"

# Substitute environment variables into template
envsubst < /etc/xray/config.template.json > /etc/xray/config.json

echo "[relay] Starting Xray-core daemon..."
exec /usr/local/bin/xray run -config /etc/xray/config.json
