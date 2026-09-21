# OpenClaw Agent Runtime: Comprehensive Operational Manual

> **Scope**: Cloud VPS Environment (Daytona Cloud / Freestyle.sh, `Ubuntu Linux 22.04 / 24.04 LTS`, `Node.js 22 LTS`, `OpenClaw 2026.9.4`, `x86_64`)  
> **Service Port**: `18789` (Bound to `127.0.0.1` / Loopback)  
> **Programmatic Config**: `scripts/configure_openclaw.py`

## Table of Contents

1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Directory Layout & File Locations](#2-directory-layout--file-locations)
3. [Configuration Analysis (`openclaw.json`)](#3-configuration-analysis-openclawjson)
4. [Telegram & Discord Channels with Per-User Session Isolation](#4-telegram--discord-channels-with-per-user-session-isolation)
5. [Model Routing, Tool Schemas & Bot Response Formatter](#5-model-routing-tool-schemas--bot-response-formatter)
6. [Operational CLI Commands & Cheatsheet](#6-operational-cli-commands--cheatsheet)
7. [Connecting to the OpenClaw Web Control UI](#7-connecting-to-the-openclaw-web-control-ui)
8. [Troubleshooting & Recovery](#8-troubleshooting--recovery)

## 1. System Overview & Architecture

OpenClaw is an autonomous agent runtime capable of multi-turn conversational reasoning, tool/skill execution, codebase navigation, and messaging across chat platforms (Telegram, Discord, etc.).

On the Cloud VPS, OpenClaw operates as a local background daemon supervised by `supervisord`. It uses **OmniRoute** (`http://127.0.0.1:20128/v1`) as its unified LLM gateway:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            CLOUD VPS INSTANCE                           │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                         SUPERVISORD                             │   │
│   │   ┌───────────────────────────┐   ┌───────────────────────────┐ │   │
│   │   │     OpenClaw Gateway      │   │     OmniRoute Gateway     │ │   │
│   │   │      (Port: 18789)        │   │       (Port: 20128)       │ │   │
│   │   │  /usr/local/bin/openclaw  │   │  /usr/local/bin/omniroute │ │   │
│   │   └─────────────┬─────────────┘   └─────────────▲─────────────┘ │   │
│   │                 │                               │               │   │
│   └─────────────────┼───────────────────────────────┼───────────────┘   │
│                     │                               │                   │
│                     ▼                               │                   │
│       ┌───────────────────────────┐                 │                   │
│       │   Active Agent ("main")   ├─────────────────┘                   │
│       │   Workspace: ~/.workspace│   Bearer: sk-omniroute-openclaw-key │
│       └─────────────┬─────────────┘                                     │
│                     │                                                   │
│   ┌─────────────────▼───────────────────────────────────────────────┐   │
│   │                   CHANNELS & I/O INTERFACES                     │   │
│   │                                                                 │   │
│   │   [Telegram Channel]              [Gateway Web UI / REST]       │   │
│   │   Bot: @your_bot_name             Host: 127.0.0.1:18789         │   │
│   │   Mode: Long-Polling              Auth: Bearer <your-token>...  │   │
│   └─────────▲──────────────────────────────────▲────────────────────┘   │
└─────────────┼──────────────────────────────────┼────────────────────────┘
              │ Long-Polling (HTTPS)             │ Local Port Forwarding
              ▼                                  ▼
      Telegram Cloud Servers            Local Windows PC / Browser
```

## 2. Directory Layout & File Locations

| Path | Owner / Perms | Description |
| :--- | :--- | :--- |
| `/home/daytona/.openclaw/` | `daytona:daytona` | OpenClaw home directory |
| `/home/daytona/.openclaw/openclaw.json` | `600` | Master OpenClaw configuration file |
| `/home/daytona/.openclaw/workspace/` | `755` | Working directory where agent creates files |
| `/home/daytona/.openclaw/agents/main/agent/` | `755` | Agent state, prompt history, memory caches |
| `/usr/local/bin/openclaw` | `symlink` | OpenClaw CLI executable |
| `/etc/supervisor/conf.d/openclaw.conf` | `644` | Supervisor program specification |
| `/var/log/openclaw/gateway.log` | `daytona:daytona` | OpenClaw standard output log |

## 3. Configuration Analysis (`openclaw.json`)

The programmatic setup is managed by [scripts/configure_openclaw.py](../scripts/configure_openclaw.py).

### Agents & Multimodal Vision Configuration

```json
{
  "agents": {
    "defaults": {
      "workspace": "/home/daytona/.openclaw/workspace",
      "model": {
        "primary": "omniroute/auto/best-chat",
        "fallbacks": ["omniroute/auto/best-coding"]
      },
      "imageModel": {
        "primary": "omniroute/gemini/gemini-2.5-flash",
        "fallbacks": ["omniroute/openai/gpt-5.6", "omniroute/anthropic/claude-sonnet-5"]
      }
    }
  }
}
```

- **Image Understanding Model (`imageModel`)**: Dedicated vision model fallback (`gemini-2.5-flash` with `gpt-5.6` / `claude-sonnet-5` fallbacks). Incoming images are automatically routed through `imageModel` so multimodal tasks never fail.

### Proactive Compaction & Context Safeguards

```json
{
  "agents": {
    "defaults": {
      "timeoutSeconds": 1800,
      "compaction": {
        "enabled": true,
        "mode": "safeguard",
        "keepRecentTokens": 30000,
        "recentTurnsPreserve": 6,
        "midTurnPrecheck": { "enabled": true },
        "memoryFlush": { "enabled": true, "softThresholdTokens": 4000 },
        "model": "omniroute/auto/best-chat",
        "timeoutSeconds": 300
      }
    }
  }
}
```

## 4. Telegram & Discord Channels with Per-User Session Isolation

```json
{
  "session": {
    "dmScope": "per-channel-peer"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "<YOUR_TELEGRAM_BOT_TOKEN>",
      "dmPolicy": "open",
      "capabilities": {
        "inlineButtons": "all"
      },
      "customCommands": [
        { "command": "menu", "description": "Show interactive settings & controls menu" },
        { "command": "settings", "description": "Show bot settings & parameters" }
      ]
    },
    "discord": {
      "enabled": true,
      "token": "<YOUR_DISCORD_BOT_TOKEN>",
      "proxy": "http://127.0.0.1:10808",
      "dmPolicy": "open"
    }
  }
}
```

- **Per-User Session Isolation (`dmScope: "per-channel-peer"`)**: Each user receives their own isolated session (`agent:main:telegram:peer:<userId>` or `agent:main:discord:peer:<userId>`). Conversations, context windows, and turn histories are never mixed across users.
- **Discord Proxy**: When running on Daytona Cloud, traffic to `gateway.discord.gg` routes through `http://127.0.0.1:10808` to bypass firewall blocks (see [DaytonaNetworkEgress.md](DaytonaNetworkEgress.md)). On Freestyle.sh, direct connections work without a proxy.

## 5. Model Routing, Tool Schemas & Bot Response Formatter

### Model Routing

All models route through OmniRoute (see [OmnirouteVpsManual.md](OmnirouteVpsManual.md)). OpenClaw sets physical context limits for each:

- Gemini 2.5 Pro: **2,000,000** (2M) tokens
- Gemini Flash & DeepSeek: **1,000,000** (1M) tokens
- Local Llama Qwen 3.5 9B MTP: **32,768** tokens (fitted for 8GB RAM cgroup)

### Tool Schemas & Normalization

For local llama.cpp models, OpenClaw configures `"compat": { "supportsTools": true, "toolSchemaProfile": "llamacpp" }`, converting tool declarations to GBNF format while preserving complete access to file, execution, and subagent tools.

### Bot Response Formatter Plugin (`plugins/bot-response-formatter/`)

- Renders thinking process as styled 1-2 line blockquotes (`Thinking: ...`).
- Appends context occupancy and latency metrics at the bottom of messages (`Context: 12.4k / 32.7k | 1.8s`).

## 6. Operational CLI Commands & Cheatsheet

```bash
# Check supervisor daemon status
sudo supervisorctl status

# Check OpenClaw channel connectivity
openclaw channels status

# Check configured models
openclaw models status

# View live gateway logs
tail -n 50 -f /var/log/openclaw/gateway.log

# Restart OpenClaw daemon
sudo supervisorctl restart openclaw
```

## 7. Connecting to the OpenClaw Web Control UI

1. **Option `[1]` in Unified Control Panel**: Double click `bin/OpenClaw-Control-Panel.exe` and press `1` (see [ControlPanelTui.md](ControlPanelTui.md)).
2. **Manual SSH Port Forward**:

   ```bash
   ssh -N -L 18789:127.0.0.1:18789 <user>@<host>
   ```

   Open `http://127.0.0.1:18789/?token=<your-token>` in your browser.

## 8. Troubleshooting & Recovery

### Lock File Conflict on Boot

If OpenClaw reports a stale lock on startup, remove the lock file:

```bash
rm -f /home/daytona/.openclaw/tmp/openclaw-1001/*gateway*.lock* 2>/dev/null
sudo supervisorctl restart openclaw
```

### Discord Reconnect Loops (`ECONNRESET`)

Verify that the Xray egress proxy is running on port 10808 (`sudo supervisorctl status xray`) and that Railway egress relay is reachable. See [DaytonaNetworkEgress.md](DaytonaNetworkEgress.md) and [RailwayRelayManual.md](RailwayRelayManual.md).
