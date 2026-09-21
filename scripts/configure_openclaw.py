#!/usr/bin/env python3
"""
configure_openclaw.py - Programmatic Config Generator for OpenClaw
Configures multi-user session isolation, Telegram bot settings, owner allowlist,
and optional OmniRoute provider integration.
"""

import argparse
import json
import os
import sys
import shutil

DEFAULT_CUSTOM_COMMANDS = [
    {"command": "menu", "description": "Show interactive settings & controls menu"},
    {"command": "settings", "description": "Show bot settings & parameters"},
    {"command": "model", "description": "Select or switch AI model (-s, -a, -g)"},
    {"command": "models", "description": "List all available models & providers"},
    {"command": "status", "description": "Check current model, context & session"},
    {"command": "think", "description": "Set reasoning / thinking effort level"},
    {"command": "fast", "description": "Toggle fast inference mode"},
    {"command": "new", "description": "Start a fresh isolated session"},
    {"command": "reset", "description": "Reset current conversation context"},
    {"command": "whoami", "description": "Show your Telegram ID & authorization"},
    {"command": "usage", "description": "Show token usage & cost summary"},
    {"command": "dashboard", "description": "Open Control UI Mini App"}
]

DEFAULT_AUTO_MODELS = [
    {"id": "auto/best-chat", "name": "OmniRoute Best Chat", "contextWindow": 128000, "maxTokens": 8192},
    {"id": "auto/best-coding", "name": "OmniRoute Best Coding", "contextWindow": 128000, "maxTokens": 8192},
    {"id": "auto/best-free", "name": "OmniRoute Best Free", "contextWindow": 64000, "maxTokens": 8192},
    {"id": "auto/best-reasoning", "name": "OmniRoute Best Reasoning", "contextWindow": 128000, "maxTokens": 16384},
    {"id": "auto/pro-coding", "name": "OmniRoute Pro Coding", "contextWindow": 128000, "maxTokens": 8192}
]


def load_config(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Failed to parse existing {path}: {e}. Creating new configuration.")
    return {}


def save_config(path: str, data: dict, backup: bool = True):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if backup and os.path.exists(path):
        backup_path = path + ".bak"
        shutil.copyfile(path, backup_path)
        print(f"[INFO] Backed up existing config to {backup_path}")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"[SUCCESS] Config successfully saved to {path}")


def main():
    parser = argparse.ArgumentParser(description="Configure OpenClaw with multi-user isolation & Telegram")
    parser.add_argument("--config-file", default=os.path.expanduser("~/.openclaw/openclaw.json"),
                        help="Path to openclaw.json")
    parser.add_argument("--bot-token", required=False, help="Telegram Bot Token from @BotFather")
    parser.add_argument("--owner-ids", nargs="*", default=[],
                        help="Telegram numeric IDs for owner privileges (e.g. 123456789)")
    parser.add_argument("--dm-scope", default="per-channel-peer", choices=["per-channel-peer", "main"],
                        help="DM isolation scope (default: per-channel-peer)")
    parser.add_argument("--omniroute-url", default="http://127.0.0.1:20128/v1",
                        help="OmniRoute base URL (default: http://127.0.0.1:20128/v1)")
    parser.add_argument("--omniroute-key", default="sk-omniroute-openclaw-key",
                        help="OmniRoute API key for OpenClaw")
    parser.add_argument("--enable-omniroute", action="store_true", default=True,
                        help="Enable OmniRoute model provider")
    parser.add_argument("--models-json", help="Path to JSON file containing models array")

    args = parser.parse_args()

    cfg = load_config(args.config_file)

    # 1. Base Agent Structure
    cfg.setdefault("agents", {})
    cfg["agents"].setdefault("defaults", {})
    cfg["agents"]["defaults"]["workspace"] = cfg["agents"]["defaults"].get(
        "workspace", os.path.expanduser("~/.openclaw/workspace")
    )
    if args.enable_omniroute:
        cfg["agents"]["defaults"]["model"] = {
            "primary": "omniroute/auto/best-chat",
            "fallbacks": ["omniroute/auto/best-coding"]
        }
        cfg["agents"]["defaults"]["imageModel"] = {
            "primary": "omniroute/gemini/gemini-2.5-flash",
            "fallbacks": [
                "omniroute/openai/gpt-5.6",
                "omniroute/anthropic/claude-sonnet-5"
            ]
        }

    # 2. Session Isolation
    cfg.setdefault("session", {})
    cfg["session"]["dmScope"] = args.dm_scope

    # 3. Memory Isolation
    cfg.setdefault("memory", {})
    cfg["memory"].setdefault("search", {})
    cfg["memory"]["search"]["rememberAcrossConversations"] = False

    # 4. Commands & Permissions
    cfg.setdefault("commands", {})
    cfg["commands"]["native"] = "auto"
    cfg["commands"]["nativeSkills"] = False
    cfg["commands"]["text"] = True
    cfg["commands"]["restart"] = True

    if args.owner_ids:
        owner_list = [f"telegram:{oid}" if not oid.startswith("telegram:") else oid for oid in args.owner_ids]
        cfg["commands"]["ownerAllowFrom"] = owner_list

    # 5. Telegram Channel
    if args.bot_token:
        cfg.setdefault("channels", {})
        cfg["channels"]["telegram"] = {
            "enabled": True,
            "botToken": args.bot_token,
            "dmPolicy": "open",
            "allowFrom": ["*"],
            "capabilities": {
                "inlineButtons": "all"
            },
            "customCommands": DEFAULT_CUSTOM_COMMANDS
        }

    # 6. OmniRoute Provider & Model Catalog
    if args.enable_omniroute:
        cfg.setdefault("models", {})
        cfg["models"].setdefault("providers", {})

        models_list = DEFAULT_AUTO_MODELS
        if args.models_json and os.path.exists(args.models_json):
            try:
                with open(args.models_json, "r", encoding="utf-8") as mf:
                    models_list = json.load(mf)
                print(f"[INFO] Loaded {len(models_list)} models from {args.models_json}")
            except Exception as e:
                print(f"[WARN] Failed to load {args.models_json}: {e}")

        vision_keywords = ["gemini", "gpt-5", "claude", "vision", "qwen3.8-max", "qwen3.7-max", "kimi"]
        for m in models_list:
            mid = m.get("id", "").lower()
            if "daytona-llama" in mid or "llama" in mid:
                m.setdefault("compat", {})
                m["compat"]["supportsTools"] = True
                m["compat"]["toolSchemaProfile"] = "llamacpp"
            if any(k in mid for k in vision_keywords) and "transcribe" not in mid:
                m["input"] = ["text", "image"]

        cfg["models"]["providers"]["omniroute"] = {
            "baseUrl": args.omniroute_url,
            "apiKey": args.omniroute_key,
            "api": "openai-completions",
            "models": models_list
        }

    save_config(args.config_file, cfg)


if __name__ == "__main__":
    main()
