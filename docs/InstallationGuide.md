# OpenClaw-for-free — Installation & Distribution Guide

This guide details the primary methods for distributing, installing, and running the OpenClaw-for-free Control Panel across Windows, macOS, and Linux.

## Table of Contents

1. [Distribution Strategy Overview](#1-distribution-strategy-overview)
2. [Method 1: Fast URL One-Liner (PowerShell & Bash)](#2-method-1-fast-url-one-liner-powershell--bash)
3. [Method 2: Zero-Install NPX / NPM Runner](#3-method-2-zero-install-npx--npm-runner)
4. [Method 3: Direct Standalone Binary Download](#4-method-3-direct-standalone-binary-download)
5. [Maintenance & Updates](#5-maintenance--updates)

## 1. Distribution Strategy Overview

| Method | Target Users | Prerequisites | Download Size | Update Flow |
| :--- | :--- | :--- | :--- | :--- |
| **Public Telegram Bot ([@openclaw4free_bot](https://t.me/openclaw4free_bot)) [Recommended]** | Mobile, Web & Cloud Users | Telegram Account | **0 KB** (hosted in cloud) | Automatic cloud updates |
| **Method 1: One-Liner Script (PowerShell / Bash)** | Desktop & End Users | None (pure OS) | ~35 MB – 95 MB (compiled binary) | Re-run script or auto-check |
| **Method 2: Zero-Install NPX / NPM** | Developers & Node Users | Node.js 22 LTS (v18+ supported) | **~180 KB** (lightweight bundle) | Handled automatically by `npx` |
| **Method 3: Standalone Executable (`bin/`)** | Local Workstations | None | ~95 MB (includes embedded Node runtime) | Download new release binary |

## 2. Method 1: Fast URL One-Liner (PowerShell & Bash) [Recommended]

An automated 1-line installer that downloads the latest precompiled release binary, installs it to user-space, configures PATH, and launches the Control Panel.

### Windows (PowerShell)

Run in Windows PowerShell (no administrator privileges required):

```powershell
irm https://raw.githubusercontent.com/<USER>/<REPO>/main/install.ps1 | iex
```

#### What It Does

1. **Pre-flight Check**: Verifies that Windows OpenSSH Client (`ssh.exe`) is installed.
2. **Release Resolution**: Queries the GitHub API for the latest published release tag.
3. **User-Space Installation**: Downloads `OpenClaw-Control-Panel.exe` into:

   ```text
   $env:LOCALAPPDATA\Programs\OpenClaw\OpenClaw-Control-Panel.exe
   ```

4. **PATH Configuration**: Adds the installation directory to the current user's persistent `PATH` environment variable without requiring UAC/Admin elevation.
5. **Desktop Shortcut**: Creates an `OpenClaw Control Panel.lnk` shortcut on the Desktop.
6. **Execution**: Launches the TUI immediately.

### macOS & Linux (Bash)

Run in any POSIX terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/<USER>/<REPO>/main/install.sh | bash
```

#### What It Does

1. **Architecture Detection**: Detects OS (`Darwin` vs `Linux`) and CPU (`x86_64` vs `arm64` / Apple Silicon).
2. **Download & Permissions**: Downloads the matching binary to `~/.local/bin/openclaw` and sets execute bits (`chmod +x`).
3. **Shell PATH Integration**: Appends `~/.local/bin` to `~/.bashrc` or `~/.zshrc` if not already present.
4. **Execution**: Launches the terminal interface.

## 3. Method 2: Zero-Install NPX / NPM Runner

For users with Node.js installed (Node.js 22 LTS recommended, v18+ supported), this method requires **no compilation, no binary downloads, and zero disk bloat**.

### Instant Run with `npx` (No permanent installation)

```bash
npx openclaw-for-free
```

- Pulls the latest published package bundle (~180 KB) directly into a temporary cache and launches immediately.
- Always runs the newest version published to npm.

### Global Installation via `npm`

```bash
npm install -g openclaw-for-free
openclaw
```

## 4. Method 3: Direct Standalone Binary Download

If you prefer precompiled standalone binaries:

1. Download `OpenClaw-Control-Panel.exe` from the latest GitHub Release or repository `bin/` directory.
2. Double-click to launch (or run from your terminal).
3. The application will store its state in `~/.openclaw-control-panel.json` and guide you through connecting your Daytona Cloud or Freestyle.sh VPS.

For detailed TUI keybindings and operational usage, see [ControlPanelTui.md](ControlPanelTui.md).

## 5. Maintenance & Updates

### Updating

- **PowerShell / Bash One-Liner**: Simply re-run the 1-line command to fetch and overwrite with the latest release.
- **NPX**: Automatically checks and runs the latest version on each invocation.
- **NPM Global**: Update with `npm update -g openclaw-for-free`.

### Uninstalling

- **Windows**: Delete folder `$env:LOCALAPPDATA\Programs\OpenClaw` and the Desktop shortcut.
- **macOS / Linux**: Remove binary `rm ~/.local/bin/openclaw`.
- **NPM**: Run `npm uninstall -g openclaw-for-free`.
