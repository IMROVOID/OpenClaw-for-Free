# Single-Domain Public Web Ingress & Unified Routing Guide

This guide details how to expose and route all OpenClaw ecosystem services—**OpenClaw Gateway** (`:18789`), **OmniRoute Gateway** (`:20128`), and **llama.cpp Inference WebUI & API** (`:8080`)—behind a **single permanent domain** with automatic HTTPS, eliminating the need for local port forwarding and enabling out-of-the-box access for Telegram Bot WebApps, mobile browsers, and external APIs.

## 1. Architecture Overview

### The Port Fragmentation Problem

By default, the OpenClaw ecosystem binds three separate services on different local ports:

- **OpenClaw Gateway**: `http://127.0.0.1:18789` (REST API & WebSocket `/ws`, `/chat`)
- **OmniRoute Multiplexer**: `http://127.0.0.1:20128` (Admin WebUI, SSE streaming `/v1/chat/completions`)
- **llama.cpp Server**: `http://127.0.0.1:8080` (llama WebUI, OpenAI-compatible SSE endpoints)

Accessing these across local machines typically requires three concurrent SSH port forwarding tunnels (`-L 18789:... -L 20128:... -L 8080:...`). In mobile environments or Telegram bots, opening `localhost` links fails completely.

### Unified Edge Solution

A lightweight reverse proxy (such as **Caddy** or **Nginx**) deployed on the host binds standard web ports (`:80` and `:443`) and routes incoming traffic based on **URL paths** or **subdomains** to the respective backend services, while handling SSL/TLS termination automatically.

```
                                  [ Public Internet / Web Browsers / Telegram Bot ]
                                                          │
                                                          ▼
                                            https://ai.yourdomain.com
                                                          │
                                     ┌────────────────────┴────────────────────┐
                                     │     Caddy Edge Reverse Proxy (:443)    │
                                     │       (Auto Let's Encrypt TLS)         │
                                     └────────────────────┬────────────────────┘
                                                          │
                      ┌───────────────────────────────────┼───────────────────────────────────┐
                      ▼                                   ▼                                   ▼
         Path: / or /openclaw/*                  Path: /omniroute/*                    Path: /llama/*
        [ OpenClaw Gateway ]                   [ OmniRoute Multiplexer ]             [ llama-server ]
         Port 18789 (HTTP/WS)                    Port 20128 (HTTP/SSE)                Port 8080 (HTTP/SSE)
         (Agent Runtime)                         (Model Gateway)                      (Local Inference)
```

## 2. Cloud Provider Ingress Comparison: Freestyle.sh vs Daytona

Before configuring ingress, understand the structural network constraints of your hosting provider:

| Feature / Capability | Freestyle.sh | Daytona Cloud |
| :--- | :--- | :--- |
| **Public IPv4 Ingress** | **Supported** (Direct public ingress available) | **Blocked** (Container isolated; no public IP) |
| **Permanent Subdomain** | **Built-in** (`<workspace-slug>.style.dev`) | **Port Preview Only** (`*.proxy.daytona.work`) |
| **Custom Domain (CNAME/A)** | **Supported** (Point domain to Freestyle host) | **Not Supported Directly** |
| **Cloudflare Tunnels (`cloudflared`)** | **Supported** | **BLOCKED by Hypervisor** (TCP RST during TLS handshake) |
| **Direct Without Railway?** | **YES — 100% Native** | **NO — Requires Railway Bridge** |
| **Storage / Cgroup Limits** | 32 GB Disk, Generous cgroups | 10 GB Disk, strict 8 GB memory cgroup |

### Critical Finding: Daytona Actively Blocks Cloudflare

Live network probing against Daytona container runtimes demonstrates that Daytona's Envoy/hypervisor firewall inspects SNI and edge destination IPs:

- Any outbound TLS connection to Cloudflare IPs (`104.16.0.0/12`) or hostnames (`api.cloudflare.com`, `trycloudflare.com`) triggers an immediate TCP Reset (`curl: (35) Connection reset by peer`).
- Consequently, **Cloudflare Tunnels (`cloudflared`) cannot establish edge connections inside Daytona**.
- For Daytona, **Railway** (`*.up.railway.app`) remains the verified high-performance bridge for inbound SSE streaming and outbound webhooks.

### The Freestyle Advantage: Permanent Single Domain Without Railway

If your primary VM is hosted on **Freestyle.sh**:

1. You can bind Caddy directly to ports `80` and `443`.
2. You can use your assigned `<slug>.style.dev` or point your own custom domain (e.g. `ai.mycompany.com`) via a standard DNS A/CNAME record.
3. No Railway subscription or secondary relay container is required.

## 3. Unified Ingress Topologies

You can organize your single domain using either **Path-Based Routing** or **Subdomain-Based Routing**:

### Option A: Path-Based Routing (Single Domain / Subdomain)

All services live under one hostname (e.g. `https://mybot.style.dev` or `https://ai.example.com`):

| Public Path | Forwarded Upstream | Protocol / Special Handling |
| :--- | :--- | :--- |
| `/` or `/openclaw/*` | `http://127.0.0.1:18789` | WebSockets (`Upgrade: websocket`) |
| `/omniroute/*` | `http://127.0.0.1:20128` | Strip `/omniroute` prefix, unbuffered SSE |
| `/llama/*` | `http://127.0.0.1:8080` | Strip `/llama` prefix, unbuffered SSE (`flush_interval -1`) |

### Option B: Subdomain Routing (Wildcard DNS)

Each service gets its own clean subdomain on your apex domain:

| Domain | Forwarded Upstream | Purpose |
| :--- | :--- | :--- |
| `claw.example.com` | `http://127.0.0.1:18789` | OpenClaw Agent Gateway & WebUI |
| `omni.example.com` | `http://127.0.0.1:20128` | OmniRoute Admin & API Gateway |
| `llama.example.com` | `http://127.0.0.1:8080` (or secondary VM) | llama.cpp Inference Server & WebUI |

## 4. Production Implementation with Caddy (Recommended)

**Caddy** is the recommended reverse proxy for Cloud VPS environments because:

- Statically compiled single Go binary with zero dependencies.
- Automatic HTTPS with Let's Encrypt / ZeroSSL (zero manual certbot renewal cron jobs).
- Native support for WebSocket connection upgrading out of the box.
- Built-in unbuffered HTTP streaming via `flush_interval -1`, critical for real-time LLM token streaming.

### Step 1: Install Caddy on VPS

On Debian / Ubuntu:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

On Alpine Linux:

```bash
apk add caddy
```

### Step 2: Caddyfile Configuration Recipes

#### Recipe 1: Path-Based Routing (Single Domain)

Place the following in `/etc/caddy/Caddyfile`:

```caddy
ai.yourdomain.com {
    # 1. OpenClaw Gateway (Primary route with WebSocket support)
    handle_path /openclaw/* {
        reverse_proxy 127.0.0.1:18789 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }

    # 2. OmniRoute Model Multiplexer & Admin UI
    handle_path /omniroute/* {
        reverse_proxy 127.0.0.1:20128 {
            # Disable buffering for SSE streaming tokens
            flush_interval -1
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }

    # 3. llama.cpp Server (WebUI & OpenAI API)
    handle_path /llama/* {
        reverse_proxy 127.0.0.1:8080 {
            # Essential for token-by-token streaming
            flush_interval -1
            # Avoid long generation timeouts (1 hour)
            transport http {
                response_header_timeout 3600s
                read_timeout 3600s
            }
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }

    # Default fallback: redirect / to /openclaw/ or serve OpenClaw directly
    handle {
        reverse_proxy 127.0.0.1:18789 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
    }

    # Enable gzip & zstd compression (excludes SSE automatically)
    encode zstd gzip
}
```

#### Recipe 2: Subdomain Routing

If you control DNS for `yourdomain.com` (pointed via A record or CNAME to your VPS IP):

```caddy
# OpenClaw Gateway
claw.yourdomain.com {
    reverse_proxy 127.0.0.1:18789
}

# OmniRoute Multiplexer
omni.yourdomain.com {
    reverse_proxy 127.0.0.1:20128 {
        flush_interval -1
    }
}

# llama.cpp Inference Server
llama.yourdomain.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
        transport http {
            response_header_timeout 3600s
            read_timeout 3600s
        }
    }
}
```

### Step 3: Start and Verify Caddy

```bash
# Validate Caddyfile syntax
sudo caddy validate --config /etc/caddy/Caddyfile

# Reload or restart service
sudo systemctl reload caddy || sudo systemctl restart caddy

# Check active status
sudo systemctl status caddy
```

## 5. Alternative Implementation with Nginx

If you prefer Nginx, use the following configuration in `/etc/nginx/sites-available/openclaw`:

```nginx
server {
    listen 80;
    server_name ai.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ai.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/ai.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.yourdomain.com/privkey.pem;

    # OpenClaw Gateway (Root & WebSockets)
    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # OmniRoute API & Dashboard
    location /omniroute/ {
        proxy_pass http://127.0.0.1:20128/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Disable buffering for SSE stream
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
    }

    # llama.cpp WebUI & Streaming API
    location /llama/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Zero buffering for token streaming
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        
        # 1-hour timeout for long reasoning generation
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

## 6. Multi-VM Architecture: Routing to a Dedicated Secondary Llama VM

In a high-performance multi-cloud setup, OpenClaw and OmniRoute run on a **Primary VM**, while `llama.cpp` runs on a **Dedicated Secondary VM** (e.g. to leverage distinct CPU quotas or RAM boundaries).

### Routing Across Cloud VMs

When using a dedicated Secondary VM:

```
[ Primary Cloud VM ] (ai.yourdomain.com)
  ├── Caddy (:443)
  ├── OpenClaw (:18789)
  ├── OmniRoute (:20128)
  └── Reverse Proxy Upstream for /llama/*:
        │
        ▼ (Private WireGuard, Internal VPC, or SSH Tunnel)
[ Secondary Cloud VM ]
  └── llama-server (:8080)
```

#### In the Primary VM's Caddyfile

If the secondary VM is reachable via internal IP or SSH local forward:

```caddy
handle_path /llama/* {
    # If using local SSH port forward established by Control Panel / Bot:
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }

    # OR if using direct private VPC IP of Secondary VM:
    # reverse_proxy 10.0.0.2:8080 {
    #     flush_interval -1
    # }
}
```

## 7. Telegram Bot WebUI & WebApp Integration

With a single permanent domain configured, you can expose rich interactive WebApp buttons directly inside your Telegram Bot without running port forwarding on client devices.

### Telegram Inline WebApp Buttons

GrammY inline keyboard integration:

```typescript
import { InlineKeyboard } from "grammy";

export function buildDashboardKeyboard(baseDomain: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("OpenClaw WebUI", `https://${baseDomain}/openclaw`)
    .row()
    .webApp("OmniRoute Admin", `https://${baseDomain}/omniroute`)
    .row()
    .webApp("Llama Chat UI", `https://${baseDomain}/llama`);
}
```

### Direct Webhook Support

Instead of long-polling (`getUpdates`), you can configure the Telegram Bot to receive real-time webhook updates directly:

```bash
curl -F "url=https://ai.yourdomain.com/telegram-webhook" \
     -F "secret_token=YOUR_WEBHOOK_SECRET" \
     https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
```

## 8. Security Hardening Checklist

When exposing services to the public Internet behind a single domain, implement the following guardrails:

1. **Protect Administrative Endpoints**:
   - OmniRoute and llama.cpp may allow model switching or administrative configurations.
   - Use Caddy's `basicauth` or an API key gate on sensitive paths:

     ```caddy
     handle_path /omniroute/admin/* {
         basicauth {
             admin $2a$14$...hashed_password...
         }
         reverse_proxy 127.0.0.1:20128
     }
     ```

2. **Bind Internal Services to Loopback Only**:
   - Ensure OpenClaw (`127.0.0.1:18789`), OmniRoute (`127.0.0.1:20128`), and llama.cpp (`127.0.0.1:8080`) bind strictly to `127.0.0.1` and NOT `0.0.0.0`, preventing bypass of Caddy's TLS and security rules.
3. **SSE Buffer Flushing**:
   - Always verify `flush_interval -1` (Caddy) or `proxy_buffering off` (Nginx). Failing to set this will cause streaming token responses to buffer until the entire answer completes.
4. **Timeouts**:
   - Set proxy read timeouts to at least `3600s` on `/llama/*` to prevent gateway 504 timeouts during intensive multi-token CPU generation runs.
