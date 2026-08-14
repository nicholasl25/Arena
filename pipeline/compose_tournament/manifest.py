"""Tournament manifest load/save + status."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import step_log as slog

from . import config
from .media import media_duration, music_bed_path


def empty_manifest() -> dict:
    return {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "segments": [],
        "final": None,
        "status": "idle",
        "error": None,
    }


def load_manifest() -> dict:
    config.ensure_dirs()
    if not config.MANIFEST_PATH.is_file():
        return empty_manifest()
    try:
        data = json.loads(config.MANIFEST_PATH.read_text())
    except json.JSONDecodeError:
        return empty_manifest()
    if not isinstance(data, dict):
        return empty_manifest()
    data.setdefault("segments", [])
    data.setdefault("final", None)
    data.setdefault("status", "idle")
    data.setdefault("error", None)
    return data


def save_manifest(data: dict) -> dict:
    config.ensure_dirs()
    data = dict(data)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    config.MANIFEST_PATH.write_text(json.dumps(data, indent=2) + "\n")
    return data


def find_segment(manifest: dict, match_key: str) -> dict | None:
    for entry in manifest.get("segments") or []:
        if entry.get("matchKey") == match_key:
            return entry
    return None


def segment_path_for(match_key: str) -> Path:
    return config.SEGMENTS_DIR / f"match-{config.safe_segment_id(match_key)}.mp4"




def status_payload() -> dict:
    manifest = load_manifest()
    final_name = manifest.get("final")
    final_path = (
        config.RECORDINGS / "composed" / Path(final_name).name
        if final_name
        else config.FINAL_PATH
    )
    final_ok = bool(final_name and final_path.is_file() and manifest.get("status") == "complete")
    preview = manifest.get("preview") if isinstance(manifest.get("preview"), dict) else {}
    preview_ok = config.PREVIEW_PATH.is_file() and bool(preview.get("file"))
    return {
        "manifest": manifest,
        "final": final_name if final_ok else None,
        "finalPath": str(final_path) if final_ok else None,
        "finalReady": final_ok,
        "preview": config.PREVIEW_NAME if preview_ok else (final_name if final_ok else None),
        "previewReady": preview_ok or final_ok,
        "segmentCount": len(manifest.get("segments") or []),
        "doneSegmentCount": sum(
            1 for s in (manifest.get("segments") or []) if s.get("status") == "done"
        ),
        "chapters": (manifest.get("stitch") or {}).get("chapters"),
        "progress": slog.read_progress(),
    }


def clear_tournament_media() -> None:
    """Remove tournament segments/final/manifest (redo)."""
    if config.SEGMENTS_DIR.is_dir():
        for path in config.SEGMENTS_DIR.glob("*"):
            path.unlink(missing_ok=True)
    if config.CLIPS_DIR.is_dir():
        for path in config.CLIPS_DIR.glob("*"):
            path.unlink(missing_ok=True)
    config.FINAL_PATH.unlink(missing_ok=True)
    config.PREVIEW_PATH.unlink(missing_ok=True)
    music_bed_path().unlink(missing_ok=True)
    (config.TOURNAMENT_DIR / "chapters.txt").unlink(missing_ok=True)
    if config.MANIFEST_PATH.is_file():
        config.MANIFEST_PATH.unlink()
    slog.clear_progress()
