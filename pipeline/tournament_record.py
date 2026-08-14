#!/usr/bin/env python3
"""
Build tournament match clips: real bracket frames + arena fight via offline_record.

Bracket visuals are rendered through pages/offline-bracket.html (same canvas as the live preview).
Arena fights reuse the fullscreen computer layout from pipeline/offline_record.py.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parent.parent
PIPELINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_DIR))

import compose_tournament as ct  # noqa: E402
import step_log as slog  # noqa: E402

BRACKET_PRE_SEC = 2.5
BRACKET_HOLD_SEC = 2.2
CHAMPION_SEC = 2.6
BRACKET_ADVANCE_MS = 850
POWERUP_FPS = 30
BRACKET_DURATION = BRACKET_PRE_SEC  # back-compat alias


def make_bracket_clip(path: Path, label: str, duration: float = BRACKET_PRE_SEC, color: str = "0xece8e1") -> Path:
    clip = ct.make_color_clip(path, duration=duration, color=color, label=label)
    ct.mix_music_bed(clip)
    return clip


def _encode_still_loop(ffmpeg_bin: str, png_path: Path, out_path: Path, duration: float) -> Path:
    subprocess.check_call(
        [
            ffmpeg_bin,
            "-y",
            "-loop",
            "1",
            "-i",
            str(png_path),
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t",
            str(max(0.4, float(duration))),
            "-vf",
            f"scale={ct.WIDTH}:{ct.HEIGHT}:flags=lanczos,fps={ct.FPS},setsar=1",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(out_path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return out_path


def _encode_png_sequence(
    ffmpeg_bin: str,
    pattern: Path,
    out_path: Path,
    *,
    fps: int,
    audio_path: Path | None = None,
) -> Path:
    cmd = [
        ffmpeg_bin,
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(pattern),
    ]
    if audio_path:
        cmd += ["-i", str(audio_path)]
    else:
        cmd += [
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
        ]
    cmd += [
        "-vf",
        f"scale={ct.WIDTH}:{ct.HEIGHT}:flags=lanczos,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_path


def _match_in_state(state: dict | None, match: dict | None) -> dict | None:
    if not isinstance(match, dict):
        return None
    if not isinstance(state, dict):
        return match
    mid = match.get("id")
    if not mid:
        return match
    for rnd in state.get("rounds") or []:
        for item in rnd or []:
            if isinstance(item, dict) and item.get("id") == mid:
                return item
    return match


def _arena_python() -> str:
    python = ARENA_DIR / "venv" / "bin" / "python"
    return str(python if python.is_file() else Path(sys.executable))


def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: WPS433
        return sync_playwright
    except ImportError:
        pass
    # workflow_server often runs on system Python; Playwright lives in Arena/venv.
    venv = ARENA_DIR / "venv"
    for pattern in ("lib/python*/site-packages", "lib/site-packages"):
        for path in venv.glob(pattern):
            if str(path) not in sys.path:
                sys.path.insert(0, str(path))
    try:
        from playwright.sync_api import sync_playwright  # noqa: WPS433
        return sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "playwright is required. Install with: "
            f"{_arena_python()} -m pip install playwright"
        ) from exc


def record_bracket_clip(
    *,
    state: dict,
    phase: str,
    out_path: Path,
    base_url: str,
    duration: float | None = None,
    active_match: dict | None = None,
    last_winner: dict | None = None,
    last_loser: dict | None = None,
    title_out: Path | None = None,
    title: dict | None = None,
) -> Path:
    """Render bracket canvas frames. Post includes the winner-advance motion."""
    if not isinstance(state, dict) or not state.get("rounds"):
        raise ValueError("bracket state with rounds required")
    if phase == "champion":
        tag = "champion"
        hold_sec = CHAMPION_SEC if duration is None else float(duration)
        motion_ms = 0
    elif phase == "post":
        tag = "post"
        hold_sec = BRACKET_HOLD_SEC if duration is None else float(duration)
        motion_ms = BRACKET_ADVANCE_MS
    else:
        tag = "pre"
        hold_sec = BRACKET_PRE_SEC if duration is None else float(duration)
        motion_ms = 0
    slog.log(f"bracket-{tag}: open chrome {out_path.name}")
    sync_playwright = _require_playwright()
    ffmpeg_bin = ct._require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    advance_from = _match_in_state(state, active_match) if phase == "post" else None
    payload = {
        "phase": phase if phase in {"pre", "post", "champion"} else "pre",
        "state": state,
        "activeMatch": active_match,
        "lastWinner": last_winner or (state.get("champion") if phase == "champion" else None),
        "lastLoser": last_loser,
        "advanceFrom": advance_from,
        "motionMs": motion_ms,
        "holdMs": int(round(hold_sec * 1000)),
    }
    url = f"{base_url.rstrip('/')}/pages/offline-bracket.html"
    motion_frames = max(0, int(round((motion_ms / 1000) * ct.FPS))) if motion_ms else 0
    hold_b64 = None
    with tempfile.TemporaryDirectory(prefix="tour-bracket-") as tmp:
        tmp_dir = Path(tmp)
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel="chrome",
                headless=True,
                args=["--disable-dev-shm-usage", "--mute-audio"],
            )
            try:
                page = browser.new_page(
                    viewport={"width": ct.WIDTH, "height": ct.HEIGHT},
                    device_scale_factor=2,
                )
                page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_function(
                    "() => window.OfflineBracket && window.WorkflowBracketPreview"
                    " && window.WorkflowBracket",
                    timeout=30_000,
                )
                info = page.evaluate(
                    """async (payload) => {
                        return await window.OfflineBracket.prepare(payload);
                    }""",
                    payload,
                )
                if not info:
                    raise RuntimeError("OfflineBracket.prepare failed")
                if title_out and title:
                    title_b64 = page.evaluate(
                        "(card) => window.OfflineBracket.renderTitlePngBase64(card)",
                        {
                            "heading": title.get("heading") or "MATCH",
                            "detail": title.get("detail") or "",
                        },
                    )
                    if not isinstance(title_b64, str) or not title_b64:
                        raise RuntimeError("OfflineBracket produced no title PNG")
                    title_png = tmp_dir / "title.png"
                    title_png.write_bytes(base64.b64decode(title_b64))
                    title_out.parent.mkdir(parents=True, exist_ok=True)
                    _encode_still_loop(
                        ffmpeg_bin, title_png, title_out, ct.TITLE_CARD_SEC
                    )
                    ct.mix_music_bed(title_out)
                    slog.log(f"bracket-title: done {title_out.name}")
                if motion_frames > 0:
                    slog.log(f"bracket-{tag}: render {motion_frames} advance frames")
                    last_progress = 0.0
                    t_frames = time.perf_counter()
                    for i in range(motion_frames):
                        elapsed = i * 1000 / ct.FPS
                        now = time.perf_counter()
                        if i == 0 or i + 1 == motion_frames or now - last_progress >= 2.0:
                            last_progress = now
                            slog.log(
                                f"bracket-{tag}: frame {i + 1}/{motion_frames} "
                                f"({now - t_frames:.0f}s)"
                            )
                        png_b64 = page.evaluate(
                            "(elapsed) => window.OfflineBracket.renderPngBase64(elapsed)",
                            elapsed,
                        )
                        if not isinstance(png_b64, str) or not png_b64:
                            raise RuntimeError("OfflineBracket produced no PNG")
                        (tmp_dir / f"frame_{i:04d}.png").write_bytes(base64.b64decode(png_b64))
                    hold_b64 = page.evaluate(
                        "(elapsed) => window.OfflineBracket.renderPngBase64(elapsed)",
                        float(motion_ms),
                    )
                else:
                    hold_b64 = page.evaluate(
                        "(elapsed) => window.OfflineBracket.renderPngBase64(elapsed)",
                        0,
                    )
                if not isinstance(hold_b64, str) or not hold_b64:
                    raise RuntimeError("OfflineBracket produced no PNG")
            finally:
                browser.close()

        hold_png = tmp_dir / "hold.png"
        hold_png.write_bytes(base64.b64decode(hold_b64))
        hold_clip = tmp_dir / "hold.mp4"
        slog.log(f"bracket-{tag}: encode {hold_sec:.1f}s hold")
        _encode_still_loop(ffmpeg_bin, hold_png, hold_clip, hold_sec)
        if motion_frames > 0:
            motion_clip = tmp_dir / "motion.mp4"
            _encode_png_sequence(
                ffmpeg_bin,
                tmp_dir / "frame_%04d.png",
                motion_clip,
                fps=ct.FPS,
            )
            ct.concat_videos([motion_clip, hold_clip], out_path)
        else:
            shutil.copy2(hold_clip, out_path)
        ct.mix_music_bed(out_path)
    slog.log(f"bracket-{tag}: done {out_path.name}")
    return out_path


def _normalized_spins(powerup_spins) -> dict | None:
    if not isinstance(powerup_spins, dict):
        return None
    a = powerup_spins.get("a")
    b = powerup_spins.get("b")
    if not isinstance(a, dict) or not isinstance(b, dict):
        return None
    if not a.get("slices") or not b.get("slices"):
        return None
    return {"a": a, "b": b}


def _apply_spins_to_matchup(matchup: list, spins: dict) -> list:
    out = []
    for slot, spin in zip(matchup, (spins["a"], spins["b"])):
        if not isinstance(slot, dict):
            out.append(slot)
            continue
        config = dict(slot.get("config") or {})
        pid = spin.get("resultId") or ""
        if pid:
            config["powerupId"] = pid
        else:
            config.pop("powerupId", None)
        out.append({**slot, "config": config})
    return out


def _apply_weapon_spins_to_matchup(matchup: list, spins: dict) -> list:
    out = []
    for slot, spin in zip(matchup, (spins["a"], spins["b"])):
        if not isinstance(slot, dict):
            out.append(slot)
            continue
        config = dict(slot.get("config") or {})
        wid = str(spin.get("resultId") or "").strip()
        if wid:
            config["weaponId"] = wid
        out.append({**slot, "config": config})
    return out


def _sync_bracket_to_arena_winner(bracket_pre: dict, winner_name: str) -> dict | None:
    """Rebuild post-match bracket from the recorded fight winner (not a demo pick)."""
    if not isinstance(bracket_pre, dict) or not bracket_pre.get("rounds"):
        return None
    name = str(winner_name or "").strip()
    if not name:
        return None
    helper = ARENA_DIR / "workflow" / "apply-arena-result.js"
    try:
        result = subprocess.run(
            ["node", str(helper)],
            input=json.dumps({"bracketPre": bracket_pre, "winnerName": name}),
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001
        slog.log(f"bracket-sync failed: {exc}", "WARN")
        return None
    if result.returncode != 0:
        slog.log(f"bracket-sync failed: {(result.stderr or result.stdout).strip()}", "WARN")
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("bracketPost"), dict):
        return None
    return data


def _powerup_parts_stale(existing: dict, spins: dict | None) -> bool:
    has = any(
        isinstance(part, dict) and part.get("kind") == "powerup-spin"
        for part in (existing.get("parts") or [])
    )
    return has != bool(spins)


def _weapon_parts_stale(existing: dict, spins: dict | None) -> bool:
    has = any(
        isinstance(part, dict) and part.get("kind") == "weapon-spin"
        for part in (existing.get("parts") or [])
    )
    return has != bool(spins)


def record_powerup_clip(
    *,
    spins: dict,
    out_path: Path,
    base_url: str,
    title: str = "POWERUP SPIN",
) -> Path:
    """Render a wheel animation (powerup or weapon) to a timed 1280×720 clip."""
    spins = _normalized_spins(spins)
    if not spins:
        raise ValueError("powerup spins a/b with slices required")
    label = (title or "POWERUP SPIN").strip() or "POWERUP SPIN"
    slog.log(f"wheel({label}): open chrome {out_path.name}")
    sync_playwright = _require_playwright()
    ffmpeg_bin = ct._require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"{base_url.rstrip('/')}/pages/offline-bracket.html"
    with tempfile.TemporaryDirectory(prefix="tour-powerup-") as tmp:
        tmp_dir = Path(tmp)
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel="chrome",
                headless=True,
                args=["--disable-dev-shm-usage", "--mute-audio"],
            )
            audio = {}
            try:
                page = browser.new_page(
                    viewport={"width": ct.WIDTH, "height": ct.HEIGHT},
                    device_scale_factor=2,
                )
                page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_function(
                    "() => window.OfflineBracket && window.PowerupWheel"
                    " && window.WorkflowBracketPreview && window.ArenaAudio",
                    timeout=30_000,
                )
                info = page.evaluate(
                    """async ({ spins, title }) => {
                        return await window.OfflineBracket.preparePowerup(spins, { title });
                    }""",
                    {"spins": spins, "title": label},
                )
                if not info:
                    raise RuntimeError("OfflineBracket.preparePowerup failed")
                duration_ms = max(1, int(info.get("durationMs") or 11000))
                frames = max(1, int(round((duration_ms / 1000) * POWERUP_FPS)))
                slog.log(f"wheel({label}): render {frames} frames ({duration_ms}ms)")
                last_progress = 0.0
                t_frames = time.perf_counter()
                for i in range(frames):
                    elapsed = i * 1000 / POWERUP_FPS
                    now = time.perf_counter()
                    if i == 0 or i + 1 == frames or now - last_progress >= 2.0:
                        last_progress = now
                        slog.log(
                            f"wheel({label}): frame {i + 1}/{frames} "
                            f"({now - t_frames:.0f}s)"
                        )
                    png_b64 = page.evaluate(
                        "(elapsed) => window.OfflineBracket.renderPowerupPngBase64(elapsed)",
                        elapsed,
                    )
                    if not isinstance(png_b64, str) or not png_b64:
                        raise RuntimeError("OfflineBracket produced no powerup PNG")
                    (tmp_dir / f"frame_{i:04d}.png").write_bytes(base64.b64decode(png_b64))
                audio = page.evaluate(
                    """async () => {
                        return await window.OfflineBracket.renderTickAudio();
                    }"""
                ) or {}
            finally:
                browser.close()

        audio_path = None
        wav_b64 = audio.get("wavBase64") if isinstance(audio, dict) else None
        if isinstance(wav_b64, str) and wav_b64:
            audio_path = tmp_dir / "ticks.wav"
            audio_path.write_bytes(base64.b64decode(wav_b64))

        silent = tmp_dir / "silent.mp4"
        slog.log(f"wheel({label}): encode mp4")
        _encode_png_sequence(
            ffmpeg_bin,
            tmp_dir / "frame_%04d.png",
            silent,
            fps=POWERUP_FPS,
            audio_path=audio_path,
        )
        shutil.copy2(silent, out_path)
        ct.mix_music_bed(out_path)
    slog.log(f"wheel({label}): done {out_path.name}")
    return out_path


_WEAPON_THEME_COLORS = (
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#3b82f6",
    "#a855f7",
    "#000000",
)


def _sanitize_arena_matchup(matchup: list) -> list:
    """Coerce weapon colors onto the live theme palette so setMatchup cannot throw."""
    out = []
    for i, slot in enumerate(matchup):
        if not isinstance(slot, dict):
            out.append(slot)
            continue
        config = dict(slot.get("config") or {})
        color = str(config.get("color") or "").strip().lower()
        if color not in _WEAPON_THEME_COLORS:
            config["color"] = _WEAPON_THEME_COLORS[i % len(_WEAPON_THEME_COLORS)]
        else:
            config["color"] = color
        out.append({**slot, "config": config})
    return out


def record_arena_pair(
    *,
    mode: str,
    matchup: list,
    base_url: str,
    out_path: Path,
) -> dict:
    """Run offline_record for exactly two fighters; write landscape 1280×720 clip."""
    if not isinstance(matchup, list) or len(matchup) != 2:
        raise ValueError("arena matchup must be exactly two fighters")
    payload = {
        "mode": mode if mode in {"collision", "weapon"} else "collision",
        "matchup": _sanitize_arena_matchup(matchup),
        "introMode": "skip",
        "view": "computer",
    }
    executable = _arena_python()
    slog.log("arena: launch offline_record (stderr inherits for live frame logs)")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        json.dump(payload, tmp)
        payload_path = Path(tmp.name)
    try:
        result = subprocess.run(
            [
                executable,
                str(PIPELINE_DIR / "offline_record.py"),
                "--payload",
                str(payload_path),
                "--base-url",
                base_url,
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=None,
            timeout=600,
        )
    finally:
        payload_path.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(
            result.stdout.strip() or "Tournament arena record failed"
        )
    raw = json.loads(result.stdout)
    src = Path(raw["path"])
    if not src.is_file():
        raise RuntimeError(f"offline record missing file: {raw}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out_path)
    slog.log(
        f"arena: done {out_path.name} "
        f"({raw.get('frames')}f {raw.get('totalSec')}s winner={raw.get('winner')})"
    )
    return {**raw, "landscapePath": str(out_path), "landscapeFile": out_path.name}


def ensure_match_segment_media(
    *,
    match_key: str,
    script: str,
    order_index: int,
    mode: str,
    matchup: list,
    a_name: str | None,
    b_name: str | None,
    winner_name: str | None,
    loser_name: str | None,
    base_url: str,
    force: bool = False,
    synthetic_arena: bool = False,
    bracket_pre: dict | None = None,
    bracket_post: dict | None = None,
    active_match: dict | None = None,
    last_winner: dict | None = None,
    last_loser: dict | None = None,
    powerup_spins: dict | None = None,
    weapon_spins: dict | None = None,
) -> dict:
    """
    Produce pre/arena/post clips and a narrated segment.
    When weapon_spins / powerup_spins are set, records those wheels and applies
    resultIds to the fight matchup.
    synthetic_arena=True skips Playwright offline record (tests / fast path).
    """
    ct.ensure_dirs()
    safe = ct.safe_segment_id(match_key)
    pre = ct.CLIPS_DIR / f"{safe}-pre.mp4"
    arena = ct.CLIPS_DIR / f"{safe}-arena.mp4"
    post = ct.CLIPS_DIR / f"{safe}-post.mp4"
    weapon = ct.CLIPS_DIR / f"{safe}-weapon.mp4"
    powerup = ct.CLIPS_DIR / f"{safe}-powerup.mp4"
    title = ct.CLIPS_DIR / f"{safe}-title.mp4"
    card = ct.round_card(bracket_pre, active_match, match_key=match_key)
    w_spins = _normalized_spins(weapon_spins)
    spins = _normalized_spins(powerup_spins)
    if w_spins:
        matchup = _apply_weapon_spins_to_matchup(matchup, w_spins)
    if spins:
        matchup = _apply_spins_to_matchup(matchup, spins)

    existing = ct.find_segment(ct.load_manifest(), match_key)
    seg_path = ct.segment_path_for(match_key)
    if (
        not force
        and existing
        and existing.get("status") == "done"
        and seg_path.is_file()
        and not _powerup_parts_stale(existing, spins)
        and not _weapon_parts_stale(existing, w_spins)
    ):
        slog.log(f"segment: reuse {existing.get('file')} ({a_name} vs {b_name})")
        return {"created": False, "segment": existing, "manifest": ct.load_manifest()}

    left = a_name or "A"
    right = b_name or "B"
    win = winner_name or "Winner"
    lose = loser_name or (right if win == left else left)
    label = f"{left} vs {right}"

    # Bracket frames are independent of arena synthetic mode. Real state → real canvas
    # capture. Placeholders are only for explicit synthetic test runs without state.
    slog.log(f"segment: start {label}")
    slog.log(f"segment: title {card['heading']} {card['detail'] or label}")
    slog.log(f"segment: bracket-pre {label}")
    if isinstance(bracket_pre, dict) and bracket_pre.get("rounds"):
        record_bracket_clip(
            state=bracket_pre,
            phase="pre",
            out_path=pre,
            base_url=base_url,
            duration=BRACKET_PRE_SEC,
            active_match=active_match,
            title_out=title,
            title=card,
        )
    elif synthetic_arena:
        ct.make_title_card_clip(
            title,
            heading=card["heading"],
            detail=card["detail"],
        )
        ct.mix_music_bed(title)
        make_bracket_clip(
            pre,
            f"BRACKET · {left} vs {right}",
            duration=BRACKET_PRE_SEC,
            color="0xdbeafe",
        )
    else:
        raise ValueError(
            "bracketPre with rounds is required to record the Bracket cell "
            "(refusing text-placeholder fallback)"
        )

    slog.log(
        f"segment: weapon={'on' if w_spins else 'off'} "
        f"powerup={'on' if spins else 'off'} {label}"
    )
    weapon_clip = None
    if w_spins:
        if synthetic_arena:
            make_bracket_clip(
                weapon,
                f"WEAPON · {left} vs {right}",
                duration=1.6,
                color="0xfecaca",
            )
        else:
            record_powerup_clip(
                spins=w_spins,
                out_path=weapon,
                base_url=base_url,
                title="WEAPON SPIN",
            )
        weapon_clip = weapon

    powerup_clip = None
    if spins:
        if synthetic_arena:
            make_bracket_clip(
                powerup,
                f"POWERUP · {left} vs {right}",
                duration=1.6,
                color="0xfde68a",
            )
        else:
            record_powerup_clip(spins=spins, out_path=powerup, base_url=base_url)
        powerup_clip = powerup

    slog.log(f"segment: arena {label}")
    arena_meta = None
    if synthetic_arena:
        make_bracket_clip(arena, f"ARENA {left} vs {right}", duration=1.4, color="0xfef3c7")
    else:
        arena_meta = record_arena_pair(
            mode=mode,
            matchup=matchup,
            base_url=base_url,
            out_path=arena,
        )
        arena_winner = (arena_meta or {}).get("winner")
        if arena_winner:
            synced = _sync_bracket_to_arena_winner(bracket_pre, arena_winner)
            if not synced and not (isinstance(bracket_post, dict) and bracket_post.get("rounds")):
                raise RuntimeError(
                    f"could not apply arena winner {arena_winner!r} to the bracket"
                )
            if synced:
                if winner_name and winner_name != synced.get("winnerName"):
                    slog.log(
                        f"segment: arena winner {synced.get('winnerName')} "
                        f"overrides planned {winner_name}"
                    )
                bracket_post = synced["bracketPost"]
                last_winner = synced.get("lastWinner") or last_winner
                last_loser = synced.get("lastLoser") or last_loser
                winner_name = synced.get("winnerName") or winner_name
                loser_name = synced.get("loserName") or loser_name
                script = ct.replace_outcome_winner(script, winner_name)
                win = winner_name or win
                lose = loser_name or lose

    slog.log(f"segment: bracket-post {label}")
    if isinstance(bracket_post, dict) and bracket_post.get("rounds"):
        record_bracket_clip(
            state=bracket_post,
            phase="post",
            out_path=post,
            base_url=base_url,
            duration=BRACKET_HOLD_SEC,
            last_winner=last_winner,
            last_loser=last_loser,
            active_match=active_match,
        )
    elif synthetic_arena:
        make_bracket_clip(
            post,
            f"BRACKET · {win} advances · {lose} exits",
            duration=BRACKET_HOLD_SEC,
            color="0xdcfce7",
        )
    else:
        raise ValueError(
            "bracketPost with rounds is required to record the Bracket cell "
            "(refusing text-placeholder fallback)"
        )

    slog.log(f"segment: narrate+concat {label}")
    built = ct.build_match_segment(
        match_key=match_key,
        script=script,
        pre_bracket=pre,
        arena=arena,
        post_bracket=post,
        order_index=order_index,
        a_name=a_name,
        b_name=b_name,
        winner_name=winner_name,
        force=True,
        weapon_clip=weapon_clip,
        weapon_spins=w_spins,
        powerup_clip=powerup_clip,
        powerup_spins=spins,
        title_clip=title if title.is_file() else None,
        bracket_pre=bracket_pre,
        active_match=active_match,
    )
    built["arena"] = arena_meta
    built["winnerName"] = winner_name
    built["bracketPost"] = bracket_post
    built["clips"] = {
        "pre": str(pre),
        "arena": str(arena),
        "post": str(post),
        **({"title": str(title)} if title.is_file() else {}),
        **({"weapon": str(weapon)} if weapon_clip else {}),
        **({"powerup": str(powerup)} if powerup_clip else {}),
    }
    slog.log(f"segment: done {label} → {(built.get('segment') or {}).get('file')}")
    return built


def _intro_fighter_payload(fighters: list | None) -> list[dict]:
    out: list[dict] = []
    for fighter in fighters or []:
        if not isinstance(fighter, dict):
            continue
        name = str(fighter.get("name") or "").strip()
        if not name:
            continue
        fid = fighter.get("id")
        skin_id = fighter.get("skinId") or (fid if fid and fid != "_weapon" else None)
        out.append(
            {
                "id": fid,
                "name": name,
                "color": fighter.get("color") or "#888888",
                "skinId": skin_id,
                "weaponId": fighter.get("weaponId"),
                "weaponIcon": fighter.get("weaponIcon"),
            }
        )
    return out


def render_intro_card_clip(
    out_path: Path,
    *,
    title: str,
    fighters: list | None,
    weapon_mode: bool,
    base_url: str,
    duration: float,
) -> Path:
    """Still intro card: video title + sized balls (weapon icon when weapon mode)."""
    sync_playwright = _require_playwright()
    ffmpeg_bin = ct._require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "title": title or "Ball Arena Tournament",
        "fighters": _intro_fighter_payload(fighters),
        "weaponMode": bool(weapon_mode),
    }
    url = f"{base_url.rstrip('/')}/pages/offline-bracket.html"
    slog.log(f"intro-card: open chrome ({len(payload['fighters'])} fighters)")
    with tempfile.TemporaryDirectory(prefix="tour-intro-card-") as tmp:
        tmp_dir = Path(tmp)
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel="chrome",
                headless=True,
                args=["--disable-dev-shm-usage", "--mute-audio"],
            )
            try:
                page = browser.new_page(
                    viewport={"width": ct.WIDTH, "height": ct.HEIGHT},
                    device_scale_factor=2,
                )
                page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_function(
                    "() => window.OfflineBracket && window.OfflineBracket.renderIntroPngBase64",
                    timeout=30_000,
                )
                png_b64 = page.evaluate(
                    """async (card) => {
                        return await window.OfflineBracket.renderIntroPngBase64(card);
                    }""",
                    payload,
                )
                if not isinstance(png_b64, str) or not png_b64:
                    raise RuntimeError("OfflineBracket produced no intro PNG")
            finally:
                browser.close()
        png_path = tmp_dir / "intro.png"
        png_path.write_bytes(base64.b64decode(png_b64))
        _encode_still_loop(ffmpeg_bin, png_path, out_path, duration)
    slog.log(f"intro-card: done {out_path.name}")
    return out_path


def ensure_champion_clip(
    label: str = "CHAMPION",
    *,
    bracket_state: dict | None = None,
    base_url: str | None = None,
) -> Path:
    path = ct.CLIPS_DIR / "champion-hold.mp4"
    slog.log(f"champion: hold clip · {label}")
    if isinstance(bracket_state, dict) and bracket_state.get("rounds") and base_url:
        record_bracket_clip(
            state=bracket_state,
            phase="champion",
            out_path=path,
            base_url=base_url,
            duration=CHAMPION_SEC,
            last_winner=bracket_state.get("champion"),
        )
        slog.log(f"champion: done {path.name}")
        return path
    if not base_url:
        make_bracket_clip(path, label, duration=CHAMPION_SEC, color="0xf0fdf4")
        slog.log(f"champion: done placeholder {path.name}")
        return path
    raise ValueError(
        "bracketState with rounds is required for champion hold "
        "(refusing text-placeholder fallback)"
    )
