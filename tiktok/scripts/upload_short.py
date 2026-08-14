#!/usr/bin/env python3
"""Upload a local video via TikTok Content Posting API (direct post)."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TOKEN_PATH = SKILL_DIR / "token.json"
ENV_PATH = SKILL_DIR / ".env"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
CREATOR_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
INBOX_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"

PRIVACY_MAP = {
    "public": "PUBLIC_TO_EVERYONE",
    "unlisted": "MUTUAL_FOLLOW_FRIENDS",
    "private": "SELF_ONLY",
}


def load_env() -> dict[str, str]:
    if not ENV_PATH.is_file():
        raise SystemExit(f"Missing {ENV_PATH}. See setup.md.")
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def _post_form(url: str, fields: dict) -> dict:
    body = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _post_json(url: str, token: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"TikTok HTTP {exc.code}: {detail}") from exc


def load_token() -> dict:
    if not TOKEN_PATH.is_file():
        raise SystemExit(f"No token at {TOKEN_PATH}. Run: python tiktok/scripts/auth.py")
    return json.loads(TOKEN_PATH.read_text())


def save_token(token: dict) -> None:
    TOKEN_PATH.write_text(json.dumps(token, indent=2) + "\n")


def get_access_token() -> str:
    env = load_env()
    token = load_token()
    access = token.get("access_token")
    refresh = token.get("refresh_token")
    if not refresh:
        raise SystemExit("token.json has no refresh_token — re-run auth.py")
    refreshed = _post_form(
        TOKEN_URL,
        {
            "client_key": env["TIKTOK_CLIENT_KEY"],
            "client_secret": env["TIKTOK_CLIENT_SECRET"],
            "grant_type": "refresh_token",
            "refresh_token": refresh,
        },
    )
    if refreshed.get("error") or not refreshed.get("access_token"):
        TOKEN_PATH.unlink(missing_ok=True)
        raise SystemExit(
            f"TikTok auth expired ({refreshed}). Re-auth: python tiktok/scripts/auth.py"
        )
    token.update(refreshed)
    if access and not refreshed.get("refresh_token"):
        token["refresh_token"] = refresh
    save_token(token)
    return token["access_token"]


def query_creator(access: str) -> dict:
    result = _post_json(CREATOR_URL, access, {})
    err = result.get("error") or {}
    if err.get("code") not in (None, "", "ok"):
        raise SystemExit(f"creator_info failed: {result}")
    return result.get("data") or {}


def pick_privacy(wanted: str, options: list[str]) -> str:
    mapped = PRIVACY_MAP.get(wanted, "SELF_ONLY")
    if mapped in options:
        return mapped
    if "SELF_ONLY" in options:
        return "SELF_ONLY"
    return options[0] if options else "SELF_ONLY"


def chunk_plan(size: int) -> tuple[int, int]:
    """Return (chunk_size, total_chunk_count). Last chunk may be smaller."""
    if size <= 0:
        raise SystemExit("empty video")
    # TikTok: min chunk 5MB except when the whole file is one chunk.
    if size < 5 * 1024 * 1024:
        return size, 1
    chunk = 10 * 1024 * 1024
    count = (size + chunk - 1) // chunk
    return chunk, count


def put_chunks(upload_url: str, path: Path, chunk_size: int) -> None:
    data = path.read_bytes()
    total = len(data)
    mime = "video/mp4" if path.suffix.lower() == ".mp4" else "video/webm"
    start = 0
    while start < total:
        end = min(start + chunk_size, total)
        chunk = data[start:end]
        req = urllib.request.Request(
            upload_url,
            data=chunk,
            method="PUT",
            headers={
                "Content-Type": mime,
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {start}-{end - 1}/{total}",
            },
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            resp.read()
        print(f"Upload {end}/{total}", file=sys.stderr)
        start = end


def poll_status(access: str, publish_id: str, timeout_sec: float = 180) -> dict:
    deadline = time.time() + timeout_sec
    last: dict = {}
    while time.time() < deadline:
        last = _post_json(STATUS_URL, access, {"publish_id": publish_id})
        data = last.get("data") or {}
        status = str(data.get("status") or "")
        print(f"TikTok status {status or '?'}", file=sys.stderr)
        if status in {"PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"}:
            return last
        time.sleep(3)
    return last


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload a TikTok via Content Posting API")
    parser.add_argument("--file", required=True)
    parser.add_argument("--title", required=True, help="Caption (TikTok post title)")
    parser.add_argument("--description", default="", help="Appended to caption")
    parser.add_argument(
        "--privacy",
        default="private",
        choices=["public", "unlisted", "private"],
    )
    parser.add_argument(
        "--inbox",
        action="store_true",
        help="Send to TikTok inbox/drafts instead of direct post",
    )
    args = parser.parse_args()

    video_path = Path(args.file).expanduser().resolve()
    if not video_path.is_file():
        raise SystemExit(f"File not found: {video_path}")

    caption = args.title.strip()
    if args.description.strip():
        caption = f"{caption}\n\n{args.description.strip()}"
    caption = caption[:2200]

    access = get_access_token()
    size = video_path.stat().st_size
    chunk_size, chunk_count = chunk_plan(size)
    source = {
        "source": "FILE_UPLOAD",
        "video_size": size,
        "chunk_size": chunk_size,
        "total_chunk_count": chunk_count,
    }

    if args.inbox:
        init = _post_json(INBOX_INIT_URL, access, {"source_info": source})
    else:
        creator = query_creator(access)
        options = creator.get("privacy_level_options") or ["SELF_ONLY"]
        privacy = pick_privacy(args.privacy, options)
        init = _post_json(
            INIT_URL,
            access,
            {
                "post_info": {
                    "title": caption,
                    "privacy_level": privacy,
                    "disable_duet": False,
                    "disable_comment": False,
                    "disable_stitch": False,
                    "video_cover_timestamp_ms": 1000,
                },
                "source_info": source,
            },
        )

    err = init.get("error") or {}
    if err.get("code") not in (None, "", "ok"):
        raise SystemExit(f"init failed: {init}")
    data = init.get("data") or {}
    publish_id = data.get("publish_id")
    upload_url = data.get("upload_url")
    if not publish_id or not upload_url:
        raise SystemExit(f"init missing publish_id/upload_url: {init}")

    put_chunks(upload_url, video_path, chunk_size)
    status = poll_status(access, publish_id)
    status_data = status.get("data") or {}
    result = {
        "publishId": publish_id,
        "status": status_data.get("status"),
        "shareUrl": status_data.get("share_url") or status_data.get("publicaly_available_post_id"),
        "privacy": args.privacy,
        "inbox": bool(args.inbox),
    }
    print(json.dumps(result, indent=2))
    if str(status_data.get("status") or "") == "FAILED":
        raise SystemExit(f"TikTok publish failed: {status}")


if __name__ == "__main__":
    main()
