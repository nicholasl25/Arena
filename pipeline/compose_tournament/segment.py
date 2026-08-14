"""Build one narrated matchup segment."""
from __future__ import annotations

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import step_log as slog

from . import config
from .chapters import chapter_title_for, round_card
from .manifest import find_segment, load_manifest, save_manifest, segment_path_for
from . import media
from . import narration
from . import tts


def build_match_segment(
    *,
    match_key: str,
    script: str,
    pre_bracket: Path,
    arena: Path,
    post_bracket: Path,
    order_index: int,
    a_name: str | None = None,
    b_name: str | None = None,
    winner_name: str | None = None,
    force: bool = False,
    weapon_clip: Path | None = None,
    weapon_spins: dict | None = None,
    powerup_clip: Path | None = None,
    powerup_spins: dict | None = None,
    title_clip: Path | None = None,
    bracket_pre: dict | None = None,
    active_match: dict | None = None,
) -> dict:
    """
    Build one narrated matchup segment. Idempotent: existing done segment is reused.
    """
    config.ensure_dirs()
    manifest = load_manifest()
    existing = find_segment(manifest, match_key)
    out = segment_path_for(match_key)
    if (
        not force
        and existing
        and existing.get("status") == "done"
        and out.is_file()
    ):
        slog.log(f"narrate: reuse {out.name}")
        return {"created": False, "segment": existing, "manifest": manifest}

    card = round_card(bracket_pre, active_match, match_key=match_key)
    chapter_title = chapter_title_for(
        bracket_pre, active_match, a_name, b_name, match_key=match_key
    )
    title_path = Path(title_clip) if title_clip else None
    if title_path is None or not title_path.is_file():
        title_path = config.CLIPS_DIR / f"{config.safe_segment_id(match_key)}-title.mp4"
        media.make_title_card_clip(
            title_path,
            heading=card["heading"],
            detail=card["detail"],
        )
        media.mix_music_bed(title_path)
    entry = {
        "matchKey": match_key,
        "order": int(order_index),
        "aName": a_name,
        "bName": b_name,
        "winnerName": winner_name,
        "script": script,
        "chapterTitle": chapter_title,
        "roundLabel": card["roundLabel"],
        "parts": [
            {"kind": "title-card", "file": str(title_path)},
            {"kind": "bracket-pre", "file": str(pre_bracket)},
            *(
                [{"kind": "weapon-spin", "file": str(weapon_clip)}]
                if weapon_clip
                else []
            ),
            *(
                [{"kind": "powerup-spin", "file": str(powerup_clip)}]
                if powerup_clip
                else []
            ),
            {"kind": "arena", "file": str(arena)},
            {"kind": "bracket-post", "file": str(post_bracket)},
        ],
        "narration": {
            "script": script,
            "scope": "combined-segment",
            "mix": "overlay",
            "loop": False,
            "outcomeAt": "post-bracket",
        },
        "file": out.name,
        "path": str(out),
        "status": "building",
        "error": None,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    # Replace or append placeholder while building.
    segs = [s for s in (manifest.get("segments") or []) if s.get("matchKey") != match_key]
    segs.append(entry)
    segs.sort(key=lambda s: (s.get("order", 0), s.get("matchKey") or ""))
    manifest["segments"] = segs
    manifest["status"] = "building-segment"
    manifest["error"] = None
    # Invalidate final if rebuilding a segment.
    if manifest.get("final"):
        old = config.RECORDINGS / "composed" / Path(manifest["final"]).name
        if old.is_file() and old.name == config.FINAL_NAME:
            old.unlink(missing_ok=True)
        manifest["final"] = None
    save_manifest(manifest)

    try:
        with tempfile.TemporaryDirectory(prefix="tour-seg-") as tmp:
            tmp_dir = Path(tmp)
            silent = tmp_dir / "body.mp4"
            body_clips = [title_path, pre_bracket]
            if weapon_clip:
                body_clips.append(weapon_clip)
            if powerup_clip:
                body_clips.append(powerup_clip)
            body_clips.extend([arena, post_bracket])
            slog.log(f"narrate: concat {len(body_clips)} parts for {out.name}")
            media.concat_videos(body_clips, silent)
            parsed = narration.parse_match_narration(script)
            opening = parsed["opening"]
            outcome = parsed["outcome"]
            opening_path = tmp_dir / "opening.mp3"
            slog.log("narrate: tts opening")
            asyncio.run(tts.synthesize_script(opening or script, opening_path))
            title_dur = config.TITLE_CARD_SEC
            extra_cues: list[tuple[Path, float]] = []
            if parsed["announces"]:
                pre_dur = media.media_duration(pre_bracket)
                ats: list[float] = []
                if weapon_spins and weapon_clip:
                    ats.extend(
                        narration.announce_at_secs(
                            pre_dur,
                            weapon_spins,
                            2,
                            offset=title_dur,
                        )
                    )
                weapon_dur = media.media_duration(weapon_clip) if weapon_clip else 0.0
                if powerup_spins and powerup_clip:
                    ats.extend(
                        narration.announce_at_secs(
                            pre_dur + weapon_dur,
                            powerup_spins,
                            2,
                            offset=title_dur,
                        )
                    )
                if not ats:
                    ats = narration.announce_at_secs(
                        pre_dur,
                        powerup_spins or weapon_spins,
                        len(parsed["announces"]),
                        offset=title_dur,
                    )
                for i, (line, at) in enumerate(
                    zip(parsed["announces"], ats[: len(parsed["announces"])])
                ):
                    announce_path = tmp_dir / f"announce{i}.mp3"
                    slog.log(f"narrate: tts spin {i + 1}")
                    asyncio.run(tts.synthesize_script(line, announce_path))
                    extra_cues.append((announce_path, at))
            outcome_path = None
            outcome_at = 0.0
            if outcome:
                outcome_path = tmp_dir / "outcome.mp3"
                slog.log("narrate: tts outcome")
                asyncio.run(tts.synthesize_script(outcome, outcome_path))
                # Reveal the winner once the fight clip ends (start of post-bracket).
                outcome_at = title_dur + media.media_duration(pre_bracket)
                if weapon_clip:
                    outcome_at += media.media_duration(weapon_clip)
                if powerup_clip:
                    outcome_at += media.media_duration(powerup_clip)
                outcome_at += media.media_duration(arena)
            entry["narration"]["opening"] = opening or script
            entry["narration"]["announces"] = parsed["announces"] or None
            entry["narration"]["outcome"] = outcome or None
            entry["narration"]["outcomeAtSec"] = round(outcome_at, 3)
            slog.log("narrate: mix voiceover onto segment")
            media.mix_segment_narration(
                silent,
                opening_mp3=opening_path,
                outcome_mp3=outcome_path,
                outcome_at=outcome_at,
                extra_cues=extra_cues,
                opening_at=title_dur,
                out_path=out,
            )
        entry["status"] = "done"
        entry["duration"] = round(media.media_duration(out), 3)
        entry["error"] = None
        slog.log(f"narrate: done {out.name} ({entry['duration']}s)")
    except Exception as exc:  # noqa: BLE001
        slog.log(f"narrate: failed {match_key}: {exc}", "ERROR")
        entry["status"] = "error"
        entry["error"] = str(exc)
        manifest["status"] = "error"
        manifest["error"] = f"segment {match_key}: {exc}"
        # keep entry
        segs = [s for s in manifest["segments"] if s.get("matchKey") != match_key]
        segs.append(entry)
        segs.sort(key=lambda s: (s.get("order", 0), s.get("matchKey") or ""))
        manifest["segments"] = segs
        save_manifest(manifest)
        raise

    segs = [s for s in manifest["segments"] if s.get("matchKey") != match_key]
    segs.append(entry)
    segs.sort(key=lambda s: (s.get("order", 0), s.get("matchKey") or ""))
    manifest["segments"] = segs
    manifest["status"] = "segments-ready" if all(
        s.get("status") == "done" for s in segs
    ) else "building-segment"
    save_manifest(manifest)
    return {"created": True, "segment": entry, "manifest": manifest}
