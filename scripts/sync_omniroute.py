#!/usr/bin/env python3
"""
sync_omniroute.py - Sync custom models between OmniRoute SQLite and OpenClaw
Exports/imports custom model definitions, overcomes the 15-model display limit,
and generates the model catalog for openclaw.json.
"""

import argparse
import json
import os
import sqlite3
import urllib.request


def export_custom_models(db_path: str) -> tuple[dict, dict]:
    """Export customModels and modelAliases from OmniRoute SQLite database."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    custom_models = {}
    for k, v in c.execute("SELECT key, value FROM key_value WHERE namespace='customModels'").fetchall():
        try:
            custom_models[k] = json.loads(v)
        except Exception:
            pass

    aliases = {}
    for k, v in c.execute("SELECT key, value FROM key_value WHERE namespace='modelAliases'").fetchall():
        try:
            aliases[k] = json.loads(v)
        except Exception:
            pass

    conn.close()
    return custom_models, aliases


def import_custom_models(db_path: str, custom_models: dict, aliases: dict):
    """Import customModels and modelAliases into OmniRoute SQLite database."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    for k, v in custom_models.items():
        c.execute(
            "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('customModels', ?, ?)",
            (k, json.dumps(v))
        )

    for k, v in aliases.items():
        c.execute(
            "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('modelAliases', ?, ?)",
            (k, json.dumps(v))
        )

    conn.commit()
    conn.close()
    print(f"[SUCCESS] Imported {len(custom_models)} customModels namespaces and {len(aliases)} modelAliases into {db_path}")


def generate_openclaw_models(custom_models: dict, opencode_path: str = None) -> list:
    """Generate the models array needed by OpenClaw openclaw.json."""
    models_dict = {
        "auto/best-chat": {"id": "auto/best-chat", "name": "OmniRoute Best Chat", "contextWindow": 128000, "maxTokens": 8192},
        "auto/best-coding": {"id": "auto/best-coding", "name": "OmniRoute Best Coding", "contextWindow": 128000, "maxTokens": 8192},
        "auto/best-free": {"id": "auto/best-free", "name": "OmniRoute Best Free", "contextWindow": 64000, "maxTokens": 8192},
        "auto/best-reasoning": {"id": "auto/best-reasoning", "name": "OmniRoute Best Reasoning", "contextWindow": 128000, "maxTokens": 16384},
        "auto/pro-coding": {"id": "auto/pro-coding", "name": "OmniRoute Pro Coding", "contextWindow": 128000, "maxTokens": 8192}
    }

    # If opencode.json provided, load model limits and friendly names
    if opencode_path and os.path.exists(opencode_path):
        with open(opencode_path, "r", encoding="utf-8") as f:
            opencode = json.load(f)
        opencode_omni = opencode.get("provider", {}).get("omniroute", {}).get("models", {})
        for m_id, m_meta in opencode_omni.items():
            limit = m_meta.get("limit", {})
            models_dict[m_id] = {
                "id": m_id,
                "name": m_meta.get("name", m_id),
                "contextWindow": limit.get("context", 128000),
                "maxTokens": limit.get("output", 8192)
            }

    # Also load from custom_models dictionary
    for provider, m_list in custom_models.items():
        if isinstance(m_list, list):
            for m in m_list:
                m_id = f"{provider}/{m.get('id', '')}"
                if m_id not in models_dict:
                    models_dict[m_id] = {
                        "id": m_id,
                        "name": m.get("name", m.get("id", m_id)),
                        "contextWindow": 128000,
                        "maxTokens": 8192
                    }

    return list(models_dict.values())


def query_omniroute_models(url: str, api_key: str) -> list:
    """Query live OmniRoute /v1/models endpoint."""
    req = urllib.request.Request(f"{url.rstrip('/')}/models")
    req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return [m["id"] for m in data.get("data", [])]


def main():
    parser = argparse.ArgumentParser(description="Sync custom models for OmniRoute & OpenClaw")
    parser.add_argument("--db", default=os.path.expanduser("~/.omniroute/storage.sqlite"),
                        help="Path to OmniRoute storage.sqlite")
    parser.add_argument("--export", help="Path to export custom models JSON file")
    parser.add_argument("--import-file", help="Path to custom models JSON file to import")
    parser.add_argument("--opencode-config", help="Optional path to opencode.json for model limits")
    parser.add_argument("--output-openclaw-models", help="Output path for openclaw models list JSON")
    parser.add_argument("--test-url", help="OmniRoute base URL to test (e.g. http://127.0.0.1:20128/v1)")
    parser.add_argument("--api-key", default="sk-omniroute-openclaw-key", help="OmniRoute API key")
    parser.add_argument("--sync-to-openclaw", action="store_true",
                        help="Directly update openclaw.json with connected OmniRoute models")
    parser.add_argument("--openclaw-config", help="Explicit path to openclaw.json")

    args = parser.parse_args()

    if args.import_file and os.path.exists(args.import_file):
        with open(args.import_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        custom_models = data.get("customModels", data)
        aliases = data.get("modelAliases", {})
        import_custom_models(args.db, custom_models, aliases)

    if args.export:
        custom_models, aliases = export_custom_models(args.db)
        with open(args.export, "w", encoding="utf-8") as f:
            json.dump({"customModels": custom_models, "modelAliases": aliases}, f, indent=2)
        print(f"[SUCCESS] Exported custom models and aliases to {args.export}")

    if args.output_openclaw_models:
        custom_models, _ = export_custom_models(args.db)
        models_list = generate_openclaw_models(custom_models, args.opencode_config)
        with open(args.output_openclaw_models, "w", encoding="utf-8") as f:
            json.dump(models_list, f, indent=2)
        print(f"[SUCCESS] Generated {len(models_list)} models for OpenClaw in {args.output_openclaw_models}")

    if args.sync_to_openclaw:
        candidates = [
            args.openclaw_config,
            os.path.expanduser("~/.openclaw/openclaw.json"),
            "/home/freestyle/.openclaw/openclaw.json",
            "/home/daytona/.openclaw/openclaw.json",
            "/home/ubuntu/.openclaw/openclaw.json",
            "/root/.openclaw/openclaw.json"
        ]
        oc_path = next((p for p in candidates if p and os.path.exists(p)), None)
        if not oc_path:
            oc_path = os.path.expanduser("~/.openclaw/openclaw.json")
            os.makedirs(os.path.dirname(oc_path), exist_ok=True)
            with open(oc_path, "w", encoding="utf-8") as f:
                json.dump({"models": {"providers": {}}}, f, indent=2)

        custom_models, _ = export_custom_models(args.db) if os.path.exists(args.db) else ({}, {})
        models_list = generate_openclaw_models(custom_models, args.opencode_config)
        
        # Also query live endpoint if available
        endpoint = args.test_url or "http://127.0.0.1:20128/v1"
        try:
            live_ids = query_omniroute_models(endpoint, args.api_key)
            existing_ids = {m["id"] for m in models_list}
            for lid in live_ids:
                if lid not in existing_ids:
                    models_list.append({
                        "id": lid,
                        "name": f"OmniRoute {lid.split('/')[-1].replace('-', ' ').title()}",
                        "contextWindow": 128000,
                        "maxTokens": 8192
                    })
        except Exception:
            pass

        # Also discover Llama models
        llama_targets = [os.environ.get('LLAMA_ENDPOINT', ''), 'http://127.0.0.1:8080/v1', 'http://127.0.0.1:8080']
        for lt in llama_targets:
            if not lt:
                continue
            try:
                l_url = lt.rstrip('/') + ('/models' if lt.endswith('/v1') else '/v1/models')
                with urllib.request.urlopen(l_url, timeout=3) as l_resp:
                    for item in json.loads(l_resp.read().decode('utf-8')).get('data', []):
                        mid = item.get('id')
                        if mid:
                            m_id = f"daytona-llama/{mid.split('/')[-1]}"
                            if not any(m['id'] == m_id for m in models_list):
                                models_list.append({
                                    "id": m_id,
                                    "name": f"OmniRoute Local Llama ({mid.split('/')[-1]})",
                                    "contextWindow": 32768,
                                    "maxTokens": 8192,
                                    "compat": {"supportsTools": True, "toolSchemaProfile": "llamacpp"}
                                })
                    break
            except Exception:
                pass

        with open(oc_path, "r", encoding="utf-8") as f:
            oc_data = json.load(f)
        omni = oc_data.setdefault("models", {}).setdefault("providers", {}).setdefault("omniroute", {})
        omni["baseUrl"] = omni.get("baseUrl", endpoint)
        omni["apiKey"] = omni.get("apiKey", args.api_key)
        omni["models"] = models_list
        with open(oc_path, "w", encoding="utf-8") as f:
            json.dump(oc_data, f, indent=2)
        try:
            os.chmod(oc_path, 0o600)
        except Exception:
            pass
        print(f"[SUCCESS] Synced {len(models_list)} models to {oc_path}")

    if args.test_url:
        try:
            models = query_omniroute_models(args.test_url, args.api_key)
            print(f"[INFO] OmniRoute at {args.test_url} returned {len(models)} active models.")
        except Exception as e:
            print(f"[ERROR] Could not query OmniRoute at {args.test_url}: {e}")


if __name__ == "__main__":
    main()
