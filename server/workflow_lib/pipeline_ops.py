"""Pipeline stages, compose/upload/quota, and pipeline module loaders."""
from __future__ import annotations

import importlib
import json
import shutil
import subprocess
import sys
import tempfile
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .assets import write_intro_manifest, write_skin_manifest
from .config import (
    CATEGORY_DEFAULT,
    DEFAULT_DAILY_QUOTA,
    ARENA_DIR,
    PIPELINE_DIR,
    PORT,
    PRIVACY_DEFAULT,
    QUOTA_LOG_PATH,
    RECORDINGS,
    STAGES,
    TAGS_DEFAULT,
    TIKTOK_DIR,
    TIKTOK_SCRIPTS,
    UPLOAD_COST_UNITS,
    YT_DIR,
    YT_SCRIPTS,
)


def load_compose_short():
    """Import pipeline/compose_short.py, reloading so config edits apply without restart."""
    if str(PIPELINE_DIR) not in sys.path:
        sys.path.insert(0, str(PIPELINE_DIR))
    import compose_short  # noqa: WPS433

    return importlib.reload(compose_short)


def load_compose_tournament():
    if str(PIPELINE_DIR) not in sys.path:
        sys.path.insert(0, str(PIPELINE_DIR))
    import compose_tournament  # noqa: WPS433

    # Package split: reload submodules so edits apply without server restart.
    pkg = Path(compose_tournament.__file__).resolve().parent
    if pkg.is_dir():
        for path in sorted(pkg.glob("*.py")):
            mod_name = f"compose_tournament.{path.stem}" if path.stem != "__init__" else "compose_tournament"
            mod = sys.modules.get(mod_name)
            if mod is not None:
                importlib.reload(mod)
    return importlib.reload(compose_tournament)


def load_tournament_record():
    if str(PIPELINE_DIR) not in sys.path:
        sys.path.insert(0, str(PIPELINE_DIR))
    import tournament_record  # noqa: WPS433

    return importlib.reload(tournament_record)


def load_prompt_matchup():
    if str(PIPELINE_DIR) not in sys.path:
        sys.path.insert(0, str(PIPELINE_DIR))
    import prompt_matchup  # noqa: WPS433

    return importlib.reload(prompt_matchup)


def ensure_stages() -> None:
    for path in STAGES.values():
        path.mkdir(parents=True, exist_ok=True)
    _migrate_legacy_recordings()
    _flatten_nested_raw()
    write_skin_manifest()
    write_intro_manifest()


def _flatten_nested_raw() -> None:
    """Move videos mistakenly saved under raw/raw/ up one level."""
    nested = STAGES["raw"] / "raw"
    if not nested.is_dir():
        return
    exts = {".webm", ".mp4", ".mov", ".mkv"}
    for item in nested.iterdir():
        if not item.is_file() or item.suffix.lower() not in exts:
            continue
        dest = STAGES["raw"] / item.name
        if not dest.exists():
            shutil.move(str(item), str(dest))
    try:
        nested.rmdir()
    except OSError:
        pass


def _migrate_legacy_recordings() -> None:
    """Move root-level recordings into stage folders (one-time housekeeping)."""
    if not RECORDINGS.is_dir():
        return
    exts = {".webm", ".mp4", ".mov", ".mkv"}
    for item in RECORDINGS.iterdir():
        if not item.is_file() or item.suffix.lower() not in exts:
            continue
        if item.stem.endswith("-final"):
            dest = STAGES["composed"] / item.name
        else:
            dest = STAGES["raw"] / item.name
        if not dest.exists():
            shutil.move(str(item), str(dest))


def python_executable() -> str:
    venv_py = YT_DIR / ".venv/bin/python"
    return str(venv_py if venv_py.is_file() else sys.executable)


def list_videos(folder: Path) -> list[dict]:
    if not folder.is_dir():
        return []
    exts = {".webm", ".mp4", ".mov", ".mkv"}
    files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "name": p.name,
            "size": p.stat().st_size,
            "mtime": int(p.stat().st_mtime),
        }
        for p in files
    ]


def _strip_recording_stem(filename: str) -> tuple[str, bool]:
    """Normalize recording stem → (base without weapon-/suffix, weapon_mode)."""
    stem = Path(filename).stem
    base = stem
    if base.endswith("-final"):
        base = base[: -len("-final")]
    if base.rsplit("-", 1)[-1].isdigit():
        base = base.rsplit("-", 1)[0]
    weapon_mode = base.startswith("weapon-")
    if weapon_mode:
        base = base[len("weapon-"):]
    return base, weapon_mode


def parse_fighters(filename: str) -> tuple[list[str], bool]:
    base, weapon_mode = _strip_recording_stem(filename)
    if "-vs-" not in base:
        return ["Fighter A", "Fighter B"], weapon_mode
    names = [part.replace("-", " ").title() for part in base.split("-vs-") if part]
    if len(names) < 2:
        return ["Fighter A", "Fighter B"], weapon_mode
    return names, weapon_mode


def parse_fighter_slugs(filename: str) -> tuple[list[str], bool]:
    base, weapon_mode = _strip_recording_stem(filename)
    if "-vs-" not in base:
        return ["fighter-a", "fighter-b"], weapon_mode
    slugs = [part for part in base.split("-vs-") if part]
    if len(slugs) < 2:
        return ["fighter-a", "fighter-b"], weapon_mode
    return slugs, weapon_mode


def fighter_display_names(filename: str) -> tuple[list, bool]:
    cs = load_compose_short()

    slugs, weapon_mode = parse_fighter_slugs(filename)
    stem = Path(filename).stem
    for stage_dir in (STAGES["raw"], STAGES["composed"], STAGES["posted"], RECORDINGS):
        if not stage_dir.is_dir():
            continue
        for candidate in (
            stage_dir / filename,
            stage_dir / f"{stem}.webm",
            stage_dir / f"{stem}.mp4",
            stage_dir / f"{stem}.json",
        ):
            video_for_meta = candidate if candidate.suffix != ".json" else candidate.with_suffix(".webm")
            sidecar = cs.load_matchup_fighters(video_for_meta)
            if not sidecar and candidate.suffix == ".json" and candidate.is_file():
                sidecar = cs.load_matchup_fighters(candidate.with_suffix(".webm"))
            if sidecar:
                return sidecar, weapon_mode

    if weapon_mode:
        skins = cs.load_skins()
        weapons = cs.load_weapons()
        names = [cs.resolve_weapon_fighter(slug, skins, weapons)["name"] for slug in slugs]
    else:
        catalog = cs.load_fighters()
        names = [
            catalog.get(slug, {"name": slug.replace("-", " ").title()})["name"]
            for slug in slugs
        ]
    return names, weapon_mode


def draft_script(raw_name: str) -> str:
    cs = load_compose_short()
    path = STAGES["raw"] / raw_name
    if not path.is_file():
        raise FileNotFoundError(f"Raw recording not found: {raw_name}")
    return cs.build_script(path)


def draft_script_meta(raw_name: str) -> dict:
    cs = load_compose_short()
    path = STAGES["raw"] / raw_name
    if not path.is_file():
        raise FileNotFoundError(f"Raw recording not found: {raw_name}")
    _, weapon_mode = cs.parse_fighter_ids(path)
    return {
        "script": cs.build_script(path),
        "mode": "weapon" if weapon_mode else "collision",
    }


def run_script(script: str, *args: str) -> subprocess.CompletedProcess[str]:
    cmd = [python_executable(), str(YT_SCRIPTS / script), *args]
    return subprocess.run(cmd, text=True, capture_output=True)


def validate_video(path: Path) -> dict:
    result = run_script("validate_short.py", str(path))
    if result.stdout.strip():
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            pass
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Validation failed")
    raise RuntimeError("validate_short.py produced no output")


def convert_video(path: Path) -> Path:
    result = run_script("convert_for_short.py", str(path))
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Conversion failed")
    out = result.stdout.strip().splitlines()[-1]
    return Path(out).resolve()


def compose_video(raw_name: str, script: str) -> dict:
    raw_path = STAGES["raw"] / raw_name
    if not raw_path.is_file():
        raise FileNotFoundError(f"Raw recording not found: {raw_name}")

    result = subprocess.run(
        [
            python_executable(),
            str(PIPELINE_DIR / "compose_short.py"),
            str(raw_path),
            "--script",
            script,
            "--output-dir",
            str(STAGES["composed"]),
        ],
        text=True,
        capture_output=True,
    )
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or result.stderr.strip() or "Compose failed")

    out_path = Path(result.stdout.strip().splitlines()[-1]).resolve()
    if not out_path.is_file():
        out_path = STAGES["composed"] / f"{raw_path.stem}-final.mp4"

    return {
        "composed": out_path.name,
        "path": str(out_path),
    }


def offline_record_video(
    mode: str,
    matchup: list,
    intro_mode: str | None = None,
    intros: list | None = None,
) -> dict:
    """Run headless offline render → recordings/raw/."""
    if mode not in {"collision", "weapon"}:
        raise ValueError("mode must be collision or weapon")
    if not isinstance(matchup, list) or len(matchup) < 2:
        raise ValueError("matchup must include at least 2 fighters")

    arena_venv = ARENA_DIR / "venv" / "bin" / "python"
    py = str(arena_venv if arena_venv.is_file() else sys.executable)

    payload: dict = {"mode": mode, "matchup": matchup}
    if intro_mode and intro_mode != "skip":
        payload["introMode"] = intro_mode
        if isinstance(intros, list) and len(intros) >= 2:
            payload["intros"] = intros

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="offline-matchup-",
        delete=False,
    ) as tmp:
        json.dump(payload, tmp)
        payload_path = Path(tmp.name)

    stdout = ""
    proc = None
    try:
        # Inherit stderr so STEP offline: frame … lines stream live (capture_output
        # buffered them until the whole fight finished).
        proc = subprocess.Popen(
            [
                py,
                str(PIPELINE_DIR / "offline_record.py"),
                "--payload",
                str(payload_path),
                "--base-url",
                f"http://127.0.0.1:{PORT}",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=None,
        )
        try:
            stdout, _ = proc.communicate(timeout=180)
        except subprocess.TimeoutExpired as exc:
            proc.kill()
            proc.communicate()
            raise RuntimeError(
                "Offline record timed out after 180s — fight may be too long or Chrome hung"
            ) from exc
    finally:
        payload_path.unlink(missing_ok=True)

    stdout = stdout or ""
    if proc is None or proc.returncode != 0:
        raise RuntimeError(stdout.strip() or "Offline record failed")

    lines = [ln for ln in stdout.strip().splitlines() if ln.strip()]
    # offline_record.py prints a JSON object (possibly multi-line)
    raw_json = "\n".join(lines)
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        # Fallback: find the last JSON object in stdout
        start = raw_json.rfind("{")
        if start < 0:
            raise RuntimeError(raw_json or "Offline record returned no JSON")
        data = json.loads(raw_json[start:])

    file_name = data.get("file")
    if not file_name or not (STAGES["raw"] / file_name).is_file():
        raise RuntimeError(f"Offline record did not produce a file: {data!r}")

    return data


def upload_video(
    composed_name: str,
    title: str,
    description: str,
    privacy: str = PRIVACY_DEFAULT,
    tags: str = TAGS_DEFAULT,
    category: str = CATEGORY_DEFAULT,
) -> dict:
    composed_path = STAGES["composed"] / composed_name
    if not composed_path.is_file():
        raise FileNotFoundError(f"Composed video not found: {composed_name}")

    validation = validate_video(composed_path)
    upload_path = composed_path
    if not validation.get("ok"):
        upload_path = convert_video(composed_path)
        validation = validate_video(upload_path)
        if not validation.get("ok"):
            raise RuntimeError(f"Video invalid after convert: {validation.get('errors')}")

    args = [
        "--file",
        str(upload_path),
        "--title",
        title[:100],
        "--description",
        description,
        "--privacy",
        privacy,
        "--tags",
        tags,
        "--category",
        category,
    ]
    proc = subprocess.run(
        [python_executable(), str(YT_SCRIPTS / "upload_short.py"), *args],
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout.strip() or proc.stderr.strip() or "Upload failed")

    result = json.loads(proc.stdout)
    if tiktok_configured():
        try:
            result["tiktok"] = upload_tiktok(
                upload_path,
                title,
                description,
                privacy=privacy,
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            result["tiktokError"] = str(exc)

    posted_name = composed_name
    if upload_path != composed_path:
        posted_name = upload_path.name
    dest = STAGES["posted"] / posted_name
    shutil.move(str(upload_path), str(dest))
    if composed_path.is_file() and composed_path != upload_path:
        composed_path.unlink(missing_ok=True)

    result["postedFile"] = posted_name
    try:
        record_quota_upload(file=posted_name, title=title[:100])
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    return result


def tiktok_configured() -> bool:
    return (TIKTOK_DIR / "token.json").is_file() and (TIKTOK_DIR / ".env").is_file()


def upload_tiktok(
    video_path: Path,
    title: str,
    description: str = "",
    privacy: str = "private",
) -> dict:
    """Direct-post a local file to TikTok. Does not move pipeline files."""
    script = TIKTOK_SCRIPTS / "upload_short.py"
    if not script.is_file():
        raise RuntimeError(f"missing {script}")
    if not video_path.is_file():
        raise FileNotFoundError(f"TikTok video not found: {video_path}")
    mapped = privacy if privacy in {"public", "unlisted", "private"} else "private"
    proc = subprocess.run(
        [
            sys.executable,
            str(script),
            "--file",
            str(video_path),
            "--title",
            title[:100],
            "--description",
            description,
            "--privacy",
            mapped,
        ],
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout.strip() or proc.stderr.strip() or "TikTok upload failed")
    return json.loads(proc.stdout)


def _pacific_quota_day() -> str:
    """YouTube quota day key (resets midnight Pacific)."""
    try:
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:  # noqa: BLE001
        # Fallback: UTC-8ish without DST awareness.
        now = datetime.utcnow() - timedelta(hours=8)
    return now.strftime("%Y-%m-%d")


def _load_quota_log() -> dict:
    if not QUOTA_LOG_PATH.is_file():
        return {"days": {}}
    try:
        data = json.loads(QUOTA_LOG_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {"days": {}}
    if not isinstance(data, dict):
        return {"days": {}}
    days = data.get("days")
    if not isinstance(days, dict):
        data["days"] = {}
    return data


def _save_quota_log(data: dict) -> None:
    QUOTA_LOG_PATH.write_text(json.dumps(data, indent=2) + "\n")


def record_quota_upload(*, file: str = "", title: str = "") -> dict:
    """Log a successful upload against today's Pacific quota day."""
    day = _pacific_quota_day()
    data = _load_quota_log()
    days = data.setdefault("days", {})
    entry = days.get(day)
    if not isinstance(entry, dict):
        entry = {"uploads": [], "units": 0}
    uploads = entry.get("uploads")
    if not isinstance(uploads, list):
        uploads = []
    uploads.append(
        {
            "at": datetime.now(timezone.utc).isoformat(),
            "file": file,
            "title": title,
            "units": UPLOAD_COST_UNITS,
        }
    )
    entry["uploads"] = uploads[-50:]
    entry["units"] = int(entry.get("units") or 0) + UPLOAD_COST_UNITS
    days[day] = entry
    # Keep a short history.
    if len(days) > 14:
        for old in sorted(days.keys())[:-14]:
            days.pop(old, None)
    _save_quota_log(data)
    return entry


def quota_hint() -> dict:
    """Static costs + local estimate of remaining units (bot uploads only)."""
    day = _pacific_quota_day()
    data = _load_quota_log()
    entry = (data.get("days") or {}).get(day) or {}
    used = int(entry.get("units") or 0)
    uploads_today = len(entry.get("uploads") or []) if isinstance(entry.get("uploads"), list) else 0
    remaining = max(0, DEFAULT_DAILY_QUOTA - used)
    uploads_left = remaining // UPLOAD_COST_UNITS
    return {
        "uploadCostUnits": UPLOAD_COST_UNITS,
        "defaultDailyQuota": DEFAULT_DAILY_QUOTA,
        "estimatedUploadsPerDay": DEFAULT_DAILY_QUOTA // UPLOAD_COST_UNITS,
        "quotaDay": day,
        "usedUnitsToday": used,
        "remainingUnitsToday": remaining,
        "uploadsToday": uploads_today,
        "uploadsLeftToday": uploads_left,
        "note": (
            "YouTube does not expose live remaining quota via API. "
            "Numbers below are from this bot’s uploads today (Pacific day); "
            "Cloud Console is the source of truth if you upload elsewhere."
        ),
        "consoleUrl": "https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas",
    }


def pipeline_status() -> dict:
    raw = list_videos(STAGES["raw"])
    composed = list_videos(STAGES["composed"])
    posted = list_videos(STAGES["posted"])

    step = 1
    active_raw = raw[0]["name"] if raw else None
    active_composed = composed[0]["name"] if composed else None

    try:
        tourney = load_compose_tournament().status_payload()
    except Exception:  # noqa: BLE001
        tourney = {"finalReady": False, "final": None, "manifest": None}

    # Prefer the stitched tournament long-form file when ready.
    if tourney.get("finalReady") and tourney.get("final"):
        active_composed = tourney["final"]

    if active_raw:
        step = max(step, 2)
    if active_composed:
        step = max(step, 3)
    if not raw and not composed and posted:
        step = 4

    return {
        "stages": {
            "raw": raw,
            "composed": composed,
            "posted": posted,
        },
        "active": {
            "raw": active_raw,
            "composed": active_composed,
        },
        "unlockedStep": step,
        "recordComplete": bool(active_raw or active_composed or posted),
        "composeComplete": bool(active_composed or posted),
        "tournament": tourney,
    }


def _delete_stage_videos(*stage_keys: str) -> None:
    for key in stage_keys:
        folder = STAGES[key]
        for item in list_videos(folder):
            path = folder / item["name"]
            path.unlink(missing_ok=True)
            meta = path.with_suffix(".json")
            if meta.is_file():
                meta.unlink(missing_ok=True)


def revert_pipeline(step: str) -> dict:
    """Undo later work and return pipeline to the given step."""
    if step == "record":
        _delete_stage_videos("raw", "composed", "posted")
        try:
            load_compose_tournament().clear_tournament_media()
        except Exception:  # noqa: BLE001
            pass
    elif step == "compose":
        _delete_stage_videos("composed", "posted")
        try:
            load_compose_tournament().clear_tournament_media()
        except Exception:  # noqa: BLE001
            pass
    elif step == "youtube":
        posted = list_videos(STAGES["posted"])
        if posted:
            src = STAGES["posted"] / posted[0]["name"]
            dest = STAGES["composed"] / posted[0]["name"]
            if dest.exists():
                dest.unlink()
            shutil.move(str(src), str(dest))
    else:
        raise ValueError(f"Unknown workflow step: {step}")
    return pipeline_status()
