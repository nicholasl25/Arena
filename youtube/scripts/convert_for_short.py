#!/usr/bin/env python3
"""Convert webm to vertical-friendly mp4 (h264 + aac) for YouTube upload."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python convert_for_short.py /path/to/video.webm", file=sys.stderr)
        raise SystemExit(2)

    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found. Install: brew install ffmpeg")

    src = Path(sys.argv[1]).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f"Not found: {src}")

    dst = src.with_suffix(".mp4")
    if dst.exists():
        n = 2
        while True:
            candidate = src.with_name(f"{src.stem}-yt{n}.mp4")
            if not candidate.exists():
                dst = candidate
                break
            n += 1

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        str(dst),
    ]
    subprocess.check_call(cmd)
    print(dst)


if __name__ == "__main__":
    main()
