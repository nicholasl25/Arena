"""Mutable tournament paths + shared constants."""
from __future__ import annotations

import re
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parent.parent.parent
PIPELINE_DIR = Path(__file__).resolve().parent.parent

RECORDINGS = ARENA_DIR / "recordings"
TOURNAMENT_DIR = RECORDINGS / "composed" / "tournament"
SEGMENTS_DIR = TOURNAMENT_DIR / "segments"
CLIPS_DIR = TOURNAMENT_DIR / "clips"
MANIFEST_PATH = TOURNAMENT_DIR / "manifest.json"
FINAL_NAME = "tournament-final.mp4"
FINAL_PATH = RECORDINGS / "composed" / FINAL_NAME
PREVIEW_NAME = "preview.mp4"
PREVIEW_PATH = TOURNAMENT_DIR / PREVIEW_NAME
WIDTH = 1280
HEIGHT = 720
FPS = 30
PAGE_BG = "0xece8e1"
TITLE_CARD_SEC = 1.0
INTRO_TAIL_PAD = 1.8
INTRO_MIN_SEC = 5.5
OUTRO_TAIL_PAD = 0.85
OUTRO_LEAD_PAD = 1.0
OUTRO_MIN_SEC = 4.0
# ASS &HAABBGGRR — black spoken words (was yellow).
INTRO_CAPTION_PRIMARY = "&H00000000"
INTRO_CAPTION_SECONDARY = "&H00444444"
INTRO_CAPTION_OUTLINE = "&H00FFFFFF"
MUSIC_BED_NAME = "music-bed.wav"
MUSIC_BED_SEC = 32.0
MUSIC_BED_VOLUME = 0.16
VICTOR_STING_NAME = "victor-sting.wav"
VICTOR_STING_SEC = 2.2
VICTOR_STING_VOLUME = 0.9
TTS_VOICE = "en-AU-WilliamMultilingualNeural"
TTS_RATE = "+10%"
MATCH_ID = re.compile(r"^r(\d+)m(\d+)")

_PATH_ATTRS = (
    "RECORDINGS",
    "TOURNAMENT_DIR",
    "SEGMENTS_DIR",
    "CLIPS_DIR",
    "MANIFEST_PATH",
    "FINAL_PATH",
    "PREVIEW_PATH",
)


def snapshot_paths() -> dict:
    return {name: globals()[name] for name in _PATH_ATTRS}


def restore_paths(snapshot: dict) -> None:
    globals().update({name: snapshot[name] for name in _PATH_ATTRS})


def redirect_root(root: Path) -> dict:
    """Point all tournament artifacts under root/recordings. Returns prior snapshot."""
    prior = snapshot_paths()
    global RECORDINGS, TOURNAMENT_DIR, SEGMENTS_DIR, CLIPS_DIR
    global MANIFEST_PATH, FINAL_PATH, PREVIEW_PATH
    RECORDINGS = Path(root) / "recordings"
    TOURNAMENT_DIR = RECORDINGS / "composed" / "tournament"
    SEGMENTS_DIR = TOURNAMENT_DIR / "segments"
    CLIPS_DIR = TOURNAMENT_DIR / "clips"
    MANIFEST_PATH = TOURNAMENT_DIR / "manifest.json"
    FINAL_PATH = RECORDINGS / "composed" / FINAL_NAME
    PREVIEW_PATH = TOURNAMENT_DIR / PREVIEW_NAME
    return prior


def ensure_dirs() -> None:
    for path in (TOURNAMENT_DIR, SEGMENTS_DIR, CLIPS_DIR, RECORDINGS / "composed"):
        path.mkdir(parents=True, exist_ok=True)


def safe_segment_id(match_key: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(match_key or "").strip())
    return (text[:120] or "match").strip("._-") or "match"
