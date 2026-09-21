# Daytona Cloud Network Egress & Ingress Guide

> **Audience**: Operators, DevOps, and Autonomous AI Agents  
> **Environment**: Daytona Cloud Linux Containers (`Ubuntu 22.04 LTS`)  
> **Topic**: Egress Firewall Restrictions, Outbound Domain Whitelisting, Inbound Port Previewing, and Dual Relay Architecture  

## Table of Contents

1. [Daytona Network Architecture & Security Policy](#1-daytona-network-architecture--security-policy)
2. [Empirical Outbound Domain Reachability Matrix](#2-empirical-outbound-domain-reachability-matrix)
3. [Dual-Relay Solution Pattern](#3-dual-relay-solution-pattern)
4. [Verification & Diagnostics](#4-verification--diagnostics)

## 1. Daytona Network Architecture & Security Policy

Daytona Cloud containers operate within an isolated software-defined network with strict boundary controls for both outbound (egress) and inbound (ingress) traffic:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        DAYTONA CONTAINER NETWORK TOPOLOGY                              │
│                                                                                        │
│   === OUTBOUND EGRESS ===                                                              │
│   [Your Application / OpenClaw / curl / Python]                                        │
│   ├── All Ports Except 80 & 443 (e.g. 8080, 3128, 1080, 22)                           │
│   │     └──> Hypervisor Firewall: DROP (Immediate Connection Timeout)                  │
│   └── Ports 80 & 443 (HTTP / HTTPS)                                                    │
│         └──> Envoy Transparent Proxy (SNI & Host Inspection)                           │
│                ├── Whitelisted Domain (e.g. *.railway.app, github.com)                 │
│                │     └──> ALLOWED (TCP Handshake Passes)                               │
│                └── Non-Whitelisted Domain (e.g. discord.com, workers)                  │
│                      └──> BLOCKED (Envoy sends TCP RST / ECONNRESET)                   │
│                                                                                        │
│   === INBOUND INGRESS ===                                                              │
│   [External Internet / API Clients / Web Browsers]                                     │
│   ├── Direct IP Access (e.g. Port 8080 directly)                                       │
│   │     └──> BLOCKED (No public IPv4 assigned directly to containers)                  │
│   └── Daytona Port Preview Ingress (*.proxy.daytona.work)                               │
│         └──> Daytona Edge Router (SNI routing, cookie injection, potential SSE drops)  │
│                └──> Forwarded to container loopback (e.g. llama-server :8080)          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

> [!NOTE]
> When using **Freestyle.sh** as your cloud provider, containers have unrestricted outbound internet access and larger 32GB disk storage. See [ControlPanelTui.md](ControlPanelTui.md) for details on provider selection.

## 2. Empirical Outbound Domain Reachability Matrix

| Destination / Platform | Port 443 Status | Category / Notes |
| :--- | :---: | :--- |
| **`*.railway.app`** (`*.up.railway.app`) | **ALLOWED (HTTP 200/404)** | **Serverless / PaaS. Hosts both Egress & Llama relays.** |
| **`supabase.com`** / **`supabase.co`** | **ALLOWED (HTTP 200)** | Database & Edge Functions |
| **`huggingface.co`** | **ALLOWED (HTTP 200)** | AI Models & GGUF downloads |
| **`github.com`** / **`api.github.com`** | **ALLOWED (HTTP 200)** | Source Control |
| **`registry.npmjs.org`** | **ALLOWED (HTTP 200)** | Node Package Registry |
| **`pypi.org`** | **ALLOWED (HTTP 200)** | Python Package Index |
| **`docker.io`** | **ALLOWED (HTTP 200)** | Container Images |
| **`api.telegram.org`** | **ALLOWED (HTTP 302)** | Telegram Bot API (Direct native polling works!) |
| **`api.openai.com`** | **ALLOWED (HTTP 421)** | OpenAI API |
| **`api.anthropic.com`** | **ALLOWED (HTTP 404)** | Anthropic API |
| **`generativelanguage.googleapis.com`** | **ALLOWED (HTTP 404)** | Google Gemini API |
| **`openrouter.ai`** | **ALLOWED (HTTP 200)** | LLM Gateway |
| **`discord.com`** / **`gateway.discord.gg`** | **BLOCKED (Envoy RST)** | Discord Bot REST & WebSocket Gateway |
| **`api.inceptionlabs.ai`** | **BLOCKED (Envoy RST)** | Direct Inception Labs API (Routed via OmniRoute) |
| **`*.workers.dev`** / **`*.pages.dev`** | **BLOCKED (Envoy RST)** | Cloudflare Default Domains |
| **`api.cloudflare.com`** / **`trycloudflare.com`** | **BLOCKED (Envoy RST)** | **Cloudflare APIs & Tunnels: TCP RST during TLS Client Hello (`curl 35: Recv failure: Connection reset by peer`)** |
| **`104.16.0.0/12`** (Cloudflare Edge IPs) | **BLOCKED (Envoy RST)** | **Direct IP/SNI inspection resets connection immediately** |
| **`vercel.app`** / **`netlify.app`** | **BLOCKED (Envoy RST)** | Frontend Hosting |

## 3. Dual-Relay Solution Pattern

To ensure 100% stable communication both out of and into Daytona containers, two dedicated relays are deployed on Railway (`*.up.railway.app`):

### 1. Outbound Egress: `railway-gateway-relay`

- **Location**: `<your-egress-relay>.up.railway.app`
- **Protocol**: Xray VLESS over WebSocket with TLS (Port 443).
- **Function**: Bypasses Envoy's Layer-7 SNI block by encapsulating outbound traffic destined for `gateway.discord.gg` inside an authorized HTTPS connection to Railway.
- **Local Client**: Runs on OpenClaw VPS as `127.0.0.1:10808` managed by Supervisor (see [scripts/setup_daytona_relay.sh](../scripts/setup_daytona_relay.sh)).

### 2. Inbound Streaming: `railway-llama-relay`

- **Location**: `<your-llama-relay>.up.railway.app`
- **Protocol**: Node.js SSE Reverse Proxy.
- **Function**: Bridges Daytona's port preview URL (`https://8080-<sandbox-id>.proxy.daytona.work`) into a standard public OpenAI-compatible `/v1/chat/completions` endpoint with:
  - Universal CORS (`Access-Control-Allow-Origin: *`).
  - No client authentication required for public endpoints.
  - Infinite SSE streaming timeout (`server.setTimeout(0)`), preventing 4-vCPU CPU prefill stalls from disconnecting clients.

## 4. Verification & Diagnostics

```bash
# 1. Verify outbound egress through local relay (Discord Gateway)
curl -s -x http://127.0.0.1:10808 https://gateway.discord.gg

# 2. Verify inbound llama preview through Railway relay
curl -s https://<your-llama-relay>.up.railway.app/health

# 3. Direct health check of Daytona Llama port preview
curl -s -I https://8080-<sandbox-id>.proxy.daytona.work
```

For complete deployment and operational instructions, see [RailwayRelayManual.md](RailwayRelayManual.md).
