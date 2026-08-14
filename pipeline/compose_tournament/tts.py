"""edge-tts synthesis helpers."""
from __future__ import annotations

from pathlib import Path

from . import config


def ensure_edge_tts_importable() -> None:
    """Prefer youtube/.venv site-packages when the host interpreter lacks edge-tts."""
    try:
        import edge_tts  # noqa: F401
        return
    except ImportError:
        pass
    venv = config.FUN_DIR / "youtube" / ".venv"
    if not venv.is_dir():
        raise RuntimeError("edge-tts unavailable; create youtube/.venv")
    import sys
    for pattern in ("lib/python*/site-packages", "lib/site-packages"):
        for path in venv.glob(pattern):
            sys.path.insert(0, str(path))
    import edge_tts  # noqa: F401


async def synthesize_script(script: str, out_mp3: Path) -> Path:
    await synthesize_timed(script, out_mp3)
    return out_mp3


async def synthesize_timed(script: str, out_mp3: Path) -> list[dict]:
    """TTS mp3 plus [{text, start, end}, ...] word timings in seconds."""
    ensure_edge_tts_importable()
    import edge_tts

    words: list[dict] = []
    communicate = edge_tts.Communicate(
        script, config.TTS_VOICE, rate=config.TTS_RATE, boundary="WordBoundary"
    )
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    with open(out_mp3, "wb") as handle:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                handle.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({
                    "text": chunk["text"],
                    "start": start,
                    "end": start + chunk["duration"] / 1e7,
                })
    return words
