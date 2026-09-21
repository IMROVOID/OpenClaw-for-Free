# OpenClaw-for-free — Documentation Index

This directory contains the complete architectural blueprints, configuration manuals, network egress guides, and troubleshooting runbooks for the entire OpenClaw-for-free ecosystem.

## Document Catalog

| Document | Purpose / Highlights | Key Components Covered |
| :--- | :--- | :--- |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Developer environment setup, available scripts reference, coding standards, and PR submission checklist. | Node >=22 LTS, TypeScript 7.0.2, AAA test patterns, modularity (<200-300 lines limit), strict typing (zero `any`), and conventional commits. |
| **[RUNBOOK.md](RUNBOOK.md)** | Production operations, deployment procedures, health monitoring, common failure modes, and disaster recovery. | Step-by-step VPS & relay deployment, health endpoints, stale port resolution, Daytona firewall bypass, cgroup memory limits, and auto-recovery. |
| **[ControlPanelTui.md](ControlPanelTui.md)** | Complete manual for the Unified Control Panel (`OpenClaw-Control-Panel.exe`) with interactive modern TUI. | TUI controls, SGR mouse, 2-column aligned table, detecting status lifecycle, auto-login, service manager, logs tail, remote terminal, Daytona & Freestyle.sh API provisioning, hardware bounds capping (max 4vCPU/8GB/10GB), HF inspector, and SEA build workflow. |
| **[TelegramBotAssistant.md](TelegramBotAssistant.md)** | Interactive Telegram bot replicating the setup, onboarding, recovery, and service management workflows. | GrammY framework, 7-step onboarding wizard, VM recovery flows, interactive inline button menus, owner security gate, live hardware telemetry, tail logs, daemon supervision. |
| **[AiAgentContext.md](AiAgentContext.md)** | Machine-readable context file for autonomous coding agents (Copilot, Cursor, OpenCode, Claude Code, Antigravity). | Service topology, endpoints, authentication tokens, strict rules of engagement, and Python/Node integration snippets. |
| **[DaytonaLlamaSetup.md](DaytonaLlamaSetup.md)** | Full deployment guide and operational runbook for `llama.cpp` running on Daytona VPS. | Resource budget (8GB cgroup), MTP speculative decoding, Flash Attention, 32k context KV compression, question mark bug root cause, public Railway SSE streaming relay, OmniRoute integration, timeout & tool optimizations. |
| **[OpenclawManual.md](OpenclawManual.md)** | Complete operational manual for the OpenClaw agent runtime on Cloud VPS. | Supervisor management, `openclaw.json` breakdown, Telegram and Discord channels, maximum context lengths, proactive compaction safeguards, and bot slash commands. |
| **[OmnirouteVpsManual.md](OmnirouteVpsManual.md)** | Complete technical manual for the OmniRoute multi-provider AI gateway. | SQLite database schema, model routing algorithms, custom models, rate limit bottleneck removal (`RATE_LIMIT_MAX_WAIT_MS=3600000`), and Daytona Llama provider setup. |
| **[DaytonaNetworkEgress.md](DaytonaNetworkEgress.md)** | Comprehensive network and firewall analysis for Daytona Cloud VPS containers. | Hypervisor port drops, Envoy Layer-7 SNI inspection, live domain reachability matrix, and how Railway WSS tunnels bypass egress blocks. |
| **[InstallationGuide.md](InstallationGuide.md)** | GitHub installation and distribution guide covering PowerShell/Bash one-liners and NPX zero-install methods. | Automated 1-line installer (PowerShell for Windows, Bash for macOS/Linux), Desktop shortcut, User PATH setup, and zero-install `npx openclaw-for-free`. |
| **[RailwayRelayManual.md](RailwayRelayManual.md)** | Architecture and operations guide for the dual Railway relay infrastructure. | 1) Gateway V2Ray/Xray Egress Relay for outbound Telegram/Discord traffic, 2) High-performance zero-timeout SSE streaming reverse proxy for llama.cpp, and 3) Unified Web Ingress relay. |
| **[PublicWebIngressAndDomains.md](PublicWebIngressAndDomains.md)** | Architectural blueprints for single-domain routing of OpenClaw, OmniRoute, and Llama without Railway. | Caddy & Nginx reverse proxy recipes, path vs subdomain routing, Freestyle.sh native ingress, Daytona Cloudflare blocking root-cause, and Telegram WebApp integration. |

## System Architecture Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHYSICAL INFRASTRUCTURE                         │
│                                                                        │
│   [Local PC / Workstation]                                             │
│      • OpenClaw-Control-Panel.exe (Flagship Unified TUI Control Panel) │
│                                                                        │
│   [Primary Cloud VPS: OpenClaw + OmniRoute Primary Agent Server]       │
│      • OpenClaw Gateway (Port 18789)                                   │
│      • OmniRoute Multiplexer (Port 20128)                              │
│      • Xray Forward Proxy (Port 10808, for Daytona)                    │
│                                                                        │
│   [Dedicated Secondary LLM VM: Dedicated llama.cpp Inference Server]   │
│      • Model: Local GGUF Model with MTP (e.g. Qwen 3.5 9B)             │
│      • llama-server (Port 8080, 32k context, Flash Attention)          │
│                                                                        │
│   [Railway Platform: Edge Relays]                                      │
│      • Gateway Egress Relay: <your-egress-relay>.up.railway.app        │
│      • Llama OpenAI Streaming Relay: <your-llama-relay>...app          │
│      • Unified Web Ingress Relay: <your-web-relay>...app               │
└────────────────────────────────────────────────────────────────────────┘
```

## Active LTS Tech Stack Reference

| Component | Standard LTS / Production Version |
| :--- | :--- |
| **Node.js Runtime** | Node.js 22 LTS (`v22.x` Active LTS) |
| **TypeScript** | TypeScript 7.0.2 (`NodeNext` / `ES2022`) |
| **Bundler & Tooling** | `esbuild` v0.28.2 & `tsx` v4.23.13 |
| **Container Base** | Alpine Linux 3.24 (`alpine:3.24`) |
| **Egress Relay Core** | Xray-core v26.3.27 |
| **Agent Platform** | OpenClaw 2026.9.4 |
| **Model Gateway** | OmniRoute 3.8.50 |
| **Local LLM Engine** | `llama.cpp` b10941+ (AVX-512 / Flash Attention) |
| **Test Verification** | 45 passing automated test modules (`npm test`) |
