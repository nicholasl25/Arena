#!/usr/bin/env python3
"""Record a 4-fighter tournament and stitch tournament-final.mp4.

Advances the bracket from the recorded arena winner (not a demo pick).

    python3 tests/generate_full_video.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

FUN_DIR = Path(__file__).resolve().parents[1]
PIPELINE_DIR = FUN_DIR / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

import compose_tournament as ct  # noqa: E402
import tournament_record as tr  # noqa: E402

STARTED = time.time()
BASE_URL = "http://127.0.0.1:8764"
PLANNER = FUN_DIR / "tests" / "generate_full_video.js"


def log(kind: str, msg: str) -> None:
    elapsed = time.time() - STARTED
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}  +{elapsed:.1f}s  {kind}  {msg}", flush=True)


def node(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(PLANNER), *args],
        check=check,
    )


def main() -> int:
    state_path = FUN_DIR / "tests" / "_full_video_state.json"
    match_path = FUN_DIR / "tests" / "_full_video_match.json"
    log("STEP", "init bracket")
    node("init", str(state_path))

    log("STEP", "clearing previous tournament media")
    ct.clear_tournament_media()

    match_keys = []
    while True:
        nxt = node("next", str(state_path), str(match_path), check=False)
        if nxt.returncode == 2:
            break
        if nxt.returncode != 0:
            raise RuntimeError("planner next failed")
        req = json.loads(match_path.read_text())
        key = req["matchKey"]
        match_keys.append(key)
        log("STEP", f"match {req['order'] + 1} {req['aName']} vs {req['bName']} · {req.get('spinSummary')}")
        result = tr.ensure_match_segment_media(
            match_key=key,
            script=req["script"],
            order_index=int(req["order"]),
            mode=req.get("mode") or "weapon",
            matchup=req["matchup"],
            a_name=req.get("aName"),
            b_name=req.get("bName"),
            winner_name=req.get("winnerName"),
            loser_name=req.get("loserName"),
            base_url=BASE_URL,
            force=True,
            synthetic_arena=False,
            bracket_pre=req.get("bracketPre"),
            bracket_post=req.get("bracketPost"),
            active_match=req.get("activeMatch"),
            last_winner=req.get("lastWinner"),
            last_loser=req.get("lastLoser"),
            powerup_spins=req.get("powerupSpins"),
        )
        winner = result.get("winnerName") or (result.get("arena") or {}).get("winner")
        if not winner:
            raise RuntimeError(f"arena produced no winner for {key}")
        seg = result.get("segment") or {}
        log("STEP", f"segment done → {seg.get('file')} ({seg.get('duration')}s) winner={winner}")
        node("apply", str(state_path), str(winner))

    bag = json.loads(state_path.read_text())
    champion = bag.get("championName") or (bag.get("state") or {}).get("champion", {}).get("name")
    if not champion:
        raise RuntimeError("bracket did not produce a champion")
    log("STEP", f"champion outro + stitch · {champion}")
    fighters = ((bag.get("state") or {}).get("fighters") or [])
    names = [
        f.get("name")
        for f in fighters
        if isinstance(f, dict) and f.get("name")
    ]
    intro_title = ct.build_intro_title(names, weapon_mode=True, entrant_count=len(names))
    intro = ct.ensure_intro_clip(
        names,
        powerup_spin=True,
        title=intro_title,
        fighters=fighters,
        champion_name=champion,
        base_url=BASE_URL,
        weapon_mode=False,
    )
    outro = ct.ensure_outro_clip(
        champion,
        title=intro_title,
        fighters=fighters,
        weapon_mode=False,
        base_url=BASE_URL,
    )
    stitched = ct.stitch_final(
        intro_clip=intro,
        champion_clip=outro,
        champion_name=champion,
        force=True,
        expected_count=len(match_keys),
        match_keys=match_keys,
    )
    path = Path(stitched.get("path") or ct.FINAL_PATH)
    size = path.stat().st_size if path.is_file() else 0
    log("DONE", f"final={stitched.get('final')} bytes={size} segments={stitched.get('segmentCount')} path={path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        log("ERROR", str(exc))
        raise
