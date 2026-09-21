# Railway Relays Manual: Egress Gateway & Llama SSE Proxy

> **Scope**: Dual Railway Cloud Micro-Services (`Alpine Linux 3.24 / Xray-core v26.3.27` & `Node.js 22 LTS Alpine`)  
> **Target Audience**: DevOps Engineers, Operators, and Autonomous AI Agents  
> **Live Relays**:
>
> - **Egress Gateway Relay**: `https://<your-egress-relay>.up.railway.app` (Xray VLESS over WSS:443)
> - **Llama SSE Proxy Relay**: `https://<your-llama-relay>.up.railway.app` (Node.js Streaming Reverse Proxy)

## Table of Contents

1. [Executive Summary & Objective](#1-executive-summary--objective)
2. [Relay 1: Egress Gateway Relay (`railway-gateway-relay`)](#2-relay-1-egress-gateway-relay-railway-gateway-relay)
3. [Relay 2: Llama SSE Streaming Proxy (`railway-llama-relay`)](#3-relay-2-llama-sse-streaming-proxy-railway-llama-relay)
4. [Deployment to Railway](#4-deployment-to-railway)
5. [Verification & Health Checks](#5-verification--health-checks)
6. [Resource Consumption & Cost Optimization](#6-resource-consumption--cost-optimization)

## 1. Executive Summary & Objective

Daytona Cloud VPS Free and Tier 1/2 containers enforce an aggressive outbound egress policy:

1. **Outbound Port Filtering**: All destination ports except **80** and **443** are blocked at the hypervisor level.
2. **Layer-7 Envoy Filtering**: On port 443, non-whitelisted destinations (including Discord Gateway and external APIs) are terminated with `ECONNRESET`.
3. **PaaS Whitelisting**: Daytona explicitly allowlists **`*.railway.app`** (`*.up.railway.app`) on port 443.
4. **Inbound Daytona Port Preview Authentication**: While Daytona preview URLs allow inbound access to ports like 8080, public OpenAI clients struggle with Daytona preview cookie headers, auth barriers, and SSE stream drops.

To solve both outbound and inbound challenges, we operate **two dedicated micro-relays on Railway**:

1. **`railway-gateway-relay` (Outbound Egress Tunnel)**: Proxies outbound traffic from OpenClaw to the Discord Gateway and restricted APIs through an encrypted VLESS tunnel.
2. **`railway-llama-relay` (Inbound SSE Reverse Proxy)**: Publicly exposes the Daytona `llama-server` preview port with CORS enabled, infinite SSE stream timeouts (`setTimeout(0)`), and clean OpenAI `/v1` endpoint routing.

For complete network firewall analysis, see [DaytonaNetworkEgress.md](DaytonaNetworkEgress.md).

## 2. Relay 1: Egress Gateway Relay (`railway-gateway-relay`)

### 2.1 Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        EGRESS GATEWAY RELAY ARCHITECTURE                               │
│                                                                                        │
│   [Daytona OpenClaw VPS (Ubuntu 22.04)]                                                │
│      ├── OpenClaw Discord Channel (proxy: http://127.0.0.1:10808)                      │
│      └── Xray Client Daemon (Port 10808 HTTP / 10809 SOCKS5)                           │
│                     │                                                                  │
│                     │ Encrypted WSS over Port 443 (SNI: <your-relay>.up.railway.app)   │
│                     ▼                                                                  │
│   [Daytona Envoy Layer-7 Proxy] ──(Whitelisted Port 443 Pass)──> [Railway Platform]    │
│                                                                        │               │
│                                                                        │ Direct Egress │
│                                                                        ▼               │
│                                                            [Discord Gateway / Internet]│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Server Specifications (`relay/railway-gateway-relay/`)

- **Protocol**: `vless`
- **Transport**: WebSocket (`ws`)
- **Path**: `/api/v1/relay-stream`
- **Port**: Dynamic `$PORT` (assigned by Railway)
- **Auth**: Pre-shared secret UUID
- **HTTP Fallback**: Root `/` returns JSON healthcheck status.

### 2.3 Client Configuration (`/home/daytona/.xray/config.json`)

The Daytona client forwards all local requests from `127.0.0.1:10808` over TLS WebSocket to Railway. Configured automatically by [scripts/setup_daytona_relay.sh](../scripts/setup_daytona_relay.sh).

## 3. Relay 2: Llama SSE Streaming Proxy (`railway-llama-relay`)

### 3.1 Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         LLAMA SSE STREAMING PROXY RELAY                                │
│                                                                                        │
│   [Clients / OpenClaw / OmniRoute]                                                     │
│      └── Requests: POST /v1/chat/completions                                           │
│                     │                                                                  │
│                     ▼                                                                  │
│   [Railway Edge: railway-llama-relay]                                                  │
│      ├── Node.js Reverse Proxy (server.setTimeout(0))                                  │
│      ├── Sets Host: 8080-<sandbox-id>.proxy.daytona.work                               │
│      └── Pipes SSE response stream directly (no buffering)                             │
│                     │                                                                  │
│                     ▼                                                                  │
│   [Daytona Llama VPS: 8080-<sandbox-id>.proxy.daytona.work]                            │
│      └── llama-server :8080 (Local GGUF LLM)                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Implementation Highlights (`relay/railway-llama-relay/server.ts`)

- **Node.js 22 LTS Target**: Compiled via `esbuild` for Node.js 22 LTS runtime performance and native fetch/stream optimizations.
- **Zero Timeout (`server.setTimeout(0)`)**: Prevents Node.js default 120s socket timeout from cutting off long token generation streams on 4-vCPU hardware.
- **Header Sanitization**: Overwrites the incoming `Host` header with the Daytona preview hostname to satisfy virtual routing.
- **CORS Handling**: Injects open CORS headers (`Access-Control-Allow-Origin: *`).
- **SSE Pipe Streaming**: Directly pipes `proxyRes.pipe(res)` so Server-Sent Events flow chunk-by-chunk without buffering.

## 4. Relay 3: Unified Web Ingress Proxy (`railway-web-relay`)

### 4.1 Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED WEB INGRESS PROXY ARCHITECTURE                          │
│                                                                                        │
│   [Public Internet / Browser / Telegram Bot WebApps]                                   │
│      ├── https://<your-web-relay>.up.railway.app/openclaw  ──> OpenClaw WebUI (:18789) │
│      ├── https://<your-web-relay>.up.railway.app/omniroute  ──> OmniRoute Dashboard    │
│      ├── https://<your-web-relay>.up.railway.app/llama      ──> LLaMA WebUI & /v1/     │
│      └── https://<your-web-relay>.up.railway.app/health     ──> Health Status JSON     │
│                     │                                                                  │
│                     ▼                                                                  │
│   [Railway Edge: railway-web-relay (Node.js 22 LTS)]                                   │
│      ├── Strips path prefixes (/openclaw, /omniroute, /llama)                          │
│      ├── Forwards to respective target upstreams (Daytona preview / FreeStyle URLs)     │
│      ├── Disables proxy response buffering for streaming SSE (`setTimeout(0)`)         │
│      └── Injects permissive CORS for web clients & Telegram WebApps                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Implementation Highlights (`relay/railway-web-relay/server.ts`)

- **Single Public URL**: Serves all three core ecosystem WebUIs behind a single permanent Railway URL, eliminating local SSH port forwarding.
- **Environment Upstreams**:
  - `OPENCLAW_UPSTREAM`: e.g. `https://18789-<sandbox-id>.proxy.daytona.work` (Default: `http://localhost:18789`)
  - `OMNIROUTE_UPSTREAM`: e.g. `https://20128-<sandbox-id>.proxy.daytona.work` (Default: `http://localhost:20128`)
  - `LLAMA_UPSTREAM`: e.g. `https://8080-<sandbox-id>.proxy.daytona.work` (Default: `http://localhost:8080`)
  - `PORT`: Dynamic port assigned by Railway (Default: `3000`)
- **Healthcheck**: GET `/health` probes all configured upstreams and returns JSON `200 OK`.

## 5. Deployment to Railway

```bash
# 1. Login to Railway
railway login

# 2. Deploy Egress Relay (Required for Daytona outbound egress & OmniRoute routing)
cd relay/railway-gateway-relay
railway init --name egress-relay
railway up --detach

# 3. Deploy Llama SSE Relay (For Daytona Dedicated Secondary VM)
cd ../railway-llama-relay
railway init --name llama-relay
railway variables --set TARGET_URL="https://8080-<sandbox-id>.proxy.daytona.work"
railway up --detach

# 4. Deploy Unified Web Relay (For Daytona Permanent Domained URLs)
cd ../railway-web-relay
railway init --name web-relay
railway variables --set OPENCLAW_UPSTREAM="https://18789-<sandbox-id>.proxy.daytona.work"
railway variables --set OMNIROUTE_UPSTREAM="https://20128-<sandbox-id>.proxy.daytona.work"
railway variables --set LLAMA_UPSTREAM="https://8080-<sandbox-id>.proxy.daytona.work"
railway up --detach
```

## 6. Verification & Health Checks

```bash
# 1. Test Egress Relay Reachability
curl -I https://<your-egress-relay>.up.railway.app

# 2. Test Discord Gateway Tunneling from Daytona OpenClaw VPS
curl -s -x http://127.0.0.1:10808 https://gateway.discord.gg

# 3. Test Llama Relay Health
curl -s https://<your-llama-relay>.up.railway.app/health

# 4. Test Unified Web Ingress Relay Health
curl -s https://<your-web-relay>.up.railway.app/health

# 5. Access Web Interfaces in Browser (No Port Forwarding Required)
# OpenClaw  : https://<your-web-relay>.up.railway.app/openclaw
# OmniRoute : https://<your-web-relay>.up.railway.app/omniroute
# LLaMA     : https://<your-web-relay>.up.railway.app/llama
```

## 7. Resource Consumption & Cost Optimization

All three containers are configured for minimal resource footprints:

- **Egress Relay (`xray-core` on Alpine 3.24)**: ~15 MB RAM, ~0.005 vCPU (~$0.40/month on Railway).
- **Llama SSE Relay (`node:22-alpine` LTS)**: ~30 MB RAM, ~0.01 vCPU (~$0.60/month on Railway).
- **Web Ingress Relay (`node:22-alpine` LTS)**: ~25 MB RAM, ~0.01 vCPU (~$0.50/month on Railway).
- **Total Combined Monthly Cost**: ~**$1.50**, comfortably within Railway's $5.00 monthly developer allowance.
