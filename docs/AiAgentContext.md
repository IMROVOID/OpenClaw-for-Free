# AI Agent Environment & Operational Context

> **Audience**: Autonomous AI Agents (Cursor, Claude Code, Copilot, OpenCode, Aider, Antigravity, OpenClaw)  
> **Environment**: Dual Cloud Linux Containers (Daytona Cloud / Freestyle.sh, `Ubuntu 22.04 LTS`, `x86_64`) + Railway Relays + Local Windows Workstation  
> **Context File**: System Prompt Injection / Agent Workspace Context

## 1. System Topology & Architecture

This infrastructure consists of synchronized Cloud VPS containers, cloud edge relays on Railway, and local management launchers on Windows:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                DUAL-VPS SYSTEM TOPOLOGY                                │
│                                                                                        │
│   [Primary Cloud VPS: OpenClaw + OmniRoute Agent Hub]                                  │
│   SSH: <primary-vps-id>@ssh.app.daytona.io                                             │
│      ├── openclaw  (Port: 18789, Node.js Agent + Telegram & Discord channels)          │
│      ├── omniroute (Port: 20128, Fast LLM Proxy + SQLite DB + Virtual Routers)         │
│      └── xray      (Port: 10808, Outbound Egress Relay to Railway WSS:443, Daytona)    │
│                                                                                        │
│   [Secondary Dedicated VM: Llama.cpp Inference Engine]                                 │
│   SSH: <secondary-vps-id>@ssh.app.daytona.io (Freestyle or Daytona)                    │
│      └── llama-server (Port: 8080, GGUF MTP Model, 32k Context)                        │
│             └── Exposed via Daytona Preview or direct Freestyle IP                     │
│                                                                                        │
│   [Railway Cloud Relays (for Daytona)]                                                 │
│      ├── Egress Relay (WSS / VLESS): <your-egress-relay>.up.railway.app                │
│      │     └── Bypasses Daytona outbound firewall for Discord Gateway (443)            │
│      └── Llama SSE Relay (HTTPS Reverse Proxy): <your-llama-relay>.up.railway.app      │
│            └── Strips auth & handles infinite SSE timeouts for OpenAI /v1 endpoint     │
│                                                                                        │
│   [Local Workstation / Windows PC]                                                     │
│      └── bin/OpenClaw-Control-Panel.exe (Flagship Unified TUI Control Panel)           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Core Service Endpoints & Credential Matrix

| Service | Protocol / Endpoint | Auth Method / Secret | Default Role / Notes |
| :--- | :--- | :--- | :--- |
| **Control Panel TUI** | `bin/OpenClaw-Control-Panel.exe` | Persistent `~/.openclaw-control-panel.json` | Unified multi-server management & TUI |
| **OmniRoute Gateway** | `http://127.0.0.1:20128/v1` | `Bearer <your-omniroute-key>` | OpenAI-compatible multiplexer |
| **Daytona Llama Endpoint** | `https://<your-llama-relay>.up.railway.app/v1` | Public / Open (`none` or any string) | GGUF MTP (CPU) model |
| **Llama VPS Direct UI** | `http://127.0.0.1:8080` (via SSH tunnel) | None (Local loopback) | Option `[3]` in Control Panel TUI |
| **OpenClaw WebUI** | `http://127.0.0.1:18789` (via SSH tunnel) | `?token=<your-openclaw-token>` | Option `[1]` in Control Panel TUI |
| **Telegram Bot Channel** | Polling Mode | Bot Token `<YOUR_TELEGRAM_BOT_TOKEN>` | `@your_bot_name` (Native polling) |
| **Discord Bot Channel** | Gateway WebSocket | Bot Token `<YOUR_DISCORD_BOT_TOKEN>` | Guild `<YOUR_DISCORD_GUILD_ID>` (Proxied via 10808) |
| **Xray Egress Relay** | `http://127.0.0.1:10808` | `UUID <your-relay-uuid>` | Egress proxy to `<your-egress-relay>.up.railway.app` |

## 3. Strict Rules of Engagement for AI Agents

### NEVER Do These

1. **DO NOT kill supervisor**: Never run `pkill supervisord` or `kill -9 $(pgrep supervisord)`. Use `sudo supervisorctl restart <service>`.
2. **DO NOT run duplicate Telegram pollers**: Never run separate scripts that poll `@your_bot_name`. OpenClaw actively maintains the polling connection; a second poller triggers `TelegramError 409: Conflict`.
3. **Configure Tool Schema Profile for Local llama.cpp Models**: For local models, use `"compat": { "supportsTools": true, "toolSchemaProfile": "llamacpp" }`. `llama-server` runs with native `--jinja` using the model's embedded tool template. The `llamacpp` schema profile normalizes tools into GBNF-friendly representations, preventing rejection while allowing full tool usage.
4. **DO NOT use CPU models for Compaction**: Compaction summarization MUST be delegated to cloud models (`omniroute/auto/best-chat`). Never let a 4-vCPU model compact its own session history.
5. **DO NOT add duplicate Daytona models**: There is only **one** primary local model block in OmniRoute. Inception Labs lives inside OmniRoute under `omniroute/inception/mercury-2`, NOT as a separate provider block in `openclaw.json`.
6. **DO NOT expose OpenClaw or Llama on 0.0.0.0 without Token Auth**: OpenClaw bind is set to `loopback`. Use the dedicated Control Panel or SSH port forwarding.

### ALWAYS Do These

1. **Use `sudo` with `supervisorctl`**: Non-root users get `PermissionError: [Errno 13]`. Services: `openclaw`, `omniroute`, `xray`.
2. **Use OmniRoute for LLM Calls**: Configure `base_url="http://127.0.0.1:20128/v1"` and `api_key="<your-omniroute-key>"`. Use virtual routes like `auto/best-chat` or `auto/best-coding`.
3. **Verify Timeout Bypass Settings**: OmniRoute must have `RATE_LIMIT_MAX_WAIT_MS=3600000`, `OMNIROUTE_REQUEST_TIMEOUT_MS=3600000`, and `STREAM_THROUGHPUT_WATCHDOG_ENABLED=false` in `/home/daytona/.omniroute/.env`, plus `rate_limit_protection = 0` in SQLite.
4. **Discord Gateway Egress**: Discord Gateway MUST route through `http://127.0.0.1:10808` (`channels.discord.proxy`) when running on Daytona. If Discord disconnects, verify `sudo supervisorctl status xray`.
5. **Proactive Context Management**: Inform users about bot commands (`/compact`, `/model`, `/menu`, `/new`, `/settings`) for session lifecycle control.

## 4. Context Window Specifications & Compaction

The OpenClaw runtime is configured with maximal native context windows across all connected providers:

| Model ID | Context Window | Max Output | Compaction Trigger | Primary Recommended Use |
| :--- | :---: | :---: | :---: | :--- |
| `omniroute/auto/gemini-2.5-pro` | **2,000,000** | 65,536 | ~1,600,000 tokens | Massive codebases, video/audio context |
| `omniroute/auto/best-chat` | **1,048,576** | 32,768 | ~838,000 tokens | General reasoning, smart compaction summarizer |
| `omniroute/auto/best-coding` | **1,048,576** | 32,768 | ~838,000 tokens | Multi-file programming and architecture |
| `omniroute/anthropic/claude-3-7-sonnet` | **200,000** | 16,384 | ~160,000 tokens | Precision tool execution, complex logic |
| `omniroute/inception/mercury-2` | **128,000** | 8,192 | ~102,000 tokens | Ultra-fast diffusion LLM inference |
| `omniroute/daytona-llama/qwen3.5-9b-defiant-fable` | **32,768** | 4,096 | ~26,000 tokens | Private local uncensored CPU inference |

### Compaction Delegation Architecture

When a session exceeds its threshold:

1. OpenClaw halts new token ingestion.
2. The session transcript is handed to `compaction.model: "omniroute/auto/best-chat"`.
3. The cloud model summarizes the conversation within 2-3 seconds.
4. The distilled memory is injected into the session state without stressing local CPU inference.

## 5. Agent Diagnostic & Recovery Procedures

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DIAGNOSTIC FLOWCHART                            │
│                                                                        │
│   [Check Process: sudo supervisorctl status]                           │
│   ├── If NOT RUNNING ──> Check /var/log/openclaw/gateway.log           │
│   │                      Clean ~/.openclaw/tmp/openclaw-1001/*.lock*   │
│   │                      Restart: sudo supervisorctl restart all       │
│   └── If RUNNING ──────> Test OmniRoute: curl :20128/v1/models         │
│                          Test Llama Relay: curl /health                │
│                          Test Channels: openclaw channels status       │
└────────────────────────────────────────────────────────────────────────┘
```

### Diagnostic One-Liners

```bash
# 1. Quick environment snapshot on OpenClaw VPS
uptime ; sudo supervisorctl status

# 2. Test OmniRoute connectivity & list models
curl -s -H "Authorization: Bearer sk-omniroute-openclaw-key" http://127.0.0.1:20128/v1/models | jq '.data[0].id'

# 3. Test Llama Railway Relay health
curl -s https://<your-llama-relay>.up.railway.app/health

# 4. Test Llama inference through OmniRoute
curl -s -H "Authorization: Bearer sk-omniroute-openclaw-key" -H "Content-Type: application/json" \
  -d '{"model":"<model-id>","messages":[{"role":"user","content":"ping"}],"max_tokens":5}' \
  http://127.0.0.1:20128/v1/chat/completions | jq .

# 5. Test OpenClaw channel states
openclaw channels status

# 6. Check for stale OpenClaw locks
ls -la /home/daytona/.openclaw/tmp/openclaw-1001/
```

## 6. Workspace Conventions

- **OpenClaw VPS Workspace**: `/home/daytona/.openclaw/workspace`
- **Llama VPS Model Path**: `/home/daytona/models/<model-filename>.gguf`
- **Local Workspace**: Root of this repository
- **Reference Docs**:
  - [ControlPanelTui.md](ControlPanelTui.md) — Unified Control Panel manual
  - [DaytonaLlamaSetup.md](DaytonaLlamaSetup.md) — Llama setup & MTP optimizations
  - [DaytonaNetworkEgress.md](DaytonaNetworkEgress.md) — Network firewall & domain matrix
  - [InstallationGuide.md](InstallationGuide.md) — Installation one-liners & NPX
  - [OmnirouteVpsManual.md](OmnirouteVpsManual.md) — OmniRoute architecture & SQLite
  - [OpenclawManual.md](OpenclawManual.md) — OpenClaw runtime, channels & config
  - [RailwayRelayManual.md](RailwayRelayManual.md) — Dual Railway edge relays
