#!/usr/bin/env python3
"""Upload a video file as a YouTube Short (standard videos.insert API)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SKILL_DIR = Path(__file__).resolve().parent.parent
TOKEN_PATH = SKILL_DIR / "token.json"
ENV_PATH = SKILL_DIR / ".env"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def load_env() -> tuple[str, str]:
    if not ENV_PATH.exists():
        raise SystemExit(f"Missing {ENV_PATH}. See setup.md.")
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env.get("YT_CLIENT_ID", ""), env.get("YT_CLIENT_SECRET", "")


def get_credentials() -> Credentials:
    if not TOKEN_PATH.exists():
        raise SystemExit(f"No token at {TOKEN_PATH}. Run: python scripts/auth.py")

    client_id, client_secret = load_env()
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds.client_id and client_id:
        creds = Credentials(
            token=creds.token,
            refresh_token=creds.refresh_token,
            token_uri=creds.token_uri or "https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES,
        )
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json())
        except Exception as exc:  # noqa: BLE001
            TOKEN_PATH.unlink(missing_ok=True)
            raise SystemExit(
                f"YouTube auth expired or revoked ({exc}).\n"
                f"Re-auth: cd youtube && .venv/bin/python scripts/auth.py"
            ) from exc
    if not creds.valid:
        raise SystemExit("Invalid credentials. Run: python scripts/auth.py")
    return creds


def parse_schedule(value: str | None) -> str | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload a YouTube Short")
    parser.add_argument("--file", required=True, help="Path to video file (.webm, .mp4, …)")
    parser.add_argument("--title", required=True, help="Video title")
    parser.add_argument("--description", default="", help="Video description")
    parser.add_argument(
        "--privacy",
        default="public",
        choices=["public", "unlisted", "private"],
    )
    parser.add_argument("--tags", default="", help="Comma-separated tags")
    parser.add_argument("--category", default="20", help="YouTube categoryId (default 20 = Gaming)")
    parser.add_argument(
        "--schedule",
        default=None,
        help="ISO-8601 UTC publish time (forces privacy=private until publish)",
    )
    parser.add_argument("--made-for-kids", action="store_true")
    args = parser.parse_args()

    video_path = Path(args.file).expanduser().resolve()
    if not video_path.is_file():
        raise SystemExit(f"File not found: {video_path}")

    privacy = args.privacy
    publish_at = parse_schedule(args.schedule)
    if publish_at:
        privacy = "private"

    body: dict = {
        "snippet": {
            "title": args.title[:100],
            "description": args.description,
            "categoryId": str(args.category),
        },
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": args.made_for_kids,
        },
    }
    if args.tags.strip():
        body["snippet"]["tags"] = [t.strip() for t in args.tags.split(",") if t.strip()]
    if publish_at:
        body["status"]["publishAt"] = publish_at

    creds = get_credentials()
    youtube = build("youtube", "v3", credentials=creds)

    media = MediaFileUpload(
        str(video_path),
        mimetype=None,
        resumable=True,
        chunksize=1024 * 1024 * 8,
    )

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            print(f"Upload {pct}%", file=sys.stderr)

    video_id = response["id"]
    result = {
        "videoId": video_id,
        "shortsUrl": f"https://www.youtube.com/shorts/{video_id}",
        "watchUrl": f"https://youtu.be/{video_id}",
        "studioUrl": f"https://studio.youtube.com/video/{video_id}/edit",
        "privacy": privacy,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
