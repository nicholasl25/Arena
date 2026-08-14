"""Shared helpers for Slack slash command modules."""

from __future__ import annotations

import threading
import traceback


def resolve_channel(client, body: dict) -> str:
    """Channel id for replies; opens a DM when the command has no channel."""
    channel = body.get("channel_id") or body.get("user_id") or ""
    if str(channel).startswith("U"):
        im = client.conversations_open(users=channel)
        return im["channel"]["id"]
    return channel


def reply(client, body: dict, text: str) -> None:
    user = body.get("user_id") or ""
    try:
        ch = resolve_channel(client, body)
        client.chat_postMessage(
            channel=ch,
            text=f"<@{user}> {text}" if user else text,
        )
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def run_async(fn) -> None:
    threading.Thread(target=fn, daemon=True).start()
