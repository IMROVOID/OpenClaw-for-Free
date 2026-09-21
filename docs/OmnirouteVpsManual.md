# OmniRoute AI Gateway: Complete Technical Manual

> **Scope**: Cloud VPS Instance (Daytona Cloud / Freestyle.sh, `Ubuntu Linux 22.04 / 24.04 LTS`, `Node.js 22 LTS`, `OmniRoute 3.8.50`, `x86_64`)  
> **Service Port**: `20128` (Listening on `0.0.0.0` inside VPS container)  
> **Management CLI**: `omniroute` & `scripts/sync_omniroute.py`

## Table of Contents

1. [System Architecture & Topology](#1-system-architecture--topology)
2. [Process & Service Management](#2-process--service-management)
3. [Upstream Provider Inventory](#3-upstream-provider-inventory)
4. [Virtual Routing & Alias Engine](#4-virtual-routing--alias-engine)
5. [Database Architecture & Storage](#5-database-architecture--storage)
6. [Authentication & Remote Dashboard Access](#6-authentication--remote-dashboard-access)
7. [REST API Reference & Usage Examples](#7-rest-api-reference--usage-examples)
8. [Maintenance & Diagnostics](#8-maintenance--diagnostics)
9. [Llama Inference Integration & Rate-Limit Fixes](#9-llama-inference-integration--rate-limit-fixes)

## 1. System Architecture & Topology

OmniRoute is an ultra-low latency, OpenAI-compatible AI gateway and multiplexer. It aggregates multiple AI model providers into a unified endpoint, handles transparent fallback, token pooling, rate-limit balancing, and model alias routing:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              CLOUD VPS INSTANCE                               │
│                                                                               │
│  [OpenClaw Agent]            [External REST Clients]         [Admins / CLI]   │
│  127.0.0.1:18789             Bearer: sk-omniroute-...        <admin-password> │
│         │                               │                         │           │
│         └───────────────────────┬───────┴─────────────────────────┘           │
│                                 ▼                                             │
│                 ┌───────────────────────────────┐                             │
│                 │   OmniRoute Gateway Daemon    │                             │
│                 │      (Port: 20128 / HTTP)     │                             │
│                 └───────────────┬───────────────┘                             │
│                                 │                                             │
│        ┌────────────────────────┼────────────────────────┐                    │
│        ▼                        ▼                        ▼                    │
│  ┌──────────────┐      ┌─────────────────┐      ┌─────────────────┐           │
│  │ Model Router │      │ SQLite Database │      │ Logging & Audit │           │
│  │ (500+ Models)│      │  storage.sqlite │      │ /var/log/omni...│           │
│  └──────┬───────┘      └─────────────────┘      └─────────────────┘           │
│         │                                                                     │
└─────────┼─────────────────────────────────────────────────────────────────────┘
          │ Outbound TLS API Requests (Upstream Providers)
          ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           UPSTREAM AI PROVIDERS                               │
│                                                                               │
│  • OpenAI (Direct)          • Anthropic (Direct)       • Google Gemini        │
│  • OpenRouter               • Nvidia NIM               • B.AI                 │
│  • Qwen (DashScope)         • DeepSeek                 • Groq                 │
│  • Cloudflare Workers AI    • Apinex (Free Tier)       • Local/Remote Llama   │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 2. Process & Service Management

OmniRoute on the VPS is managed as a persistent service via `supervisord`:

### Configuration File (`/etc/supervisor/conf.d/omniroute.conf`)

```ini
[program:omniroute]
command=/usr/local/share/nvm/current/bin/omniroute serve --port 20128 --no-open
directory=/home/daytona
user=daytona
autostart=true
autorestart=true
startretries=5
redirect_stderr=true
stdout_logfile=/var/log/omniroute.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=5
environment=HOME="/home/daytona",USER="daytona",PATH="/usr/local/share/nvm/current/bin:/usr/local/bin:/usr/bin:/bin"
```

### CLI Service Commands

```bash
# Check service status
sudo supervisorctl status omniroute

# Restart the OmniRoute gateway
sudo supervisorctl restart omniroute

# Stop the service
sudo supervisorctl stop omniroute

# Tail live gateway access and inference logs
tail -n 50 -f /var/log/omniroute.log
```

*(You can also manage this remotely via Option `[4]` in the [ControlPanelTui.md](ControlPanelTui.md)).*

## 3. Upstream Provider Inventory

OmniRoute aggregates multiple upstream providers to provide extensive model coverage:

- **OpenAI Direct**: `gpt-4o`, `o3-mini`, `gpt-4.5-preview`
- **Anthropic Direct**: `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-opus`
- **Google Gemini**: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash-thinking`
- **OpenRouter**: DeepSeek R1, Claude 3.7 Sonnet, Mistral Large
- **Dedicated Llama VPS**: `daytona-llama/qwen3.5-9b-defiant-fable` (see [DaytonaLlamaSetup.md](DaytonaLlamaSetup.md))

## 4. Virtual Routing & Alias Engine

OmniRoute defines **Smart Virtual Aliases** allowing applications to target high-level capabilities rather than hardcoded model strings:

- `auto/best-chat`: Automatically selects between Claude 3.7 Sonnet, GPT-4o, and Gemini 2.5 Pro based on health, latency, and rate-limit quotas.
- `auto/best-coding`: Automatically selects the strongest coding model (Claude 3.7 Sonnet, DeepSeek V3, Qwen 2.5 Coder 32B).
- `auto/best-reasoning`: Directs queries to reasoning models (o3-mini, DeepSeek R1, QwQ-32B).
- `auto/best-free`: Directs traffic to zero-cost upstream providers.
- `auto/pro-coding`: Prioritizes maximum-context models (Claude 3.7 200k, Gemini 2.5 Pro 2M).

## 5. Database Architecture & Storage

OmniRoute persists its provider connections, API keys, and routing tables inside an embedded SQLite database:

- **Database File**: `/home/daytona/.omniroute/storage.sqlite`
- **Synchronization Script**: [scripts/sync_omniroute.py](../scripts/sync_omniroute.py) handles programmatic model synchronization and rate limit overrides.

### Key Database Queries

```bash
# List all active client API keys
sqlite3 ~/.omniroute/storage.sqlite "SELECT id, name, token FROM api_keys;"

# Check total registered models count
sqlite3 ~/.omniroute/storage.sqlite "SELECT COUNT(*) FROM provider_nodes;"

# List enabled provider connection names
sqlite3 ~/.omniroute/storage.sqlite "SELECT DISTINCT provider FROM provider_connections WHERE is_active=1;"
```

## 6. Authentication & Remote Dashboard Access

1. **Admin Master Password**: Used for logging into the OmniRoute administration dashboard at `http://localhost:20128/dashboard`.
2. **Client Bearer Key**: `sk-omniroute-openclaw-key` used by OpenClaw and external REST clients to query `/v1/chat/completions`.
3. **Tunneling via Control Panel**: Press `[2]` in [ControlPanelTui.md](ControlPanelTui.md) to automatically forward port `20128`, copy the password, and launch your browser.

## 7. REST API Reference & Usage Examples

All requests require the authorization header:

```
Authorization: Bearer sk-omniroute-openclaw-key
```

### Streaming Chat Completion

```bash
curl -N -s -H "Authorization: Bearer sk-omniroute-openclaw-key" \
     -H "Content-Type: application/json" \
     http://127.0.0.1:20128/v1/chat/completions \
     -d '{
       "model": "auto/best-coding",
       "stream": true,
       "messages": [
         {"role": "user", "content": "Write a python script to check disk usage."}
       ]
     }'
```

## 8. Maintenance & Diagnostics

```bash
# Query OmniRoute health endpoint
curl -s http://127.0.0.1:20128/health | jq .

# Database vacuuming
sqlite3 /home/daytona/.omniroute/storage.sqlite "PRAGMA optimize; VACUUM;"
```

## 9. Llama Inference Integration & Rate-Limit Fixes

### Rate-Limit Bottleneck Removal (HTTP 504 Fix)

OmniRoute's default Bottleneck rate limiter had a 15-second execution deadline (`maxWaitMs = 15000ms`). On a CPU instance, long prompt evaluations exceeded 15s. This is resolved via:

1. In `/home/daytona/.omniroute/.env`:

   ```env
   RATE_LIMIT_MAX_WAIT_MS=3600000
   OMNIROUTE_REQUEST_TIMEOUT_MS=3600000
   STREAM_THROUGHPUT_WATCHDOG_ENABLED=false
   ```

2. In SQLite `storage.sqlite`:

   ```sql
   UPDATE provider_connections 
   SET rate_limit_protection = 0,
       rate_limit_overrides_json = '{"maxWaitMs": 3600000, "concurrentRequests": 1}'
   WHERE id = '<connection-uuid>';
   ```

This allows prompts of any length to evaluate without premature timeout disconnection.
