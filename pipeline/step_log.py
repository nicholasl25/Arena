"""Timestamped STEP/ERROR/DONE lines for the long-video pipeline.

Prints to stderr so offline_record can keep JSON on stdout.
Also writes progress.json for the workflow UI poll.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parent.parent
PROGRESS_PATH = ARENA_DIR / "recordings" / "composed" / "tournament" / "progress.json"

_t0 = time.perf_counter()


def log(msg: str, kind: str = "STEP") -> None:
    elapsed = time.perf_counter() - _t0
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"{ts}  +{elapsed:.1f}s  {kind}  {msg}"
    print(line, file=sys.stderr, flush=True)
    payload = {
        "kind": kind,
        "message": msg,
        "at": datetime.now(timezone.utc).isoformat(),
        "elapsedSec": round(elapsed, 1),
    }
    try:
        PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
        PROGRESS_PATH.write_text(json.dumps(payload) + "\n")
    except OSError:
        pass


def read_progress() -> dict | None:
    if not PROGRESS_PATH.is_file():
        return None
    try:
        data = json.loads(PROGRESS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def clear_progress() -> None:
    PROGRESS_PATH.unlink(missing_ok=True)
