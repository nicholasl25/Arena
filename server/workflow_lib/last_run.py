"""Persist the most recent Slack /short or /long so /retry can re-run it."""
from __future__ import annotations

import json
import time
from typing import Any

from .config import LAST_RUN_PATH

_KINDS = frozenset({"short", "long", "random-short"})


def save_last_run(
    *,
    kind: str,
    label: str,
    payload: dict[str, Any],
    user: str | None = None,
    channel: str | None = None,
) -> dict:
    if kind not in _KINDS:
        raise ValueError(f"kind must be one of {sorted(_KINDS)}")
    if not isinstance(payload, dict):
        raise ValueError("payload must be a dict")
    data = {
        "kind": kind,
        "label": str(label or kind),
        "payload": payload,
        "user": user,
        "channel": channel,
        "savedAt": time.time(),
        "status": "pending",
        "error": None,
        "errorCount": 0,
    }
    LAST_RUN_PATH.write_text(json.dumps(data, indent=2) + "\n")
    return data


def load_last_run() -> dict | None:
    if not LAST_RUN_PATH.is_file():
        return None
    try:
        data = json.loads(LAST_RUN_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("kind") not in _KINDS:
        return None
    if not isinstance(data.get("payload"), dict):
        return None
    return data


def mark_last_run_ok() -> dict | None:
    data = load_last_run()
    if not data:
        return None
    data["status"] = "ok"
    data["error"] = None
    data["finishedAt"] = time.time()
    LAST_RUN_PATH.write_text(json.dumps(data, indent=2) + "\n")
    return data


def mark_last_run_failed(exc: BaseException | str) -> dict | None:
    data = load_last_run()
    if not data:
        return None
    data["status"] = "failed"
    data["error"] = str(exc)[:500]
    data["errorCount"] = int(data.get("errorCount") or 0) + 1
    data["failedAt"] = time.time()
    LAST_RUN_PATH.write_text(json.dumps(data, indent=2) + "\n")
    return data
