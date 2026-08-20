"""Entrypoint: ensure stages, optional Slack bot, serve workflow UI."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .config import ARENA_DIR, PORT
from .handler import QuietThreadingHTTPServer, WorkflowHandler
from .pipeline_ops import ensure_stages


def _start_slack_bot_thread() -> None:
    """Start Slack Socket Mode bot when tokens are present in server/.env."""
    try:
        from slack_bot import start_slack_bot_background  # noqa: WPS433
    except ImportError as exc:
        print(f"Slack bot skipped (import): {exc}", file=sys.stderr)
        return
    start_slack_bot_background()


def main() -> None:
    # Prefer Arena/venv site-packages. On Homebrew, venv/bin/python resolves to the
    # same binary as system python3 — compare sys.prefix, not resolved executable.
    venv_dir = ARENA_DIR / "venv"
    venv_python = venv_dir / "bin" / "python"
    if venv_python.is_file() and Path(sys.prefix).resolve() != venv_dir.resolve():
        os.execv(str(venv_python), [str(venv_python), *sys.argv])

    ensure_stages()
    _start_slack_bot_thread()
    server = QuietThreadingHTTPServer(("127.0.0.1", PORT), WorkflowHandler)
    print(f"Workflow server → http://127.0.0.1:{PORT}/pages/workflow.html", file=sys.stderr)
    print(f"  Shorts        → http://127.0.0.1:{PORT}/pages/workflow.html", file=sys.stderr)
    print(f"  Long YouTube  → http://127.0.0.1:{PORT}/pages/workflow.html?wf=long", file=sys.stderr)
    print(f"Arena (shorts) → http://127.0.0.1:{PORT}/pages/index.html", file=sys.stderr)
    print(f"Arena (computer)→ http://127.0.0.1:{PORT}/pages/index.html?view=computer", file=sys.stderr)
    print(f"Powerup wheel  → http://127.0.0.1:{PORT}/pages/wheel.html", file=sys.stderr)
    print(
        "Slack: /short /short-pick /add-skin /long /retry /quota /arena-status "
        "/cancel /skins /weapons /random-short — tokens in server/.env",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
