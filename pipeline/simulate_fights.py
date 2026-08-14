#!/usr/bin/env python3
"""
Headless fight simulation — no frames/audio, winner stats only.

Runs N trials as fast as Chrome can step the physics sim.

Usage:
    python pipeline/simulate_fights.py --mode weapon --trials 100 \\
        --matchup '[{"id":"_weapon","config":{"weaponId":"sword"}},{"id":"_weapon","config":{"weaponId":"laser"}}]'

    python pipeline/simulate_fights.py --payload /tmp/sim.json

Payload JSON:
    {
      "mode": "weapon",
      "matchup": [...],
      "trials": 100,
      "maxSeconds": 90
    }

Requires: playwright (pip install playwright), Google Chrome.
Server should be serving Arena/ (default http://127.0.0.1:8764).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parent.parent
DEFAULT_BASE_URL = "http://127.0.0.1:8764"
SIM_TIMEOUT_SEC = 120


def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: WPS433
    except ImportError as exc:
        raise RuntimeError(
            "playwright is required. Install with: "
            f"{sys.executable} -m pip install playwright"
        ) from exc
    return sync_playwright


def simulate_fights(
    *,
    mode: str,
    matchup: list,
    trials: int = 1,
    max_seconds: float = 90,
    base_url: str = DEFAULT_BASE_URL,
    include_fights: bool = False,
) -> dict:
    if mode not in {"collision", "weapon"}:
        raise ValueError("mode must be collision or weapon")
    if not isinstance(matchup, list) or len(matchup) < 2:
        raise ValueError("matchup must include at least 2 fighters")
    if trials < 1:
        raise ValueError("trials must be >= 1")

    sync_playwright = _require_playwright()
    payload = {
        "mode": mode,
        "matchup": matchup,
        "trials": int(trials),
        "maxSeconds": float(max_seconds),
        "includeFights": bool(include_fights),
    }
    url = f"{base_url.rstrip('/')}/pages/simulate.html"
    t0 = time.perf_counter()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--disable-dev-shm-usage", "--mute-audio"],
        )
        try:
            page = browser.new_page(viewport={"width": 400, "height": 400})
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_function(
                "() => window.FightSim && window.ArenaApp && window.ArenaApp.simulateFight",
                timeout=30_000,
            )
            result = page.evaluate(
                """async (payload) => {
                    return await window.FightSim.simulate(payload);
                }""",
                payload,
            )
        finally:
            browser.close()

    if not isinstance(result, dict):
        raise RuntimeError("FightSim.simulate returned no result")

    result["wallSec"] = round(time.perf_counter() - t0, 3)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Headless arena fight simulation")
    parser.add_argument("--mode", choices=("collision", "weapon"), default="weapon")
    parser.add_argument("--matchup", help="JSON array of matchup slots")
    parser.add_argument("--payload", type=Path, help="JSON file with mode/matchup/trials")
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--max-seconds", type=float, default=90)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--include-fights",
        action="store_true",
        help="Include per-trial results even when trials > 50",
    )
    args = parser.parse_args(argv)

    if args.payload:
        data = json.loads(args.payload.read_text())
        mode = data.get("mode") or args.mode
        matchup = data.get("matchup")
        trials = int(data.get("trials") or args.trials)
        max_seconds = float(data.get("maxSeconds") or args.max_seconds)
        include_fights = bool(data.get("includeFights") or args.include_fights)
    else:
        mode = args.mode
        trials = args.trials
        max_seconds = args.max_seconds
        include_fights = args.include_fights
        if not args.matchup:
            parser.error("--matchup or --payload required")
        matchup = json.loads(args.matchup)

    if not isinstance(matchup, list) or len(matchup) < 2:
        raise SystemExit("matchup must be a JSON array with at least 2 slots")

    try:
        result = simulate_fights(
            mode=mode,
            matchup=matchup,
            trials=trials,
            max_seconds=max_seconds,
            base_url=args.base_url,
            include_fights=include_fights,
        )
    except Exception as exc:  # noqa: BLE001 — CLI surfaces any failure as exit
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
