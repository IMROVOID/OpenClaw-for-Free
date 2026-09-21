# OpenClaw Unified Control Panel: Interactive TUI & Cloud Provisioning Manual

> **Scope**: Local Workstation / Terminal & Remote Cloud VPS instances (Daytona Cloud & Freestyle.sh)  
> **Binary**: `bin/OpenClaw-Control-Panel.exe` (and optionally `%USERPROFILE%\Desktop\OpenClaw-Control-Panel.exe` with `--desktop`)  
> **Source Directory**: `src/control-panel/`  
> **Packaging Method**: Node.js 22 LTS Single Executable Application (SEA) via `esbuild` v0.28.2 & `postject`

## Table of Contents

1. [System Architecture & Topology](#1-system-architecture--topology)
2. [Startup Autodetection & Skip-to-TUI Logic](#2-startup-autodetection--skip-to-tui-logic)
3. [Multi-Cloud VPS Provisioning (Daytona & Freestyle.sh)](#3-multi-cloud-vps-provisioning-daytona--freestylesh)
4. [Dedicated Secondary LLM VM Topology](#4-dedicated-secondary-llm-vm-topology)
5. [Hugging Face Inspector & Upstream Key Validator](#5-hugging-face-inspector--upstream-key-validator)
6. [TUI Controls, Keybindings & Mouse Support](#6-tui-controls-keybindings--mouse-support)
7. [Remote Service Manager, Live Logs & Remote Terminal](#7-remote-service-manager-live-logs--remote-terminal)
8. [Building Standalone Single Executable Applications](#8-building-standalone-single-executable-applications)

## 1. System Architecture & Topology

The **OpenClaw Unified Control Panel** unifies multi-server SSH tunneling, daemon supervision, automated provisioning, and diagnostics into a single high-performance terminal application. It supports both **Daytona Cloud** and **Freestyle.sh** as upstream VPS providers:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CONTROL PANEL TOPOLOGY                                  │
│                                                                                        │
│   [Local Terminal: OpenClaw-Control-Panel.exe]                                         │
│      ├── TUI Engine (SGR Mouse, ANSI 256-Color Boxes, Pure Node.js stdlib)             │
│      ├── Multi-Server SSH Manager (Port forwards 18789, 20128, 8080)                   │
│      ├── Installation Autodetector (Probes OpenClaw, OmniRoute, Llama)                 │
│      ├── Multi-Cloud Provisioner (Daytona API & Freestyle.sh API)                      │
│      ├── Upstream Provider Key Validator (OpenAI, Anthropic, Gemini, DeepSeek, Groq)   │
│      ├── Hugging Face Model Inspector (GGUF, MoE, MTP Heads, RAM Fit Calculations)     │
│      └── Resilient Telemetry & Stress Tester (Hardware metrics, SSE latency)           │
│                                                                                        │
│                     │ SSH Tunnels                │ SSH Tunnels                         │
│                     ▼                            ▼                                     │
│   ┌───────────────────────────────────┐        ┌───────────────────────────────────┐   │
│   │         PRIMARY CLOUD VPS         │        │        SECONDARY DEDICATED VM     │   │
│   │   (Daytona Cloud or Freestyle.sh) │        │   (Freestyle 32GB or Daytona 10GB)│   │
│   │   • OpenClaw Gateway  (:18789)    │        │   • llama-server      (:8080)     │   │
│   │   • OmniRoute Router  (:20128)    │        │   • Local GGUF Model  (Quantized) │   │
│   │   • Supervisord Daemons           │        │   • AVX-512 & Flash Attention     │   │
│   │   • Xray Relay (Daytona only)     │        │   • Optional Railway SSE Relay    │   │
│   └───────────────────────────────────┘        └───────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Startup Autodetection & Skip-to-TUI Logic

On every execution, the Control Panel executes non-blocking diagnostic probes against the saved configuration (`~/.openclaw-control-panel.json`):

1. **All Core Services Verified**:
   - Primary VPS has both OpenClaw (`~/.openclaw/openclaw.json`) and OmniRoute (`~/.omniroute`) configured and operational.
   - **Action**: Bypasses the onboarding wizard completely and boots into the Main Menu in `< 1 second`.
2. **Partial Configuration Detected**:
   - One component is present (e.g. OpenClaw CLI is installed, but OmniRoute Gateway is missing).
   - **Action**: Launches a targeted guided setup that repairs only the missing component without overwriting existing credentials.
3. **Clean Slate / First Launch**:
   - No configuration file exists.
   - **Action**: Initiates the interactive 7-step Onboarding Wizard.

## 3. Multi-Cloud VPS Provisioning (Daytona & Freestyle.sh)

The Control Panel provides native drivers for two major cloud container providers:

### A. Daytona Cloud

- **API Key Automation**: Connects to `https://app.daytona.io/settings/keys` to query account quotas and provision workspaces.
- **Strict Hardware Bounds**: Automatically enforces Daytona free-tier constraints: **max 4 vCPU, 8 GB RAM, 10 GB Storage** (minimum: 1 vCPU, 2 GB RAM, 5 GB Storage).
- **Host Node Clamping**: When running on unconstrained 48-core host nodes, detects host capacity and clamps default thread allocations to safe container limits.
- **Egress Routing**: Automatically provisions an Xray forward proxy to route around Daytona outbound hypervisor blocks.

### B. Freestyle.sh

- **Direct Egress**: Freestyle.sh containers possess unrestricted outbound internet access, eliminating the need for an egress relay.
- **Storage Advantage**: Provides up to 32 GB disk space, accommodating larger GGUF model weights (e.g., Qwen 2.5 14B Q4_0).
- **Driver Integration**: Native REST client in `src/control-panel/core/freestyleApi.ts` handles container lifecycle, SSH key injection, and resource queries.

## 4. Dedicated Secondary LLM VM Topology

To prevent local LLM inference from starving agent processes of CPU and memory:

1. **Dedicated Second VM (Recommended)**:
   - Primary VM runs OpenClaw agent and OmniRoute multiplexer.
   - Secondary VM runs `llama-server` exclusively, giving the model dedicated memory and CPU cycles.
   - **Freestyle.sh**: 32 GB disk, direct egress, supports larger models up to 14B parameters.
   - **Daytona Cloud**: 10 GB disk, requires Railway SSE streaming relay for public endpoint bridging.
   - **Auto-Detection & Stored Key Reconnection**: When onboarding discovers an existing separate VM connection on the primary instance, it checks `secondaryFreestyleApiKey` / `secondaryDaytonaApiKey` and auto-reconnects via `VmSshAutoRenewer.refreshSecondaryVmSsh(config)`. If not found, it prompts for Cloud API Key, Direct SSH, or Skip SSH.
   - **Remote Endpoint Probing & Browser Fallback**: When local port 8080 forward is down, `SshTunnelManager.checkTunnels()` automatically probes the remote `activeEndpointUrl` (e.g. `https://llama-relay-production.up.railway.app/v1`). If reachable, it marks Llama as `[ONLINE - Remote Relay]` and Option `[3]` opens the remote WebUI directly in your browser.
2. **Co-located (Single VM)**:
   - Both OpenClaw and `llama-server` share a single VM. Model sizes are limited to ~7B (IQ3_M or Q4_K_M) to fit within 8 GB RAM.
3. **Cloud APIs Only**:
   - Disables local `llama-server` entirely, relying on OmniRoute routes to Gemini, Claude, OpenAI, and DeepSeek.

### Embedded Relay Script Fallback (`relayScriptConstant.ts`)

When bundled as a Single Executable Application (SEA) or launched outside the source repository, the local `scripts/setup_daytona_relay.sh` file path may not exist on disk. The Control Panel bundles an embedded zero-dependency copy of the verified relay deployment bash script, completely eliminating `[WARN: scripts/setup_daytona_relay.sh not found]` warnings.

## 5. Hugging Face Inspector & Upstream Key Validator

### Hugging Face Model Inspector (`huggingfaceInspector.ts`)

- Queries Hugging Face API live for model repositories (e.g., `DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF`).
- **Quant Parsing**: Scans all available `.gguf` variants, sizes, and quantization formats (IQ3_M, Q4_K_M, Q5_K_M, etc.).
- **RAM Fit Estimation**: Calculates context KV cache memory + model weight footprints against the container's 8 GB cgroup budget.
- **MTP Detection**: Detects Multi-Token Prediction speculative drafting heads to enable speculative speedups.

### Upstream Provider Pre-Flight Validator (`providerValidator.ts`)

- Tests API keys live before persisting them:
  - **OpenAI / OpenRouter**: Validates via `/v1/models`
  - **Anthropic**: Validates via `x-api-key` header test
  - **Google Gemini**: Validates against Gemini REST endpoint
  - **DeepSeek / Groq**: Validates endpoints with sub-second ping
- Rejects malformed or expired keys immediately with clear error explanations.

## 6. TUI Controls, Keybindings & Mouse Support

Operates in raw terminal mode with SGR Extended Mouse protocol support:

| Input / Gesture | Target / Action | Description |
| :--- | :--- | :--- |
| `↑` / `k` / **Wheel Up** | Menu Rows | Move selection cursor up |
| `↓` / `j` / **Wheel Down** | Menu Rows | Move selection cursor down |
| `ENTER` / **Left Click** | Selected Card | Activate highlighted action |
| `1` | Open OpenClaw (Browser) | Forwards port `18789`, copies token, opens WebUI |
| `2` | Open OmniRoute (Browser) | Forwards port `20128`, copies key, opens dashboard |
| `3` | Open Llama (Browser) | Forwards port `8080`, copies URL, opens WebUI |
| `4` | Service Manager | Interactive daemon manager (`[S] Start`, `[X] Stop`, `[R] Restart`) |
| `5` | Live Telemetry & Diagnostics | Hardware telemetry, cgroup monitoring, and latency probes |
| `6` | VPS & Service Logs | Multi-tab live log tail for OpenClaw, OmniRoute, Llama, and Xray |
| `7` | Remote Terminal (SSH Shell) | Launches dedicated Windows CMD / Terminal window connected to VPS |
| `8` | Setup Assistant (Onboarding) | Re-run interactive onboarding wizard |
| `9` | Quick Model / API Ping | Tests upstream LLM response times |
| `ESC` / `b` | Sub-views | Return to Main Menu |
| `Q` / `Ctrl+C` | Global | Exit Control Panel (closes local tunnels; remote VPS keeps running) |

## 7. Remote Service Manager, Live Logs & Remote Terminal

### Service Manager (`[4]`)

- Controls remote `supervisord` daemons (`openclaw`, `omniroute`, `xray`, `llama`) via SSH without requiring root SSH logins.
- Allows starting, stopping, and restarting services individually or in sequence (`[A] Restart All`).
- Pressing `[T]` cleans up stale local port bindings and re-establishes SSH tunnels.

### Live Service Logs (`[6]`)

- Features tabbed navigation across services (`[1-4 / ← →] Switch Tab`).
- Streams stdout and stderr lines directly from remote log files.
- Automatically hides the Xray tab when connected to Freestyle.sh (as Freestyle does not require egress tunneling).

### Dedicated SSH Remote Terminal (`[7]`)

- Spawns an external Windows CMD / PowerShell window running `ssh` with public-key authentication.
- Keeps the Control Panel process unblocked and retains raw terminal mouse handling.

## 8. Building Standalone Single Executable Applications

To build standalone `.exe` binaries locally or in CI:

```powershell
# 1. Build using npm scripts (deploys to bin/ by default)
npm run build:panel   # Build Unified Control Panel only
npm run build         # Build all launcher executables

# 2. Or directly via tsx
npx tsx launchers/build.ts --panel
npx tsx launchers/build.ts

# 3. Optional: Copy executable to Desktop
npx tsx launchers/build.ts --desktop
```

The build script bundles TypeScript with `esbuild` targeting Node.js 22 LTS (`--target=node22`), generates a Node Single Executable Application (SEA) blob via `node --experimental-sea-config`, copies the base `node.exe` runtime, and injects the resource blob using `postject`. The resulting executable is placed in `bin/OpenClaw-Control-Panel.exe` (and deployed to Desktop if `--desktop` or `-d` is specified).

## 9. Automated Testing & Verification

The Control Panel is verified by automated unit and integration tests covering TUI state, mouse hitboxes, SSH tunneling, provider drivers, and API bounds:

```powershell
# Run the complete test suite (45 test modules)
npm test

# Run specific Control Panel tests
npx tsx tests/test_control_panel_state.ts
npx tsx tests/test_tunnel_and_auth.ts
npx tsx tests/test_provider_drivers.ts
npx tsx tests/test_domained_url_resolver.ts
```
