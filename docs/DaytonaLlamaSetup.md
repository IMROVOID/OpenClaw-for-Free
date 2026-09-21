# Daytona VPS llama.cpp & Qwen 3.5 9B Deployment Guide

This guide details the complete setup, performance optimization, and operational runbook for running **`llama.cpp`** with **Qwen 3.5 9B (Defiant Fable Heretic NEO-MAX-MTP-IQ3_M)** on a 4-vCPU, 8GB RAM, 10GB Storage Daytona VPS, including dual-VM topology and Railway streaming proxy integration.

## Table of Contents

1. [Environment & Resource Budget](#1-environment--resource-budget)
2. [Root Cause Analysis: The "Question Mark" Output Bug](#2-root-cause-analysis-the-question-mark-output-bug)
3. [Speed & Performance Optimizations Applied](#3-speed--performance-optimizations-applied)
4. [One-Line Setup for Future Daytona VPS Instances](#4-one-line-setup-for-future-daytona-vps-instances)
5. [Local PC Access (Unified Control Panel)](#5-local-pc-access-unified-control-panel)
6. [Server Management Cheat-Sheet (On VPS)](#6-server-management-cheat-sheet-on-vps)
7. [Public OpenAI-Compatible Endpoints](#7-public-openai-compatible-endpoints)
8. [OpenClaw + OmniRoute Integration](#8-openclaw--omniroute-integration)
9. [Session Context Length & Compaction Architecture](#9-session-context-length--compaction-architecture)
10. [Timeout Resolution & Tool Schema Normalization](#10-timeout-resolution--tool-schema-normalization)

## 1. Environment & Resource Budget

### Hardware Constraints (Daytona Container)

- **CPU**: 4 vCPUs allocated (Host: AMD EPYC 9354P Zen 4 with full AVX-512 VNNI support).
- **RAM**: Strictly **8.0 GiB** enforced via Linux cgroup (`memory.max = 8589934592` bytes). Swap space is restricted in container.
- **Storage**: 10.0 GiB root overlay.

### Memory & Context Budget (32K Context)

| Component | Memory Allocation | Notes |
| :--- | :--- | :--- |
| **Model Weights** | **~5.33 GiB** | `IQ3_M` quantization (3.66 bpw) loaded into memory |
| **KV Cache (32k Tokens)** | **~1.34 GiB** | Compressed 4x via `--cache-type-k q4_0 --cache-type-v q4_0` |
| **Compute & Runtime Overhead** | **~0.15 GiB** | Graph computations & thread buffers |
| **Total RSS Footprint** | **~6.67 GiB** | Safely running under 8.0 GiB |
| **Safety Headroom Remaining** | **~1.33 GiB FREE** | Prevents Linux OOM-killer triggers |

## 2. Root Cause Analysis: The "Question Mark" Output Bug

### Symptom

When querying the model in the Web UI or API, output was endlessly repeating:
`????????????????????????????????????????????????????????????????...`

### Root Cause

During the initial model download, an interrupted single-stream connection was resumed with `curl -C -`. Due to server offset calculation discrepancies, the file on disk ended up with **88,515,384 extra bytes** (`5,811,182,616` bytes instead of the true `5,722,667,232` bytes).
Because GGUF format relies on exact absolute byte offsets for each layer's tensor weights, every tensor past the splice point was reading shifted, garbage weights. When a neural network evaluates scrambled weights, the logits explode, leading to infinite repeated generation of a single token (in this case, token `?`).

### Permanent Fix

1. Discarded the spliced file.
2. Switched to `aria2c -x 8 -s 8 -k 1M`:
   - 8 concurrent chunk streams from AWS CloudFront / HF CDN.
   - Downloads 5.33 GiB in **~35 seconds** at **126 MB/s**.
   - Verifies chunk-level piece hashes.
3. Verified the exact SHA256 checksum matches the Hugging Face LFS record:

   ```
   726ad4c6c41906e314052e69a294ae3372310c8d11c2e78d4e97784d5beec110
   ```

4. Output immediately restored to fluent reasoning:

   ```
   Thinking Process:
   1. Analyze the Request...
   ```

## 3. Speed & Performance Optimizations Applied

The following optimizations have been configured inside `/home/daytona/start-server.sh`:

```bash
llama-server \
  -m /home/daytona/models/<your-model>.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -t 4 \
  -np 1 \
  -c 32768 \
  -b 512 \
  -ub 512 \
  -fa on \
  --cache-type-k q4_0 \
  --cache-type-v q4_0 \
  --kv-unified \
  --cache-reuse 256 \
  --spec-type draft-mtp \
  --spec-draft-n-max 2 \
  --jinja \
  --chat-template-kwargs '{"preserve_thinking": true}' \
  --timeout 0 \
  --metrics
```

### Why These Flags Maximize CPU Speed

1. **`--spec-type draft-mtp --spec-draft-n-max 2`**:
   - The model contains built-in MTP (Multi-Token Prediction) weights (`blk.32.nextn.*`).
   - Generates speculative tokens in parallel with high acceptance rate, speeding up generation significantly.
2. **`-fa on` (Flash Attention)**:
   - Utilizes Zen 4 AVX-512 FMA vector units to compute scaled dot-product attention without materializing huge attention matrices.
3. **`--cache-type-k q4_0 --cache-type-v q4_0`**:
   - Reduces KV cache memory from ~5.2 GB (FP16) down to ~1.3 GB.
   - Enables **32,768 (32k) context length** to fit in 8GB RAM with 1.33 GB free buffer.
4. **`-np 1`**:
   - Dedicates 100% of compute and the full 32k context buffer to your active session.
5. **`-b 512 -ub 512`**:
   - Prevents CPU cache thrashing during prompt ingestion. Boosts prompt processing to **~13.8 tokens/sec**.
6. **`--jinja --chat-template-kwargs '{"preserve_thinking": true}'`**:
   - Renders Qwen thinking blocks cleanly in the UI.

## 4. One-Line Setup for Future Daytona VPS Instances

To setup any new Daytona VPS from scratch:

1. Upload `setup-daytona-llama.sh` to the VPS:

   ```powershell
   scp -o StrictHostKeyChecking=no scripts/setup-daytona-llama.sh <USER>@<DAYTONA_HOST>:/home/daytona/setup-daytona-llama.sh
   ```

2. Execute the script:

   ```powershell
   ssh <USER>@<DAYTONA_HOST> "bash /home/daytona/setup-daytona-llama.sh"
   ```

The script will automatically:

- Install all dependencies (`cmake`, `build-essential`, `aria2`, `tmux`).
- Compile `llama.cpp` (release `b10941`+) with AVX-512 native CPU flags.
- Download verified model weights using multi-connection aria2c.
- Create helper scripts (`start-server.sh`, `stop-server.sh`, `status-server.sh`, `run-llama-cli.sh`).
- Launch `llama-server` in `tmux` with 32k context and MTP enabled.

## 5. Local PC Access (Unified Control Panel)

Local access is managed directly from the **Unified Modern TUI Control Panel** (`OpenClaw-Control-Panel.exe`):

- **Location**: `bin/OpenClaw-Control-Panel.exe` (and desktop shortcut).
- **Usage**: Select Option `[3]` in the [ControlPanelTui.md](ControlPanelTui.md) (or click the **Llama WebUI** menu card).
- **Functionality**:
  - Automatically tunnels port `8080` over SSH.
  - Verifies `/health` response.
  - Copies `http://localhost:8080` to clipboard.
  - Opens your default web browser to the Web UI.

*(Note: Legacy standalone single-purpose launchers such as `Llama-WebUI-Connect.exe` have been decommissioned in favor of the Unified Control Panel.)*

## 6. Server Management Cheat-Sheet (On VPS)

| Command | Action |
| :--- | :--- |
| `~/status-server.sh` | Check `/health`, PID, RSS memory, and last 20 log lines |
| `~/start-server.sh` | Launch background server in `tmux` |
| `~/stop-server.sh` | Stop the background server |
| `~/run-llama-cli.sh` | Start an interactive terminal chat session |
| `tmux attach -t llama` | View real-time generation logs and token speeds (`Ctrl+B` then `D` to detach) |
| `tail -f /home/daytona/llama-server.log` | Follow server logs in terminal |

## 7. Public OpenAI-Compatible Endpoints

Two persistent public endpoints are available for accessing this `llama.cpp` instance from anywhere on the internet without active SSH tunnels:

### A. Primary Public Endpoint (Railway High-Performance Relay)

- **Base URL**: `https://<your-llama-relay>.up.railway.app/v1`
- **Models Endpoint**: `https://<your-llama-relay>.up.railway.app/v1/models`
- **Chat Completions**: `https://<your-llama-relay>.up.railway.app/v1/chat/completions`
- **Health Check**: `https://<your-llama-relay>.up.railway.app/health`
- **Infrastructure**: Deployed on Railway using a zero-dependency streaming Node.js proxy (see [RailwayRelayManual.md](RailwayRelayManual.md)). Fully unbuffered HTTP chunked streaming (SSE), global CORS (`*`), zero timeouts (`timeout: 0`).
- **Target Upstream**: `https://8080-<sandbox-id>.proxy.daytona.work`

### B. Direct Daytona Sandbox Preview Endpoint

- **Base URL**: `https://8080-<sandbox-id>.proxy.daytona.work/v1`
- **Models Endpoint**: `https://8080-<sandbox-id>.proxy.daytona.work/v1/models`

### Example cURL Request

```bash
curl -X POST https://<your-llama-relay>.up.railway.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the speed of light?"}],
    "max_tokens": 512,
    "temperature": 0.7
  }'
```

## 8. OpenClaw + OmniRoute Integration

The primary OpenClaw VPS connects to this model through both OmniRoute and OpenClaw:

### A. OmniRoute Configuration

- **Database**: `/home/daytona/.omniroute/storage.sqlite` (see [OmnirouteVpsManual.md](OmnirouteVpsManual.md))
- **Provider Prefix**: `daytona-llama`
- **Base URL**: `https://<your-llama-relay>.up.railway.app/v1`
- **Registered Model ID**:
  - `daytona-llama/qwen3.5-9b-defiant-fable`
- **Local API Gateway**: `http://127.0.0.1:20128/v1/chat/completions` (Auth: `Bearer <your-omniroute-key>`)

### B. OpenClaw Configuration

- **Config Path**: `/home/daytona/.openclaw/openclaw.json` (see [OpenclawManual.md](OpenclawManual.md))
- Model canonical ID recognized by OpenClaw:
  - `omniroute/daytona-llama/qwen3.5-9b-defiant-fable` (`contextWindow: 32768`)

## 9. Session Context Length & Compaction Architecture

OpenClaw derives its per-turn prompt budget and compaction trigger dynamically from each model's configured `contextWindow`:

$$\text{Effective Reserve} = \min(\text{reserveTokens},\, \text{contextTokenBudget} \times 0.25)$$
$$\text{Prompt Budget Before Reserve} = \text{contextTokenBudget} - \text{Effective Reserve}$$

### Context Safeguards

- `mode`: `"safeguard"` — Verifies summary quality audits and guarantees continuity.
- `keepRecentTokens`: `30000` — Preserves a generous 30k recent token window upon compaction.
- `recentTurnsPreserve`: `6` — Preserves 6 recent assistant/user dialogue turns verbatim.
- `midTurnPrecheck.enabled`: `true` — Prechecks context pressure mid-turn so long tool loops avoid context overflows.
- `memoryFlush.enabled`: `true` (soft threshold: `4000` tokens) — Flushes critical session memories before history reduction takes place.

## 10. Timeout Resolution & Tool Schema Normalization

### The 15-Second Bottleneck Timeout Bug (HTTP 504)

- **Problem**: OmniRoute's Bottleneck rate limiter had an internal `maxWaitMs = 15000ms`. Deep prompt evaluations on CPU exceeded 15 seconds, throwing 504 errors.
- **Solution**: Set `RATE_LIMIT_MAX_WAIT_MS=3600000` and updated `storage.sqlite` connection settings to disable rate limit penalties (`rate_limit_protection = 0`).

### Schema Normalization

By running with `--jinja` and configuring `"compat": { "supportsTools": true, "toolSchemaProfile": "llamacpp" }` in OpenClaw, the system preserves full agent tool support while translating complex JSON schemas into llama.cpp compatible syntax.
