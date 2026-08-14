#!/usr/bin/env python3
"""One-time TikTok OAuth; saves refresh token to tiktok/token.json.

Requires TIKTOK_REDIRECT_URI to be HTTPS (ngrok) and registered on the app.
This process listens on 127.0.0.1:8765 — ngrok must forward to that port.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TOKEN_PATH = SKILL_DIR / "token.json"
ENV_PATH = SKILL_DIR / ".env"
AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
SCOPES = "user.info.basic,video.publish,video.upload"
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8765


def load_env() -> dict[str, str]:
    if not ENV_PATH.is_file():
        raise SystemExit(f"Missing {ENV_PATH}. Copy .env.example to .env.")
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    key = env.get("TIKTOK_CLIENT_KEY", "")
    secret = env.get("TIKTOK_CLIENT_SECRET", "")
    redirect = env.get("TIKTOK_REDIRECT_URI", "")
    if not key or not secret or "your-client" in key:
        raise SystemExit("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env")
    if not redirect or "YOUR-NGROK" in redirect:
        raise SystemExit("Set TIKTOK_REDIRECT_URI to your HTTPS ngrok callback URL")
    if not redirect.startswith("https://"):
        raise SystemExit("TIKTOK_REDIRECT_URI must be https:// (TikTok rejects localhost)")
    return env


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = (
        __import__("base64").urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    )
    return verifier, challenge


def exchange_code(env: dict[str, str], code: str, verifier: str) -> dict:
    body = urllib.parse.urlencode(
        {
            "client_key": env["TIKTOK_CLIENT_KEY"],
            "client_secret": env["TIKTOK_CLIENT_SECRET"],
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": env["TIKTOK_REDIRECT_URI"],
            "code_verifier": verifier,
        }
    ).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    if data.get("error") or not data.get("access_token"):
        raise SystemExit(f"Token exchange failed: {data}")
    return data


def main() -> None:
    env = load_env()
    state = secrets.token_urlsafe(16)
    verifier, challenge = _pkce()
    params = {
        "client_key": env["TIKTOK_CLIENT_KEY"],
        "response_type": "code",
        "scope": SCOPES,
        "redirect_uri": env["TIKTOK_REDIRECT_URI"],
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)
    bag: dict = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # noqa: ARG002
            return

        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path.rstrip("/") != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            qs = urllib.parse.parse_qs(parsed.query)
            bag["query"] = {k: v[0] for k, v in qs.items() if v}
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<html><body><p>TikTok auth received. You can close this tab.</p></body></html>"
            )

    print(
        f"Listening on http://{LISTEN_HOST}:{LISTEN_PORT}/callback\n"
        f"ngrok must forward HTTPS → that port, and TIKTOK_REDIRECT_URI must match.\n"
        f"Opening TikTok…",
        file=sys.stderr,
    )
    server = HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    webbrowser.open(url)
    while "query" not in bag:
        server.handle_request()
    server.server_close()

    query = bag["query"]
    if query.get("state") != state:
        raise SystemExit("OAuth state mismatch")
    if query.get("error"):
        raise SystemExit(query.get("error_description") or query["error"])
    code = query.get("code")
    if not code:
        raise SystemExit(f"No code in callback: {query}")

    token = exchange_code(env, urllib.parse.unquote(code), verifier)
    TOKEN_PATH.write_text(json.dumps(token, indent=2) + "\n")
    print(f"Saved credentials to {TOKEN_PATH}")
    print("Test: ./venv/bin/python tiktok/scripts/upload_short.py --help")


if __name__ == "__main__":
    main()
