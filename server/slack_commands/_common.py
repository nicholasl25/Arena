"""Shared helpers for Slack slash command modules."""

from __future__ import annotations

import json
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


def field_value(values: dict | None, block_id: str) -> str | None:
    if not values:
        return None
    block = values.get(block_id) or {}
    if not isinstance(block, dict) or not block:
        return None
    entry = block.get("value")
    if not isinstance(entry, dict):
        entry = next((v for v in block.values() if isinstance(v, dict)), {}) or {}
    if "selected_option" in entry:
        opt = entry.get("selected_option") or {}
        return opt.get("value")
    return entry.get("value")


def caption_modal(
    *,
    callback_id: str,
    metadata: dict,
    title: str,
    description: str,
    heading: str = "Post to YouTube",
) -> dict:
    """Title + caption form shown before a YouTube upload."""
    return {
        "type": "modal",
        "callback_id": callback_id,
        "private_metadata": json.dumps(metadata),
        "title": {"type": "plain_text", "text": heading[:24]},
        "submit": {"type": "plain_text", "text": "Post"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": [
            {
                "type": "input",
                "block_id": "title",
                "label": {"type": "plain_text", "text": "Title"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "value",
                    "max_length": 100,
                    "initial_value": (title or "")[:100],
                },
            },
            {
                "type": "input",
                "block_id": "caption",
                "optional": True,
                "label": {"type": "plain_text", "text": "Caption"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "value",
                    "multiline": True,
                    "max_length": 3000,
                    "initial_value": (description or "")[:3000],
                },
            },
        ],
    }
