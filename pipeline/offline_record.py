#!/usr/bin/env python3
"""
Offline arena recording — run the fight as fast as the CPU allows in headless
Chrome, screenshot the requested arena view each frame, encode with ffmpeg (+ SFX audio).

Usage:
    python pipeline/offline_record.py --mode weapon --matchup '[{"id":"...","config":{...}}]'
    python pipeline/offline_record.py --payload /tmp/matchup.json

Requires: ffmpeg on PATH, playwright (pip install playwright), Google Chrome.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

FUN_DIR = Path(__file__).resolve().parent.parent
PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import step_log as slog  # noqa: E402

RECORDINGS_RAW = FUN_DIR / "recordings" / "raw"
DEFAULT_BASE_URL = "http://127.0.0.1:8764"
# Wall-clock safety: html fights can be long; refuse to hang the workflow forever.
RECORD_TIMEOUT_SEC = 600
# Phone Shorts: 3× DPR → sharp downscale. Computer/tournament: native 1× (output is 1280×720).
DEVICE_SCALE_PHONE = 3
DEVICE_SCALE_COMPUTER = 1
# Legacy alias used by callers that don't distinguish views.
DEVICE_SCALE = DEVICE_SCALE_PHONE
# 3:4 Shorts frame — matches intro (1080×1440). 9:16 cover-crop cut left/right.
OUT_WIDTH = 1080
OUT_HEIGHT = 1440
# Match arena `--arena-page-bg` when letterboxing content that isn't exactly 3:4.
PAD_COLOR = "0xECE8E1"
COMPUTER_WIDTH = 1280
COMPUTER_HEIGHT = 720
# Step+capture pairs per Python outer loop — same frames, less call overhead.
CAPTURE_BATCH = 24


def _require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg not found on PATH")
    return path


def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: WPS433
    except ImportError as exc:
        raise RuntimeError(
            "playwright is required. Install with: "
            f"{sys.executable} -m pip install playwright"
        ) from exc
    return sync_playwright


def slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return text or "fighter"


def resolve_filename(raw_dir: Path, base_name: str) -> Path:
    candidate = raw_dir / f"{base_name}.mp4"
    if not candidate.exists():
        return candidate
    version = 2
    while version < 10000:
        candidate = raw_dir / f"{base_name}-{version}.mp4"
        if not candidate.exists():
            return candidate
        version += 1
    raise RuntimeError("Too many versions of this recording already exist.")


def write_winner_meta(video_path: Path, meta: dict) -> Path | None:
    winner = meta.get("winner")
    has_intro = bool(meta.get("hasIntro"))
    fighters = meta.get("fighters")
    has_fighters = isinstance(fighters, list) and len(fighters) >= 2
    if (meta.get("draw") or not winner) and not has_intro and not has_fighters:
        return None
    meta_path = video_path.with_suffix(".json")
    payload = {
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "offline": True,
        "hasIntro": has_intro,
        "introFrames": meta.get("introFrames") or 0,
        "intros": meta.get("intros") or [],
        "introMode": meta.get("introMode"),
    }
    if winner and not meta.get("draw"):
        payload["winner"] = winner
    if has_fighters:
        payload["fighters"] = fighters
    meta_path.write_text(json.dumps(payload, indent=2) + "\n")
    return meta_path


def _capture_clip(
    page,
    scale: float = DEVICE_SCALE,
    *,
    content_bounds: bool = True,
) -> dict:
    """Screenshot clip for the phone page.

    Phone Shorts: clip hugs just above the title through just below the fighter
    cards. Aspect follows that content (3 fighters + powerups can be taller
    than 3:4). Encode later fits into the Shorts frame with pad — never crop
    the title or roster. Computer view still uses the full page box.
    """
    box = page.evaluate(
        """(useContent) => {
            const page = document.getElementById('offline-phone-page');
            if (!page) return null;
            const pageR = page.getBoundingClientRect();
            if (!useContent) {
                return { x: pageR.x, y: pageR.y, width: pageR.width, height: pageR.height };
            }
            const title = page.querySelector('.event-title')
                || page.querySelector('.page-header');
            const roster = page.querySelector('#contestant-roster')
                || page.querySelector('.contestant-roster');
            if (!title || !roster) {
                return { x: pageR.x, y: pageR.y, width: pageR.width, height: pageR.height };
            }
            const titleR = title.getBoundingClientRect();
            const rosterR = roster.getBoundingClientRect();
            const padTop = 10;
            const padBottom = 10;
            const top = titleR.top - padTop;
            const bottom = rosterR.bottom + padBottom;
            return {
                x: pageR.x,
                y: top,
                width: pageR.width,
                height: Math.max(2, bottom - top),
            };
        }""",
        bool(content_bounds),
    )
    if not box or box["width"] < 2 or box["height"] < 2:
        raise RuntimeError("offline arena page not found for screenshot clip")
    return {
        "x": float(box["x"]),
        "y": float(box["y"]),
        "width": float(box["width"]),
        "height": float(box["height"]),
        "scale": float(scale),
    }


def _cdp_step_frame(client) -> dict | None:
    result = client.send(
        "Runtime.evaluate",
        {
            "expression": "window.OfflineRender.stepFrame()",
            "returnByValue": True,
        },
    )
    if result.get("exceptionDetails"):
        raise RuntimeError(f"stepFrame failed: {result['exceptionDetails']}")
    value = (result.get("result") or {}).get("value")
    return value if isinstance(value, dict) else None


def _frame_png_bytes(client, clip: dict, step: dict) -> bytes:
    """Prefer baked intro PNG from JS; otherwise screenshot the arena page."""
    intro_b64 = step.get("introPng")
    if isinstance(intro_b64, str) and intro_b64:
        return base64.b64decode(intro_b64)
    return _cdp_capture_png(client, clip)


def _cdp_capture_png(client, clip: dict) -> bytes:
    result = client.send(
        "Page.captureScreenshot",
        {
            "format": "png",
            "clip": clip,
            "fromSurface": True,
            "captureBeyondViewport": True,
        },
    )
    data = result.get("data")
    if not data:
        raise RuntimeError("CDP screenshot returned no data")
    return base64.b64decode(data)


def _encode_frame_pipe(
    *,
    ffmpeg_bin: str,
    encode_fps: int,
    silent_path: Path,
    client,
    clip: dict,
    max_frames: int,
    out_width: int,
    out_height: int,
    timeout_sec: float = RECORD_TIMEOUT_SEC,
) -> int:
    """Step sim + lossless PNG screenshot each frame; encode sharp H.264."""
    # Content clip aspect can change with roster height (powerups, 3+ fighters).
    # Fit inside the Shorts frame — pad, never crop title/cards. Intro PNGs are
    # already 1080×1440 so this is a no-op for those frames.
    vf = (
        f"scale={out_width}:{out_height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={out_width}:{out_height}:(ow-iw)/2:(oh-ih)/2:color={PAD_COLOR},"
        "setsar=1"
    )
    video_cmd = [
        ffmpeg_bin,
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        str(encode_fps),
        "-vcodec",
        "png",
        "-i",
        "pipe:0",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "15",
        "-pix_fmt",
        "yuv420p",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-color_range",
        "tv",
        "-an",
        str(silent_path),
    ]
    # stderr to a file — a PIPE here deadlocks once the buffer fills while we
    # keep writing JPEG bytes to stdin.
    err_path = silent_path.with_suffix(".ffmpeg.log")
    frame_i = 0
    done = False
    t_start = time.perf_counter()
    last_progress = 0.0
    slog.log(f"offline: capture up to {max_frames} frames @ {encode_fps}fps")
    with err_path.open("wb") as err_file:
        proc = subprocess.Popen(
            video_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=err_file,
        )
        assert proc.stdin is not None
        try:
            while frame_i < max_frames and not done:
                if time.perf_counter() - t_start > timeout_sec:
                    raise RuntimeError(
                        f"offline record timed out after {timeout_sec:.0f}s "
                        f"({frame_i} frames captured)"
                    )
                # Batch only reduces Python loop overhead — still one lossless
                # screenshot per frame.
                for _ in range(CAPTURE_BATCH):
                    if frame_i >= max_frames:
                        break
                    if time.perf_counter() - t_start > timeout_sec:
                        raise RuntimeError(
                            f"offline record timed out after {timeout_sec:.0f}s "
                            f"({frame_i} frames captured)"
                        )
                    step = _cdp_step_frame(client)
                    if not step:
                        done = True
                        break
                    proc.stdin.write(_frame_png_bytes(client, clip, step))
                    frame_i = int(step.get("frameIndex") or (frame_i + 1))
                    now = time.perf_counter()
                    if frame_i <= 1 or now - last_progress >= 2.0 or step.get("done"):
                        last_progress = now
                        slog.log(
                            f"offline: frame {frame_i}/{max_frames} "
                            f"({now - t_start:.0f}s)"
                        )
                    if step.get("done"):
                        done = True
                        break
            proc.stdin.close()
            proc.wait(timeout=120)
        except Exception:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
            raise

    if proc.returncode != 0:
        err = err_path.read_text(errors="replace") if err_path.exists() else ""
        raise RuntimeError(f"ffmpeg video failed:\n{err or 'unknown error'}")
    return frame_i


def record_offline(
    *,
    mode: str,
    matchup: list,
    intro_mode: str | None = None,
    intros: list | None = None,
    base_url: str = DEFAULT_BASE_URL,
    fps: int = 30,
    view: str = "phone",
) -> dict:
    sync_playwright = _require_playwright()
    ffmpeg_bin = _require_ffmpeg()
    RECORDINGS_RAW.mkdir(parents=True, exist_ok=True)

    payload: dict = {"mode": mode, "matchup": matchup}
    if intro_mode and intro_mode != "skip":
        payload["introMode"] = intro_mode
        if isinstance(intros, list) and len(intros) >= 2:
            payload["intros"] = intros
    computer_view = view == "computer"
    out_width = COMPUTER_WIDTH if computer_view else OUT_WIDTH
    out_height = COMPUTER_HEIGHT if computer_view else OUT_HEIGHT
    device_scale = DEVICE_SCALE_COMPUTER if computer_view else DEVICE_SCALE_PHONE
    viewport = {
        "width": COMPUTER_WIDTH if computer_view else 520,
        # Tall enough for 3–6 fighter cards + powerups; clip still hugs title→roster.
        "height": COMPUTER_HEIGHT if computer_view else 1200,
    }
    url = f"{base_url.rstrip('/')}/pages/offline-render.html"
    if computer_view:
        url += "?view=computer"
    t0 = time.perf_counter()
    slog.log(f"offline: open chrome {url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--disable-dev-shm-usage", "--mute-audio"],
        )
        try:
            page = browser.new_page(
                viewport=viewport,
                device_scale_factor=device_scale,
            )
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_function(
                "() => window.OfflineRender && window.ArenaApp && window.ArenaAudio"
                " && window.IntroVsRender && window.BallIntros",
                timeout=30_000,
            )

            info = page.evaluate(
                """async (payload) => {
                    return await window.OfflineRender.prepare(payload);
                }""",
                payload,
            )
            if not info or not info.get("baseName"):
                raise RuntimeError("OfflineRender.prepare failed")

            slog.log(
                f"offline: prepare {info.get('baseName')} "
                f"max {info.get('maxFrames') or '?'}f"
            )
            out_path = resolve_filename(RECORDINGS_RAW, info["baseName"])
            encode_fps = int(info.get("fps") or fps)
            max_frames = int(info.get("maxFrames") or encode_fps * 60)
            clip = _capture_clip(
                page,
                device_scale,
                content_bounds=not computer_view,
            )
            if not computer_view and clip["width"] > 1:
                # Shorts width stays 1080; height follows title→roster aspect so
                # tall powerup cards never force a crop of the title.
                dyn_h = int(round(out_width * (clip["height"] / clip["width"])))
                if dyn_h % 2:
                    dyn_h += 1
                out_height = max(dyn_h, 2)
            slog.log(
                f"offline: clip {clip['width']:.0f}x{clip['height']:.0f} "
                f"(title→roster) → {out_width}x{out_height}"
            )
            client = page.context.new_cdp_session(page)

            with tempfile.TemporaryDirectory(prefix="arena-offline-") as tmp:
                tmp_dir = Path(tmp)
                silent_path = tmp_dir / "silent.mp4"
                t_capture = time.perf_counter()

                frame_i = _encode_frame_pipe(
                    ffmpeg_bin=ffmpeg_bin,
                    encode_fps=encode_fps,
                    silent_path=silent_path,
                    client=client,
                    clip=clip,
                    max_frames=max_frames,
                    out_width=out_width,
                    out_height=out_height,
                )
                capture_sec = time.perf_counter() - t_capture

                if frame_i < 2:
                    raise RuntimeError("offline record produced no frames")

                slog.log(f"offline: captured {frame_i} frames in {capture_sec:.1f}s")
                meta = page.evaluate("() => window.OfflineRender.getMeta()") or {}
                encode_fps = int(meta.get("fps") or encode_fps)

                slog.log("offline: mux sfx audio")
                audio = page.evaluate(
                    """async () => {
                        return await window.OfflineRender.finalizeAudio();
                    }"""
                ) or {}
                if not audio.get("wavBase64"):
                    raise RuntimeError("offline record produced no audio")

                audio_path = tmp_dir / "sfx.wav"
                audio_path.write_bytes(base64.b64decode(audio["wavBase64"]))

                mux_cmd = [
                    ffmpeg_bin,
                    "-y",
                    "-i",
                    str(silent_path),
                    "-i",
                    str(audio_path),
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    "-movflags",
                    "+faststart",
                    str(out_path),
                ]
                proc = subprocess.run(mux_cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    raise RuntimeError(
                        "ffmpeg mux failed:\n"
                        + (proc.stderr or proc.stdout or "unknown error")
                    )
        finally:
            browser.close()

    meta_path = write_winner_meta(out_path, meta or {})
    total_sec = time.perf_counter() - t0
    slog.log(
        f"offline: done {out_path.name} "
        f"({frame_i}f {total_sec:.1f}s winner={(meta or {}).get('winner')})"
    )
    return {
        "file": out_path.name,
        "path": str(out_path),
        "metaFile": meta_path.name if meta_path else None,
        "frames": frame_i,
        "fps": encode_fps,
        "mode": info.get("mode"),
        "baseName": info.get("baseName"),
        "width": out_width,
        "height": out_height,
        "view": "computer" if computer_view else "phone",
        "audioEvents": audio.get("eventCount") or meta.get("audioEvents") or 0,
        "hasIntro": bool(info.get("hasIntro")),
        "introFrames": info.get("introFrames") or 0,
        "winner": (meta or {}).get("winner"),
        "captureSec": round(capture_sec, 2),
        "totalSec": round(total_sec, 2),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline arena recording")
    parser.add_argument("--mode", choices=("collision", "weapon"), default="collision")
    parser.add_argument("--matchup", help="JSON array of matchup slots")
    parser.add_argument("--payload", type=Path, help="JSON file with {mode, matchup}")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args(argv)

    if args.payload:
        data = json.loads(args.payload.read_text())
        mode = data.get("mode") or args.mode
        matchup = data.get("matchup")
        intro_mode = data.get("introMode")
        intros = data.get("intros")
        view = data.get("view") or "phone"
    else:
        mode = args.mode
        intro_mode = None
        intros = None
        view = "phone"
        if not args.matchup:
            parser.error("--matchup or --payload required")
        matchup = json.loads(args.matchup)

    if not isinstance(matchup, list) or len(matchup) < 2:
        raise SystemExit("matchup must be a JSON array with at least 2 slots")

    result = record_offline(
        mode=mode,
        matchup=matchup,
        intro_mode=intro_mode,
        intros=intros,
        base_url=args.base_url,
        view=view,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
