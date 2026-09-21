# OpenClaw-for-free — Operational Runbook

> **Scope**: Production deployment, telemetry monitoring, incident response, troubleshooting, and disaster recovery for OpenClaw-for-free.

## 1. Deployment Procedures

### 1.1 Primary Cloud VPS Deployment (OpenClaw + OmniRoute)

1. **Provision Container**:
   - **Daytona Cloud**: Create an Ubuntu 22.04 workspace via Daytona REST API (max 4 vCPU, 8 GB RAM, 10 GB disk).
   - **Freestyle.sh**: Create a container with 32 GB disk and direct internet egress.
2. **Bootstrap Services**:
   - Run `scripts/bootstrap_node.sh` to install Node.js 22 LTS, supervisor, and system tools.
   - Run `scripts/setup_vps.sh` to initialize OpenClaw and OmniRoute daemons under `supervisord`.
3. **Verify Supervisord Services**:

   ```bash
   sudo supervisorctl status
   # Expected output:
   # omniroute        RUNNING   pid 1234, uptime 0:10:00
   # openclaw         RUNNING   pid 1235, uptime 0:10:00
   # xray             RUNNING   pid 1236, uptime 0:10:00 (Daytona only)
   ```

### 1.2 Dedicated Secondary VM Deployment (llama.cpp)

1. **Deploy Dedicated VM**:
   - Run `scripts/setup-daytona-llama.sh` or configure via Control Panel TUI / Telegram Bot.
   - Set up `llama-server` on port `8080` with `--jinja`, Flash Attention, and AVX-512 CPU flags.
2. **Model Download & KV Cache Allocation**:
   - Recommended GGUF models: `Qwen 3.5 9B` or `Qwen 2.5 7B`.
   - Ensure KV cache compression (`--cache-type-k q4_0 --cache-type-v q4_0`) to fit within 8 GB RAM cgroups.

### 1.3 Railway Edge Relays Deployment

Deploy the required micro-services to Railway (`https://railway.app`):

- **Egress Gateway Relay (`railway-gateway-relay`)**:
  - Deploys Alpine Linux with Xray-core v26.3.27.
  - Generates a pre-shared UUID for VLESS over TLS WebSocket (`/api/v1/relay-stream`).
- **Llama SSE Streaming Proxy (`railway-llama-relay`)**:
  - Deploys Node.js 22 LTS streaming reverse proxy with `server.setTimeout(0)`.
  - Exposes Daytona preview port as standard OpenAI `/v1/chat/completions`.
- **Unified Web Ingress Relay (`railway-web-relay`)**:
  - Exposes OpenClaw (`/openclaw`), OmniRoute (`/omniroute`), and LLaMA (`/llama`) on a single permanent HTTPS domain.

### 1.4 Single-Domain Unified Web Ingress (Caddy on Freestyle.sh)

On Freestyle.sh instances, avoid Railway entirely by using Caddy:

```bash
sudo apt install -y caddy
# Configure /etc/caddy/Caddyfile with path-based reverse proxy recipes
sudo systemctl restart caddy
```

(See [docs/PublicWebIngressAndDomains.md](PublicWebIngressAndDomains.md) for complete Caddy recipes.)

## 2. Health Checks & Monitoring

### 2.1 Service Health Endpoints

| Component | Endpoint | Expected Response |
| :--- | :--- | :--- |
| **OpenClaw Gateway** | `http://127.0.0.1:18789/` | HTTP 200 / WebSocket handshake |
| **OmniRoute Multiplexer** | `http://127.0.0.1:20128/v1/models` | HTTP 200 JSON listing models |
| **Local llama-server** | `http://127.0.0.1:8080/health` | `{"status": "ok"}` |
| **Railway Web Relay** | `https://<relay>.up.railway.app/health` | `{"status": "healthy"}` |
| **Railway Llama Relay** | `https://<relay>.up.railway.app/health` | `{"status": "ok"}` |

### 2.2 Telemetry Monitoring

- **Control Panel TUI**: Press `[D]` to view real-time CPU load, memory utilization, disk space, and inference latency.
- **Telegram Bot Assistant**: Use `/diagnostics` command to query hardware telemetry and `/ping` to measure LLM response latency.
- **Supervisord CLI**:

  ```bash
  sudo supervisorctl status
  ```

## 3. Common Failure Modes & Troubleshooting

### Issue 1: Stale Local Ports (`18789`, `20128`, or `8080` already bound)

- **Symptom**: `Error: listen EADDRINUSE: address already in use 127.0.0.1:18789`.
- **Cause**: Orphaned background `ssh.exe` tunneling processes from previous sessions.
- **Fix**:
  - Inside Control Panel TUI: Press `[T]` to automatically terminate orphaned processes.
  - Windows PowerShell:

    ```powershell
    Get-Process -Name ssh -ErrorAction SilentlyContinue | Stop-Process -Force
    ```

  - Linux/macOS:

    ```bash
    pkill -f "ssh.*18789"
    ```

### Issue 2: Daytona Outbound Firewall Blocks (`ECONNRESET`)

- **Symptom**: Discord Gateway or external API calls fail with connection reset errors on Daytona.
- **Cause**: Daytona hypervisor drops non-whitelisted outbound TLS traffic on port 443.
- **Fix**:
  1. Verify Xray daemon status on the VPS:

     ```bash
     sudo supervisorctl status xray
     ```

  2. Test egress through local Xray forward proxy:

     ```bash
     curl -x http://127.0.0.1:10808 https://discord.com/api/v10/gateway
     ```

  3. Ensure `openclaw.json` has `channels.discord.proxy = "http://127.0.0.1:10808"`.

### Issue 3: Telegram Error 409 Conflict (`Conflict: terminated by other getUpdates request`)

- **Symptom**: Telegram bot stops receiving messages; logs show HTTP 409 Conflict.
- **Cause**: Multiple polling processes running simultaneously using the same `TELEGRAM_BOT_TOKEN`.
- **Fix**:
  1. Check for running bot instances locally and on remote VPS:

     ```bash
     pgrep -fl "telegram-bot"
     pgrep -fl "openclaw"
     ```

  2. Terminate the rogue poller. OpenClaw and the Telegram Assistant should not run polling on the exact same token if both are active.

### Issue 4: Llama.cpp 8 GB Memory Cgroup OOM

- **Symptom**: `llama-server` process gets killed abruptly with exit code 137 (SIGKILL).
- **Cause**: Total memory (model weights + KV cache + context buffer) exceeded the 8 GB cgroup limit.
- **Fix**:
  1. Reduce context size from 32k to 16k or 8k in `llama-server` flags (`-c 16384`).
  2. Enable 4-bit KV cache compression:

     ```bash
     --cache-type-k q4_0 --cache-type-v q4_0
     ```

  3. Select a higher quantization variant (e.g., `IQ3_M` instead of `Q5_K_M`).

### Issue 5: Question Mark Bug in GGUF Model Output

- **Symptom**: Model generates repetitive `? ? ? ?` tokens or garbled text.
- **Cause**: Missing or incorrect chat template formatting with `--jinja` in `llama-server`.
- **Fix**:
  - Always launch `llama-server` with `--jinja` flag enabled so the model's native embedded Jinja template is utilized.

### Issue 6: Expired Daytona SSH Workspace Token

- **Symptom**: SSH connections fail with `Permission denied (publickey)`.
- **Cause**: Daytona workspace SSH tokens expire periodically.
- **Fix**:
  - The Control Panel and Telegram Bot use `VmSshAutoRenewer` to automatically refresh tokens via the Daytona REST API.
  - Manual renewal: Query `https://app.daytona.io/api/workspace/{id}` to fetch a fresh SSH access token.

## 4. Rollback & Disaster Recovery Procedures

### 4.1 Automatic VM Recovery Assistant

- **In Telegram Bot**: Send `/recovery` to launch the automated recovery workflow.
- **In Control Panel TUI**: Select Option `[R] VM Recovery & Auto-Repair`.
- The recovery engine:
  1. Probes SSH reachability and authentication.
  2. Verifies installed binaries and directory structures.
  3. Regenerates missing supervisor configurations.
  4. Restarts daemons and confirms live socket binding.

### 4.2 Manual Service Restart

If automated recovery fails, perform a manual restart via SSH:

```bash
# Restart all managed services
sudo supervisorctl restart all

# Tail logs to verify clean boot
sudo supervisorctl tail -f openclaw stderr
sudo supervisorctl tail -f omniroute
```

### 4.3 Clean Slate Re-Onboarding

To reset local configuration and start onboarding afresh:

```bash
# Remove local cached configuration
rm ~/.openclaw-control-panel.json
```

Then launch `npm start` or `npm run start:bot` to run the setup wizard.
