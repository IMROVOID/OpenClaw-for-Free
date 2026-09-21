#!/usr/bin/env bash
# ==============================================================================
# setup_vps.sh - Daytona VPS Bootstrap Script for OpenClaw & Supervisor
# Unified wrapper around bootstrap_node.sh to prevent code drift
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/bootstrap_node.sh" ]; then
    exec bash "${SCRIPT_DIR}/bootstrap_node.sh" --provider=daytona --role=agent "$@"
else
    echo "[ERROR] bootstrap_node.sh not found in ${SCRIPT_DIR}" >&2
    exit 1
fi
