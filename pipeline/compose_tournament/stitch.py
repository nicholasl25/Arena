"""Final and preview stitching."""
from __future__ import annotations

from pathlib import Path

import step_log as slog

from . import config
from .chapters import build_chapters, format_chapters_description
from .manifest import load_manifest, save_manifest, status_payload
from . import media


def stitch_final(
    *,
    champion_clip: Path | None = None,
    intro_clip: Path | None = None,
    force: bool = False,
    expected_count: int | None = None,
    match_keys: list[str] | None = None,
    champion_name: str | None = None,
) -> dict:
    """Concatenate all done segments (bracket order) into tournament-final.mp4."""
    config.ensure_dirs()
    manifest = load_manifest()
    if (
        not force
        and manifest.get("final")
        and (config.RECORDINGS / "composed" / Path(manifest["final"]).name).is_file()
        and manifest.get("status") == "complete"
    ):
        slog.log(f"stitch: reuse {manifest['final']}")
        return {
            "created": False,
            "final": manifest["final"],
            "path": str(config.RECORDINGS / "composed" / Path(manifest["final"]).name),
            "manifest": manifest,
        }

    done = {
        entry.get("matchKey"): entry
        for entry in (manifest.get("segments") or [])
        if entry.get("status") == "done"
    }
    if match_keys is not None:
        missing = [key for key in match_keys if key not in done]
        if missing:
            error = RuntimeError(f"missing done segments: {', '.join(missing)}")
            manifest["status"] = "error"
            manifest["error"] = f"stitch failed: {error}"
            save_manifest(manifest)
            raise error
        segs = [done[key] for key in match_keys]
    else:
        segs = sorted(
            done.values(),
            key=lambda s: (s.get("order", 0), s.get("matchKey") or ""),
        )
    if expected_count is not None and len(segs) != int(expected_count):
        error = RuntimeError(
            f"need exactly {expected_count} done segments before stitch, have {len(segs)}"
        )
        manifest["status"] = "error"
        manifest["error"] = f"stitch failed: {error}"
        save_manifest(manifest)
        raise error
    if not segs:
        error = RuntimeError("no completed match segments to stitch")
        manifest["status"] = "error"
        manifest["error"] = f"stitch failed: {error}"
        save_manifest(manifest)
        raise error

    paths = []
    intro_ok = bool(intro_clip and Path(intro_clip).is_file())
    if intro_ok:
        paths.append(Path(intro_clip))
    for entry in segs:
        path = config.SEGMENTS_DIR / entry["file"]
        if not path.is_file():
            error = FileNotFoundError(f"segment missing on disk: {entry['file']}")
            manifest["status"] = "error"
            manifest["error"] = f"stitch failed: {error}"
            save_manifest(manifest)
            raise error
        paths.append(path)
    champion_ok = bool(champion_clip and Path(champion_clip).is_file())
    if champion_ok:
        paths.append(Path(champion_clip))

    intro_dur = media.media_duration(Path(intro_clip)) if intro_ok else 0.0
    champion_dur = media.media_duration(Path(champion_clip)) if champion_ok else 0.0
    chapters = build_chapters(
        segs,
        champion_name=champion_name,
        champion_duration=champion_dur,
        intro_duration=intro_dur,
    )
    chapters_text = format_chapters_description(chapters)
    if chapters_text:
        (config.TOURNAMENT_DIR / "chapters.txt").write_text(chapters_text + "\n")

    manifest["stitch"] = {
        "segments": [
            {
                "order": entry["order"],
                "matchKey": entry["matchKey"],
                "file": entry["file"],
            }
            for entry in segs
        ],
        "intro": str(intro_clip) if intro_ok else None,
        "championHold": str(champion_clip) if champion_ok else None,
        "chapters": chapters,
        "chaptersText": chapters_text,
        "output": config.FINAL_NAME,
    }
    manifest["status"] = "stitching"
    manifest["error"] = None
    save_manifest(manifest)

    slog.log(f"stitch: {len(paths)} clips → {config.FINAL_NAME}")
    try:
        media.concat_videos(paths, config.FINAL_PATH)
    except Exception as exc:  # noqa: BLE001
        slog.log(f"stitch: failed {exc}", "ERROR")
        manifest["status"] = "error"
        manifest["error"] = f"stitch failed: {exc}"
        save_manifest(manifest)
        raise

    manifest["final"] = config.FINAL_NAME
    manifest["status"] = "complete"
    manifest["error"] = None
    save_manifest(manifest)
    slog.log(f"stitch: done {config.FINAL_NAME}", "DONE")
    return {
        "created": True,
        "final": config.FINAL_NAME,
        "path": str(config.FINAL_PATH),
        "duration": round(media.media_duration(config.FINAL_PATH), 3),
        "segmentCount": len(segs),
        "chapters": chapters,
        "chaptersText": chapters_text,
        "manifest": manifest,
    }


def _done_segments(manifest: dict) -> list[dict]:
    return sorted(
        [
            entry
            for entry in (manifest.get("segments") or [])
            if entry.get("status") == "done" and entry.get("file")
        ],
        key=lambda entry: (entry.get("order", 0), entry.get("matchKey") or ""),
    )


def _preview_signature(segs: list[dict]) -> str:
    parts = []
    for entry in segs:
        path = config.SEGMENTS_DIR / entry["file"]
        mtime = int(path.stat().st_mtime) if path.is_file() else 0
        parts.append(f"{entry.get('matchKey')}:{entry['file']}:{mtime}")
    return "|".join(parts)


def stitch_preview(*, force: bool = False) -> dict:
    """Concatenate completed match segments into a preview of the long video so far.

    Independent of the final YouTube stitch — no champion hold, no expected count.
    """
    config.ensure_dirs()
    manifest = load_manifest()
    status = status_payload()
    if not force and status.get("finalReady") and status.get("final"):
        return {
            "created": False,
            "preview": status["final"],
            "url": f"/recordings/composed/{status['final']}",
            "path": status.get("finalPath"),
            "segmentCount": status.get("doneSegmentCount") or 0,
            "final": True,
        }

    segs = _done_segments(manifest)
    if not segs:
        raise RuntimeError("no completed match segments to preview")

    signature = _preview_signature(segs)
    cached = manifest.get("preview") if isinstance(manifest.get("preview"), dict) else {}
    if (
        not force
        and cached.get("signature") == signature
        and config.PREVIEW_PATH.is_file()
    ):
        return {
            "created": False,
            "preview": config.PREVIEW_NAME,
            "url": f"/recordings/composed/tournament/{config.PREVIEW_NAME}",
            "path": str(config.PREVIEW_PATH),
            "segmentCount": len(segs),
            "final": False,
        }

    paths = []
    for entry in segs:
        path = config.SEGMENTS_DIR / entry["file"]
        if not path.is_file():
            raise FileNotFoundError(f"segment missing on disk: {entry['file']}")
        paths.append(path)

    slog.log(f"preview: stitch {len(paths)} segments")
    media.concat_videos(paths, config.PREVIEW_PATH)
    slog.log(f"preview: done {config.PREVIEW_NAME}")
    manifest["preview"] = {
        "file": config.PREVIEW_NAME,
        "signature": signature,
        "segmentCount": len(segs),
        "keys": [entry.get("matchKey") for entry in segs],
    }
    save_manifest(manifest)
    return {
        "created": True,
        "preview": config.PREVIEW_NAME,
        "url": f"/recordings/composed/tournament/{config.PREVIEW_NAME}",
        "path": str(config.PREVIEW_PATH),
        "segmentCount": len(segs),
        "duration": round(media.media_duration(config.PREVIEW_PATH), 3),
        "final": False,
    }

