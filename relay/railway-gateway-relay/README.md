# Railway Gateway Relay (Egress Proxy)

High-performance, ultra-lightweight Xray VLESS-over-WebSocket-over-TLS relay designed to run on Railway and provide egress routing for Daytona Cloud VPS containers.

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Dynamic listening port | Assigned by Railway |
| `RELAY_UUID` | Authentication UUIDv4 | Required (e.g. `uuidgen` value) |
| `RELAY_PATH` | Secret WebSocket endpoint path | `/api/v1/relay-stream` |

## Deployment via Railway CLI

```bash
cd railway-gateway-relay
railway login --browserless # or use RAILWAY_TOKEN
railway link # or railway init
railway up
```

Once deployed, generate a domain in your Railway service settings:
`Networking` -> `Public Networking` -> `Generate Domain` (e.g. `your-relay.up.railway.app`).
