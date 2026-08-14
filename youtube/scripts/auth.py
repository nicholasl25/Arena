#!/usr/bin/env python3
"""One-time OAuth flow; saves refresh token to token.json."""

from __future__ import annotations

import json
import os
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SKILL_DIR = Path(__file__).resolve().parent.parent
TOKEN_PATH = SKILL_DIR / "token.json"
ENV_PATH = SKILL_DIR / ".env"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def load_env() -> tuple[str, str]:
    if not ENV_PATH.exists():
        raise SystemExit(
            f"Missing {ENV_PATH}. Copy .env.example to .env and set YT_CLIENT_ID / YT_CLIENT_SECRET."
        )
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    client_id = env.get("YT_CLIENT_ID", "")
    client_secret = env.get("YT_CLIENT_SECRET", "")
    if not client_id or not client_secret or "your-client" in client_id:
        raise SystemExit("Set real YT_CLIENT_ID and YT_CLIENT_SECRET in .env")
    return client_id, client_secret


def client_config(client_id: str, client_secret: str) -> dict:
    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def main() -> None:
    client_id, client_secret = load_env()
    flow = InstalledAppFlow.from_client_config(
        client_config(client_id, client_secret),
        scopes=SCOPES,
    )
    creds = flow.run_local_server(port=0, open_browser=True)
    TOKEN_PATH.write_text(creds.to_json())
    print(f"Saved credentials to {TOKEN_PATH}")
    print("You can now run: python scripts/upload_short.py --help")


if __name__ == "__main__":
    main()
