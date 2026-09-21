#!/usr/bin/env bash
# ==============================================================================
# Autonomous Setup Script: llama.cpp on Daytona Cloud VPS
# Unified wrapper around bootstrap_node.sh to prevent code drift
# ==============================================================================
set -euo pipefail

MODEL_URL="${1:-}"
if [ -z "${MODEL_URL}" ]; then
  echo "Usage: $0 <MODEL_GGUF_URL> [MODEL_FILENAME]"
  echo "Example: $0 https://huggingface.co/<org>/<repo>/resolve/main/<model>.gguf"
  exit 1
fi

if [[ ! "${MODEL_URL}" =~ ^https?:// ]]; then
  echo "[ERROR] MODEL_URL must start with http:// or https://" >&2
  exit 1
fi

RAW_NAME="${2:-$(basename "${MODEL_URL}")}"
MODEL_FILENAME=$(echo "${RAW_NAME}" | tr -cd 'a-zA-Z0-9_.-')
if [ -z "${MODEL_FILENAME}" ]; then
  MODEL_FILENAME="model.gguf"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/bootstrap_node.sh" ]; then
    exec bash "${SCRIPT_DIR}/bootstrap_node.sh" --provider=daytona --role=llama --model-url="${MODEL_URL}" --model-filename="${MODEL_FILENAME}"
else
    echo "[ERROR] bootstrap_node.sh not found in ${SCRIPT_DIR}" >&2
    exit 1
fi
