# OpenClaw Telegram Bot Assistant: Operations & Setup Manual

> **Scope**: Remote Cloud VPS Management (Daytona Cloud & Freestyle.sh) via Telegram  
> **Source Directory**: `src/telegram-bot/`  
> **Framework**: [GrammY](https://grammy.dev/) Telegram Bot Framework (v1.46+)  
> **Runtime**: Node.js 22 LTS (ESM, TypeScript)

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Quick Start & Launching](#2-quick-start--launching)
3. [Bot Command Reference](#3-bot-command-reference)
4. [Interactive Workflows](#4-interactive-workflows)
   - [A. Main Menu Dashboard](#a-main-menu-dashboard)
   - [B. 7-Step Onboarding Setup Assistant](#b-7-step-onboarding-setup-assistant)
   - [C. Virtual Machine Recovery & Repair](#c-virtual-machine-recovery--repair)
   - [D. Remote Service Manager](#d-remote-service-manager)
   - [E. Diagnostics & Hardware Telemetry](#e-diagnostics--hardware-telemetry)
   - [F. Live Service Logs](#f-live-service-logs)
5. [Self-Healing Daytona SSH Tokens](#5-self-healing-daytona-ssh-tokens)
6. [Security & Access Control](#6-security--access-control)
7. [Daemonization (PM2 & Systemd)](#7-daemonization-pm2--systemd)
8. [Automated Testing](#8-automated-testing)

## 1. Overview & Architecture

The **OpenClaw Telegram Bot Assistant** replicates the entire installation, setup, onboarding, service management, and VM recovery workflows into an interactive, mobile-friendly Telegram bot interface.

Built using the **GrammY** framework, it connects directly with your cloud VPS instances (Freestyle.sh 32GB direct-egress containers or Daytona Cloud workspaces) without requiring you to sit in front of a desktop terminal.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                        TELEGRAM BOT INTERACTION FLOW                       │
│                                                                            │
│    [User / Admin via Telegram Client]                                      │
│                   │                                                        │
│                   ▼ (HTTPS Long-Polling)                                   │
│    [GrammY Telegram Bot Assistant (src/telegram-bot)]                      │
│       ├── Auth Middleware (Owner ID Verification & Gatekeeping)            │
│       ├── Error Boundary Middleware (Secret Masking & Alerts)              │
│       ├── Session State Store (Multi-Step Onboarding & Recovery Flows)     │
│       └── Shared Core Services (src/control-panel/core/*)                  │
│                   │                                                        │
│         ┌─────────┴──────────────────────────────┐                         │
│         ▼                                        ▼                         │
│    [Primary Cloud VPS]                    [Secondary Dedicated VM]         │
│    (Daytona or Freestyle)                 (llama.cpp Inference)            │
│    • OpenClaw Gateway (:18789)            • llama-server (:8080)           │
│    • OmniRoute AI Router (:20128)         • Qwen 2.5 7B/14B GGUF           │
│    • Supervisord Daemons                  • AVX-512 Native                 │
└────────────────────────────────────────────────────────────────────────────┘
```

## 2. Quick Start & Launching

### Prerequisites

1. **Telegram Bot Token**: Create a bot and obtain an API token from [@BotFather](https://t.me/BotFather) on Telegram (`/newbot`).
2. **Owner Telegram ID**: Obtain your numeric Telegram User ID from [@userinfobot](https://t.me/userinfobot) to lock down administrative access.

### Launching the Bot

#### Option A: Via NPM Script with Environment Variables (Recommended)

```bash
# Set credentials
export TELEGRAM_BOT_TOKEN="123456789:AAEkd9342klsfj238947230492834"
export TELEGRAM_OWNER_ID="123456789"

# Start bot
npm run start:bot
```

#### Option B: CLI Flags

```bash
npx tsx src/telegram-bot/index.ts --token "123456789:AAEkd9342klsfj..." --owner 123456789
```

#### Option C: Windows PowerShell

```powershell
$env:TELEGRAM_BOT_TOKEN="123456789:AAEkd9342klsfj238947230492834"
$env:TELEGRAM_OWNER_ID="123456789"
npm run start:bot
```

## 3. Bot Command Reference

| Command | Description |
| :--- | :--- |
| `/start` or `/menu` | Open the main interactive dashboard with live status indicators and inline buttons |
| `/onboard` or `/setup` | Launch the 7-step guided setup assistant for Daytona or Freestyle |
| `/recovery` | Launch the VM recovery assistant to diagnose unreachable nodes or repair missing daemons |
| `/services` | Open the remote service manager to start, stop, restart, or update supervisor daemons |
| `/diagnostics` | Query real-time CPU, RAM, disk, load average, and process telemetry |
| `/logs` | View tail logs for OpenClaw, OmniRoute, Llama, or Xray Relay |
| `/ping` | Test live inference latency against OmniRoute's `/v1/models` route |
| `/cancel` | Cancel any active multi-step setup or recovery wizard and return to the main menu |
| `/help` | Display command guide and operational cheat-sheet |

## 4. Interactive Workflows

### A. Main Menu Dashboard

Upon sending `/menu` or tapping **Refresh Status**, the bot provides immediate visual feedback with an interim loading state (`[STATUS] Refreshing system telemetry and checking daemons...`) while it queries reachability and daemon health across both Primary and Secondary instances:

```text
*OPENCLAW & DAYTONA CONTROL PANEL*

*Primary Target*:
`CuACc0hO5KGEshdmjx7LU6C1MyqRSQ4s@ssh.app.daytona.io`
*Secondary Target*:
`OKFCMLLVct5YjyOjOi3wrOT3d3StzZ4z@ssh.app.daytona.io`

*SYSTEM STATUS*
🟢 Primary SSH Reachability : REACHABLE
🟢 OpenClaw (Port 18789) : ONLINE
🟢 OmniRoute (Port 20128) : ONLINE
🟢 Llama AI (Port 8080) : ONLINE
🟢 Railway Egress Relay : ONLINE

[OpenClaw WebUI]         [OmniRoute WebUI]
[Llama AI WebUI]         [Service Manager]
[Diagnostics & Telemetry][Service Logs]
[SSH Terminal Info]      [API / Model Ping]
[Setup Assistant]        [VM Recovery]
[Refresh Status]         [Reset / Logout]
```

- **Status Indicators**: `🟢` denotes an active/reachable service, `🔴` denotes offline/unreachable, and `🟡` denotes active probing.
- **Inline Glass Buttons**: Rendered natively using Telegram's client pill design for clean, zero-clutter navigation.

### B. 7-Step Onboarding Setup Assistant

Accessible via `/onboard` or the **[Setup Assistant]** button:

1. **Step 1: Provider Selection**: Choose between Freestyle.sh (32GB, Direct Egress) or Daytona Cloud (10GB, Relay required).
2. **Step 2: Connection Method**: Choose API Key automation (auto-provisions or selects existing workspace) or Direct SSH connection string. Deleted/terminating VMs are automatically filtered out.
3. **Step 3: Hardware Probe & Service Discovery**: Probes CPU, RAM, Disk, and verifies installed components. Caches discovered container state to prevent repeated SSH latency in later steps.
4. **Step 4: Bot Messaging Channels (With Auto-Detection)**:
   - If existing bot tokens are detected on the VM, offers:
     - `1. Keep Existing Channels (Skip) [Default]` — Preserves existing Telegram/Discord bot configurations.
     - `2. Configure New Bot Token` — Prompts for new token inputs.
     - `3. Skip Bot Setup` — Continues without bot token configuration.
5. **Step 5: Local LLM Topology & Existing Setup Detection**:
   - **Auto-Detection**: Probes for existing Llama installations (co-located or remote endpoint). If found, displays summary and asks: `Keep existing LLM setup (skip deployment)? (Default: Yes)`.
   - **Stored Secondary VM Auto-Reconnect**: If Llama is running on a dedicated separate VM and a secondary API key was previously saved, the bot automatically re-mints the SSH token via `VmSshAutoRenewer.refreshSecondaryVmSsh()` and reconnects without prompting.
   - **Secondary VM Connection (Cross-Account Ready)**:
     - If connecting via Cloud API, prompts:
       - `1. Use Existing API Key (Default)` — Reuses the primary VM API key.
       - `2. Enter Different API Key` — Prompts for an API key on another account/organization.
     - Secondary workspace lists are role-scoped (`onboarding:workspaces:secondary`), ensuring separate account workspaces are queried without cache cross-pollution.
     - Once entered, the key is persisted (`secondaryFreestyleApiKey` or `secondaryDaytonaApiKey`) and automatically re-used on future runs.
   - **Topology Options** (if reconfiguring): Dedicated Second VM, Same VM (co-located), or Cloud APIs Only.
6. **Step 6: Model Selection & Quant**: Choose Qwen 2.5 7B MTP, Qwen 2.5 14B Q4_0, or Custom Hugging Face GGUF repository.
7. **Step 7: Upstream Validation & Bootstrap**: Verifies API keys live, syncs OmniRoute SQLite database, provisions supervisor configs, persists `activeEndpointUrl` and `modelName`, and completes setup.

### C. Virtual Machine Recovery & Repair

Accessible via `/recovery` or the **[VM Recovery]** button:

- Automatically detects whether the Primary VM, Secondary VM, or both are unreachable.
- Options:
  - **Setup Both New VMs**: Fresh multi-cloud provisioning.
  - **Setup Primary VM Only**: Replaces Primary VM while keeping Secondary intact.
  - **Setup Secondary VM Only**: Replaces Secondary dedicated Llama instance.
  - **Disable Secondary VM**: Switches Llama inference to run co-located or via cloud APIs.
  - **Retry Connection**: Non-destructive re-probe after container restart.

### D. Remote Service Manager

Accessible via `/services`:

- Inspects remote supervisord process statuses (`openclaw`, `omniroute`, `llama`, `xray`).
- Buttons to Start, Stop, or Restart individual daemons with single-tap feedback.
- **[Restart All Services]** and **[Update Services]** buttons for one-touch maintenance.

### E. Diagnostics & Hardware Telemetry

Accessible via `/diagnostics`:

- Live metrics: CPU load percentage, RAM usage (GB used / total), Disk usage, load average.
- Secondary Llama hardware metrics (when dedicated secondary VM is active).
- Table of active processes and their uptimes.

### F. Live Service Logs

Accessible via `/logs`:

- Tabs for OpenClaw, OmniRoute, Llama, and Xray.
- Formatted markdown code blocks displaying the latest log tail with **[Refresh Log]** button.

## 5. Self-Healing Multi-Cloud SSH Tokens (Daytona & Freestyle)

Both Daytona Cloud and Freestyle.sh use scoped/ephemeral SSH identity tokens that expire periodically. The Telegram Bot and Control Panel implement automatic self-healing token refresh:

1. Whenever an SSH reachability check or telemetry probe fails on a target:
   - For **Daytona Cloud**: Checks `daytonaApiKey` or `secondaryDaytonaApiKey`. Searches workspaces by ID/slug/role pattern, contacts `POST /api/sandbox/<id>/ssh-access` for a **30-day token** (`expiresInMinutes: 43200`), updates the target, and re-probes.
   - For **Freestyle.sh**: Checks `freestyleApiKey` or `secondaryFreestyleApiKey`. Parses VM slug from the target or stored ID, calls `FreestyleApi.createIdentityToken`, constructs `<slug>:<token>@beta-ssh.freestyle.sh`, updates the target, and re-probes.
2. **Zero False Recovery Prompts**: The recovery menu is *never* displayed for expired SSH tokens as long as the VM exists in the cloud account. Only if the VM cannot be found in the cloud provider account (e.g. deleted or account mismatch) will the recovery menu be triggered.
3. The renewed SSH target is saved to the active user's configuration and the connection probe is transparently re-tested without manual intervention.

## 6. Security, Public Bot Mode & Per-User Isolation

- **Public Bot Mode (Default)**: Each Telegram user receives an isolated conversational session, memory space (`~/.openclaw/sessions/<userId>.json`), and independent configuration (`~/.openclaw/users/<userId>.json`). Multiple users can concurrently manage separate VPS instances without cross-talk or configuration collisions.
- **Restricted / Owner Mode**: If `TELEGRAM_OWNER_ID` or `--owner` is explicitly specified without `--public`, all non-owner requests are rejected immediately with an access-denied alert displaying the requester's ID.
- **Credential Masking**: All API keys (`sk-***`), bot tokens (`***BOT_TOKEN***`), and authentication tokens are masked in error outputs and logs.
- **Non-Destructive Resets**: `/cancel` safely aborts any active onboarding draft without corrupting existing configuration files.

## 7. Daemonization (PM2 & Systemd)

### Running with PM2 (Recommended for 24/7 Uptime)

```bash
# Install PM2
npm install -g pm2

# Start bot under PM2 supervision
pm2 start "npm run start:bot" --name "openclaw-telegram-bot"

# Save PM2 state for auto-reboot
pm2 save
pm2 startup
```

### Running with Systemd (Linux / VPS)

Create `/etc/systemd/system/openclaw-bot.service`:

```ini
[Unit]
Description=OpenClaw Daytona Telegram Bot Assistant
After=network.target

[Service]
Type=simple
User=daytona
WorkingDirectory=/home/daytona/OpenClawDaytonaAssistant
Environment=NODE_ENV=production
Environment=TELEGRAM_BOT_TOKEN=123456789:AAEkd9342klsfj238947230492834
Environment=TELEGRAM_OWNER_ID=123456789
ExecStart=/usr/bin/npm run start:bot
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-bot
```

## 8. Button Styling & Telegram Platform Constraints

Telegram inline keyboard buttons (`InlineKeyboardButton`) are rendered natively by Telegram client applications (iOS, Android, Desktop, Web) according to the user's active theme:

- **No Custom Button Colors**: The Telegram Bot API does not support setting background colors, gradients, or glass colors on native inline buttons (this applies equally to standard and Telegram Premium accounts).
- **Status Indicators**: Service health indicators use high-visibility status emojis (`🟢` ONLINE / REACHABLE, `🔴` OFFLINE / UNREACHABLE) within formatted message text bodies.
- **Custom UI / Mini Apps**: If fully customized CSS glassmorphic buttons or visual dashboards are desired, Telegram Bot Mini Apps (`web_app` buttons) can be embedded to deliver rich HTML5/React interfaces.

## 9. Automated Testing

The Telegram Bot suite is comprehensively tested with dedicated unit and integration suites:

1. `tests/test_telegram_bot_menu.ts` (Menu rendering, green/red status bullets, button callbacks)
2. `tests/test_telegram_bot_onboarding.ts` (7-step session transitions & input handling)
3. `tests/test_telegram_bot_recovery.ts` (VM detection scenarios & recovery actions)
4. `tests/test_telegram_bot_auth.ts` (Owner verification, first-user binding & credential sanitization)
5. `tests/test_telegram_bot_multi_user.ts` (Isolated multi-user configurations & session persistence)
6. `tests/test_telegram_bot_vm_selection.ts` (Provider selection in onboarding: Daytona vs Freestyle)
7. `tests/test_telegram_bot_domained_onboarding.ts` (Single-domain URL onboarding and public ingress)
8. `tests/test_user_sqlite_encrypted_db.ts` (AES-256 encrypted SQLite user database & credentials storage)
9. `tests/test_vm_ssh_auto_renewer.ts` (Daytona REST API 30-day token auto-renewal & self-healing)

Run the full automated test suite (all 45 test modules):

```bash
npm test
```
