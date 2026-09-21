#!/usr/bin/env bash
# ==============================================================================
# verify_setup.sh - Automated Diagnostics & Health Verification for OpenClaw
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Running OpenClaw, Channels & Relay Diagnostics"
echo "=========================================================="

FAILED=0

# 1. Check Supervisor Service Status
echo ""
echo "[1/6] Checking Supervisor Daemon Services..."
if sudo supervisorctl status; then
    echo "✔ Supervisor services are active."
else
    echo "✘ Supervisor check failed!"
    FAILED=$((FAILED + 1))
fi

# 2. Validate OpenClaw Configuration File
echo ""
echo "[2/6] Validating OpenClaw Configuration..."
if openclaw config validate; then
    echo "✔ OpenClaw configuration is valid."
else
    echo "✘ OpenClaw configuration validation failed!"
    FAILED=$((FAILED + 1))
fi

# 3. Check Channel Connection Status
echo ""
echo "[3/6] Checking Channels Status (Telegram & Discord)..."
if openclaw channels status; then
    echo "✔ Channels status reported."
else
    echo "✘ Channel status check failed!"
    FAILED=$((FAILED + 1))
fi

# 4. Check OpenClaw Models Count
echo ""
echo "[4/6] Checking Active Models Catalog..."
MODEL_COUNT=$(openclaw models list 2>/dev/null | grep -E '^omniroute/' | wc -l || true)
echo "Total OmniRoute models loaded in OpenClaw: $MODEL_COUNT"
if [ "$MODEL_COUNT" -gt 0 ]; then
    echo "✔ Models catalog is populated."
else
    echo "✘ No models loaded in OpenClaw!"
    FAILED=$((FAILED + 1))
fi

# 5. Check OmniRoute Gateway Health (if active)
echo ""
echo "[5/6] Checking OmniRoute Gateway Endpoint (if applicable)..."
OMNIROUTE_KEY="${OMNIROUTE_API_KEY:-sk-omniroute-openclaw-key}"
if curl -s -f -H "Authorization: Bearer ${OMNIROUTE_KEY}" http://127.0.0.1:20128/v1/models >/dev/null 2>&1; then
    GATEWAY_COUNT=$(curl -s -H "Authorization: Bearer ${OMNIROUTE_KEY}" http://127.0.0.1:20128/v1/models | jq '.data | length' 2>/dev/null || echo "0")
    echo "✔ OmniRoute is responding with $GATEWAY_COUNT active models."
else
    echo "ℹ OmniRoute not responding or not enabled (port 20128)."
fi

# 6. Check Egress Relay Health (if Xray active)
echo ""
echo "[6/6] Checking Egress Relay & Discord Gateway Tunnel..."
if sudo supervisorctl status xray >/dev/null 2>&1; then
    if curl -s -m 5 -x http://127.0.0.1:10808 -I https://gateway.discord.gg >/dev/null 2>&1; then
        echo "✔ Egress Relay active (Discord Gateway reachable through tunnel)."
    else
        echo "✘ Egress Relay running but tunnel request failed!"
        FAILED=$((FAILED + 1))
    fi
else
    echo "ℹ Xray egress relay not installed or not managed by supervisor."
fi

echo ""
echo "=========================================================="
if [ "$FAILED" -eq 0 ]; then
    echo " All verification tests passed successfully! "
    echo "=========================================================="
    exit 0
else
    echo " Diagnostics finished with $FAILED failures. Check logs above. "
    echo "=========================================================="
    exit 1
fi
