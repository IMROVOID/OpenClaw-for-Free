# OpenClaw Unified Web Relay

A high-performance Node.js 22 LTS streaming reverse proxy designed to expose **OpenClaw Gateway** (`:18789`), **OmniRoute Gateway** (`:20128`), and **llama.cpp Inference Server** (`:8080`) under a single permanent Railway domain (`*.up.railway.app`) or custom domain with automatic HTTPS.

## Environment Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `OPENCLAW_UPSTREAM` | OpenClaw upstream endpoint or Daytona preview URL | `https://18789-<sandbox>.proxy.daytona.work` |
| `OMNIROUTE_UPSTREAM` | OmniRoute upstream endpoint or Daytona preview URL | `https://20128-<sandbox>.proxy.daytona.work` |
| `LLAMA_UPSTREAM` | Llama upstream endpoint or Daytona preview URL | `https://8080-<sandbox>.proxy.daytona.work` |
| `PORT` | HTTP listening port assigned by Railway | `8080` |

## Route Mapping

- `/openclaw/*` (or `/`) -> Forwarded to `OPENCLAW_UPSTREAM`
- `/omniroute/*` -> Forwarded to `OMNIROUTE_UPSTREAM`
- `/llama/*` -> Forwarded to `LLAMA_UPSTREAM`
- `/health` -> Combined multi-upstream health probe

## Deployment

```bash
railway init --name openclaw-web-relay
railway variables --set OPENCLAW_UPSTREAM="https://18789-<id>.proxy.daytona.work"
railway variables --set OMNIROUTE_UPSTREAM="https://20128-<id>.proxy.daytona.work"
railway variables --set LLAMA_UPSTREAM="https://8080-<id>.proxy.daytona.work"
railway up --detach
```
