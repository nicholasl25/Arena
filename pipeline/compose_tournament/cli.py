"""CLI entry for tournament compose."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import config
from .manifest import clear_tournament_media, status_payload
from .media import make_color_clip
from .segment import build_match_segment
from .stitch import stitch_final


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tournament long-form compose")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_seg = sub.add_parser("segment", help="Build one match segment from three clips")
    p_seg.add_argument("--match-key", required=True)
    p_seg.add_argument("--script", required=True)
    p_seg.add_argument("--pre", type=Path, required=True)
    p_seg.add_argument("--arena", type=Path, required=True)
    p_seg.add_argument("--post", type=Path, required=True)
    p_seg.add_argument("--order", type=int, default=0)
    p_seg.add_argument("--a-name", default=None)
    p_seg.add_argument("--b-name", default=None)
    p_seg.add_argument("--winner", default=None)
    p_seg.add_argument("--force", action="store_true")

    p_stitch = sub.add_parser("stitch", help="Stitch all segments into final")
    p_stitch.add_argument("--champion", type=Path, default=None)
    p_stitch.add_argument("--intro", type=Path, default=None)
    p_stitch.add_argument("--champion-name", default=None)
    p_stitch.add_argument("--expected", type=int, default=None)
    p_stitch.add_argument("--match-key", action="append", dest="match_keys")
    p_stitch.add_argument("--force", action="store_true")

    sub.add_parser("status", help="Print tournament media status")
    sub.add_parser("clear", help="Clear tournament media artifacts")

    p_fixture = sub.add_parser("fixture-smoke", help="Synthetic ffmpeg smoke test")
    p_fixture.add_argument("--matches", type=int, default=2)

    args = parser.parse_args(argv)

    if args.cmd == "segment":
        result = build_match_segment(
            match_key=args.match_key,
            script=args.script,
            pre_bracket=args.pre,
            arena=args.arena,
            post_bracket=args.post,
            order_index=args.order,
            a_name=args.a_name,
            b_name=args.b_name,
            winner_name=args.winner,
            force=args.force,
        )
        print(json.dumps(result, indent=2))
        return 0

    if args.cmd == "stitch":
        result = stitch_final(
            intro_clip=args.intro,
            champion_clip=args.champion,
            champion_name=args.champion_name,
            force=args.force,
            expected_count=args.expected,
            match_keys=args.match_keys,
        )
        print(json.dumps(result, indent=2))
        return 0

    if args.cmd == "status":
        print(json.dumps(status_payload(), indent=2))
        return 0

    if args.cmd == "clear":
        clear_tournament_media()
        print(json.dumps({"ok": True}))
        return 0

    if args.cmd == "fixture-smoke":
        clear_tournament_media()
        config.ensure_dirs()
        n = max(1, int(args.matches))
        for i in range(n):
            key = f"r0m{i}|slot-{i * 2}|slot-{i * 2 + 1}"
            pre = config.CLIPS_DIR / f"pre-{i}.mp4"
            arena = config.CLIPS_DIR / f"arena-{i}.mp4"
            post = config.CLIPS_DIR / f"post-{i}.mp4"
            make_color_clip(pre, duration=0.4, color="0xdbeafe", label=f"PRE {i + 1}")
            make_color_clip(arena, duration=0.6, color="0xfef3c7", label=f"ARENA {i + 1}")
            make_color_clip(post, duration=0.4, color="0xdcfce7", label=f"POST {i + 1}")
            build_match_segment(
                match_key=key,
                script=f"Alpha{i} vs. Beta{i} — who will win?\n\nAlpha{i} wins",
                pre_bracket=pre,
                arena=arena,
                post_bracket=post,
                order_index=i,
                a_name=f"Alpha{i}",
                b_name=f"Beta{i}",
                winner_name=f"Alpha{i}",
                force=True,
            )
        champ = config.CLIPS_DIR / "champion.mp4"
        make_color_clip(champ, duration=0.5, color="0xf0fdf4", label="CHAMPION")
        result = stitch_final(champion_clip=champ, force=True, expected_count=n)
        # Idempotent second stitch
        again = stitch_final(force=False, expected_count=n)
        print(json.dumps({
            "ok": True,
            "ffmpeg": True,
            "final": result["final"],
            "createdFirst": result["created"],
            "createdSecond": again["created"],
            "duration": result.get("duration"),
            "segments": n,
        }, indent=2))
        return 0

    return 1


def run(argv: list[str] | None = None) -> int:
    return main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
