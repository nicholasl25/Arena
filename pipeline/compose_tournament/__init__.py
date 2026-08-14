"""
Long YouTube tournament media pipeline.

Per matchup segment (bracket order):
  1) round title card
  2) pre-match bracket clip
  3) optional weapon-wheel clip (skin tournaments)
  4) optional powerup-wheel clip (when the Powerup step is on)
  5) arena fight clip (pair only)
  6) post-match bracket clip (winner advance / loser exit)

Public API stays importable as `import compose_tournament as ct`.
Path constants live in `compose_tournament.config` — prefer `ct.redirect_root()`
in tests, or read via `ct.CLIPS_DIR` (proxied from config).
"""

from __future__ import annotations

import asyncio  # re-exported for tests that patch ct.asyncio.run

from . import config
from . import media
from . import segment
from .bookends import (
    build_intro_script,
    build_intro_title,
    build_outro_script,
    ensure_intro_clip,
    ensure_outro_clip,
    fighter_names_from_bracket,
    is_skin_tournament,
    join_spoken_names,
    pick_champion_fighters,
)
from .captions import align_caption_words, build_bookend_ass
from .chapters import (
    build_chapters,
    chapter_title_for,
    format_chapters_description,
    format_timestamp,
    parse_match_round,
    round_card,
    round_label,
)
from .cli import main
from .config import (
    FINAL_NAME,
    FPS,
    FUN_DIR,
    HEIGHT,
    INTRO_CAPTION_OUTLINE,
    INTRO_CAPTION_PRIMARY,
    INTRO_CAPTION_SECONDARY,
    INTRO_MIN_SEC,
    INTRO_TAIL_PAD,
    MUSIC_BED_NAME,
    MUSIC_BED_SEC,
    MUSIC_BED_VOLUME,
    OUTRO_TAIL_PAD,
    PAGE_BG,
    PIPELINE_DIR,
    PREVIEW_NAME,
    TITLE_CARD_SEC,
    TTS_RATE,
    TTS_VOICE,
    WIDTH,
    ensure_dirs,
    redirect_root,
    restore_paths,
    safe_segment_id,
    snapshot_paths,
)
from .manifest import (
    clear_tournament_media,
    empty_manifest,
    find_segment,
    load_manifest,
    save_manifest,
    segment_path_for,
    status_payload,
)
from .media import (
    concat_videos,
    ensure_music_bed,
    make_color_clip,
    make_title_card_clip,
    media_duration,
    mix_music_bed,
    mix_segment_narration,
    mix_voiceover,
    music_bed_path,
    require_ffmpeg,
)
from .narration import (
    announce_at_secs,
    parse_match_narration,
    replace_outcome_winner,
    split_match_narration,
)
from .segment import build_match_segment
from .stitch import stitch_final, stitch_preview
from .tts import synthesize_script, synthesize_timed

# Private aliases kept for tournament_record / older callers.
_require_ffmpeg = require_ffmpeg

_CONFIG_PROXY = {
    "RECORDINGS",
    "TOURNAMENT_DIR",
    "SEGMENTS_DIR",
    "CLIPS_DIR",
    "MANIFEST_PATH",
    "FINAL_PATH",
    "PREVIEW_PATH",
}


def __getattr__(name: str):
    if name in _CONFIG_PROXY or hasattr(config, name):
        return getattr(config, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted(set(globals()) | _CONFIG_PROXY)
