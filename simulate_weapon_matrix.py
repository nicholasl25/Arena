#!/usr/bin/env python3
"""
Simulate every weapon-vs-weapon pair, then rank weapons by overall win rate.

Edit WEAPONS / TRIALS_PER_PAIR below, then run (server must be up on :8764):

    ./venv/bin/python simulate_weapon_matrix.py

Output CSV columns: rank, weapon, win_pct, net, wins, losses, trials, opponents
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from collections import defaultdict
from itertools import combinations
from pathlib import Path

FUN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(FUN_DIR / "pipeline"))

from simulate_fights import DEFAULT_BASE_URL, _require_playwright  # noqa: E402

# ---------------------------------------------------------------------------
# Edit these
# ---------------------------------------------------------------------------
WEAPONS = [
    "sword",
    "dagger",
    "spikes",
    "slingshot",
    "bow",
    "hammer",
    "fists",
    "laser",
    "staff",
    "shield",
    "webs",
    "boomerang",
    "thunderrod",
    "witch",
]

TRIALS_PER_PAIR = 10
MAX_SECONDS = 90
DEFAULT_OUT = FUN_DIR / "weapon-matrix.csv"
# ---------------------------------------------------------------------------

RANK_FIELDS = [
    "rank",
    "weapon",
    "win_pct",
    "net",
    "wins",
    "losses",
    "trials",
    "opponents",
]


def matchup_for(weapon_a: str, weapon_b: str) -> list[dict]:
    return [
        {"id": "_weapon", "config": {"weaponId": weapon_a}},
        {"id": "_weapon", "config": {"weaponId": weapon_b}},
    ]


def wins_for(result: dict, weapon_id: str) -> int:
    for row in result.get("standings") or []:
        key = row.get("key") or ""
        if key.endswith(f":{weapon_id}") or key == weapon_id:
            return int(row.get("wins") or 0)
        if row.get("label", "").lower() == weapon_id.lower():
            return int(row.get("wins") or 0)
    wins = 0
    for fight in result.get("fights") or []:
        w = fight.get("winner") or {}
        if w.get("weaponId") == weapon_id:
            wins += 1
    return wins


def rank_from_pair_rows(pair_rows: list[dict]) -> list[dict]:
    """Aggregate pairwise results into a ranked standings table."""
    wins: dict[str, int] = defaultdict(int)
    losses: dict[str, int] = defaultdict(int)
    trials: dict[str, int] = defaultdict(int)
    opponents: dict[str, int] = defaultdict(int)

    for row in pair_rows:
        a, b = row["weapon_a"], row["weapon_b"]
        wa, wb = int(row["wins_a"]), int(row["wins_b"])
        n = int(row["trials"])
        wins[a] += wa
        wins[b] += wb
        losses[a] += wb
        losses[b] += wa
        trials[a] += n
        trials[b] += n
        opponents[a] += 1
        opponents[b] += 1

    ranked = []
    for weapon in trials:
        w_in = wins[weapon]
        w_out = losses[weapon]
        decisive = w_in + w_out
        win_pct = (w_in / decisive) if decisive else 0.0
        net = ((w_in - w_out) / trials[weapon]) if trials[weapon] else 0.0
        ranked.append({
            "weapon": weapon,
            "win_pct": round(win_pct * 100, 1),
            "net": round(net, 3),
            "wins": w_in,
            "losses": w_out,
            "trials": trials[weapon],
            "opponents": opponents[weapon],
        })

    ranked.sort(key=lambda r: (-r["win_pct"], -r["net"], -r["wins"], r["weapon"]))
    for i, row in enumerate(ranked, start=1):
        row["rank"] = i
    return ranked


def write_rankings(path: Path, rankings: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=RANK_FIELDS)
        writer.writeheader()
        writer.writerows(rankings)


def print_rankings(rankings: list[dict]) -> None:
    print(
        f"{'rank':<5}{'weapon':<12}{'win%':>8}{'net':>8}"
        f"{'W':>5}{'L':>5}{'trials':>8}{'opps':>6}",
        flush=True,
    )
    for row in rankings:
        print(
            f"{row['rank']:<5}{row['weapon']:<12}"
            f"{row['win_pct']:7.1f}%{row['net']:+7.3f}"
            f"{row['wins']:5}{row['losses']:5}"
            f"{row['trials']:8}{row['opponents']:6}",
            flush=True,
        )


def run_matrix(
    *,
    weapons: list[str],
    trials: int,
    max_seconds: float,
    base_url: str,
    out_path: Path,
) -> Path:
    if len(weapons) < 2:
        raise SystemExit("WEAPONS needs at least 2 entries")

    pairs = list(combinations(weapons, 2))
    sync_playwright = _require_playwright()
    url = f"{base_url.rstrip('/')}/pages/simulate.html"

    pair_rows: list[dict] = []
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

            for i, (a, b) in enumerate(pairs, start=1):
                print(f"[{i}/{len(pairs)}] {a} vs {b} ({trials} trials)...", flush=True)
                payload = {
                    "mode": "weapon",
                    "matchup": matchup_for(a, b),
                    "trials": trials,
                    "maxSeconds": max_seconds,
                    "includeFights": True,
                }
                result = page.evaluate(
                    """async (payload) => {
                        return await window.FightSim.simulate(payload);
                    }""",
                    payload,
                )
                if not isinstance(result, dict):
                    raise RuntimeError(f"No result for {a} vs {b}")

                wins_a = wins_for(result, a)
                wins_b = wins_for(result, b)
                draws = int(result.get("draws") or 0)
                timeouts = int(result.get("timeouts") or 0)
                elapsed_ms = int(result.get("elapsedMs") or 0)

                pair_rows.append({
                    "weapon_a": a,
                    "weapon_b": b,
                    "trials": trials,
                    "wins_a": wins_a,
                    "wins_b": wins_b,
                    "draws": draws,
                    "timeouts": timeouts,
                })
                print(
                    f"    {a} {wins_a}-{wins_b} {b}"
                    f"  (draws={draws}, timeouts={timeouts}, {elapsed_ms}ms)",
                    flush=True,
                )
        finally:
            browser.close()

    rankings = rank_from_pair_rows(pair_rows)
    write_rankings(out_path, rankings)
    print(flush=True)
    print_rankings(rankings)

    wall = time.perf_counter() - t0
    print(f"\nWrote rankings → {out_path}  ({wall:.1f}s wall)", flush=True)
    return out_path


def rank_existing_pairs_csv(pairs_path: Path, out_path: Path) -> Path:
    with pairs_path.open() as f:
        pair_rows = list(csv.DictReader(f))
    if not pair_rows:
        raise SystemExit(f"No rows in {pairs_path}")
    # Old pair CSVs use wins_a/wins_b; reject ranking-format files.
    if "wins_a" not in pair_rows[0]:
        raise SystemExit(
            f"{pairs_path} does not look like a pairwise results CSV "
            "(expected wins_a / wins_b columns)"
        )
    rankings = rank_from_pair_rows(pair_rows)
    write_rankings(out_path, rankings)
    print_rankings(rankings)
    print(f"\nWrote rankings → {out_path}", flush=True)
    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Weapon pair sims → ranked win-rate CSV",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--trials", type=int, default=TRIALS_PER_PAIR)
    parser.add_argument("--max-seconds", type=float, default=MAX_SECONDS)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--weapons",
        help="Comma-separated override for WEAPONS list in the script",
    )
    parser.add_argument(
        "--from-pairs",
        type=Path,
        help="Skip sims; rank an existing pairwise CSV instead",
    )
    args = parser.parse_args(argv)

    if args.from_pairs:
        rank_existing_pairs_csv(args.from_pairs, args.out)
        return 0

    weapons = (
        [w.strip() for w in args.weapons.split(",") if w.strip()]
        if args.weapons
        else list(WEAPONS)
    )

    run_matrix(
        weapons=weapons,
        trials=args.trials,
        max_seconds=args.max_seconds,
        base_url=args.base_url,
        out_path=args.out,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
