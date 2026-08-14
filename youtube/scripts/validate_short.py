#!/usr/bin/env python3
"""Check whether a video file meets YouTube Shorts constraints."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


def probe_with_ffprobe(path: Path) -> dict | None:
    if not shutil.which("ffprobe"):
        return None
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
        return json.loads(out)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def parse_filename_fighters(path: Path) -> list[str]:
    stem = path.stem
    # exponential-vs-divider-2 → exponential, divider
    base = stem
    if base.rsplit("-", 1)[-1].isdigit():
        base = base.rsplit("-", 1)[0]
    if "-vs-" in base:
        return [p.replace("-", " ").title() for p in base.split("-vs-", 1)]
    return []


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python validate_short.py /path/to/video.webm", file=sys.stderr)
        raise SystemExit(2)

    path = Path(sys.argv[1]).expanduser().resolve()
    if not path.is_file():
        print(json.dumps({"ok": False, "error": f"Not found: {path}"}))
        raise SystemExit(1)

    info = probe_with_ffprobe(path)
    result: dict = {
        "path": str(path),
        "filename": path.name,
        "fighters": parse_filename_fighters(path),
        "ok": True,
        "warnings": [],
        "errors": [],
    }

    if info is None:
        result["warnings"].append(
            "ffprobe not installed — skipping duration/aspect checks. Install ffmpeg for validation."
        )
        print(json.dumps(result, indent=2))
        return

    duration = float(info.get("format", {}).get("duration", 0))
    result["durationSec"] = round(duration, 2)

    video_stream = next(
        (s for s in info.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )
    if video_stream:
        w = int(video_stream.get("width", 0))
        h = int(video_stream.get("height", 0))
        result["width"] = w
        result["height"] = h
        result["aspectRatio"] = f"{w}:{h}"
        if h <= w:
            result["errors"].append(f"Not vertical ({w}x{h}). Shorts need height > width.")
        if w > 0 and h / w < 1.5:
            result["warnings"].append("Aspect ratio may be too wide for Shorts (target 9:16).")

    if duration > 60:
        result["errors"].append(f"Duration {duration:.1f}s exceeds 60s Shorts limit.")
    elif duration > 55:
        result["warnings"].append(f"Duration {duration:.1f}s is close to 60s limit.")

    if result["errors"]:
        result["ok"] = False

    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
