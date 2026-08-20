"""Auto-post setup, candidate jobs, and short production."""
from __future__ import annotations

import json
import secrets
import sys
import time
import traceback

from .assets import list_intro_options, list_powerup_options
from .captions import build_description, build_title
from .config import JOBS_DIR, SETUP_PATH, STAGES
from .pipeline_ops import (
    compose_video,
    draft_script,
    fighter_display_names,
    load_prompt_matchup,
    offline_record_video,
    pipeline_status,
    upload_video,
)


def save_auto_post_setup(payload: dict) -> dict:
    mode = (payload.get("mode") or "collision").strip()
    matchup = payload.get("matchup")
    if mode not in {"collision", "weapon"}:
        raise ValueError("mode must be collision or weapon")
    if not isinstance(matchup, list) or len(matchup) < 2:
        raise ValueError("matchup must include at least 2 fighters")
    intro_mode = payload.get("introMode") or "skip"
    if intro_mode not in {"skip", "default", "manual"}:
        raise ValueError("introMode must be skip, default, or manual")
    intros = payload.get("intros")
    if intro_mode != "skip" and (not isinstance(intros, list) or len(intros) < 2):
        raise ValueError("intros required when introMode is not skip")
    data = {
        "mode": mode,
        "matchup": matchup,
        "introMode": intro_mode,
        "intros": intros if isinstance(intros, list) else [],
    }
    if payload.get("prompt"):
        data["prompt"] = str(payload["prompt"])
    if payload.get("resolved"):
        data["resolved"] = payload["resolved"]
    SETUP_PATH.write_text(json.dumps(data, indent=2) + "\n")
    return data


def load_auto_post_setup() -> dict | None:
    if not SETUP_PATH.is_file():
        return None
    try:
        data = json.loads(SETUP_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    matchup = data.get("matchup")
    if not isinstance(matchup, list) or len(matchup) < 2:
        return None
    return data


def setup_from_request(body: dict | None = None, prompt: str | None = None) -> dict:
    """Build matchup from explicit body, NL prompt, or last saved setup."""
    body = body or {}
    text = (prompt or body.get("prompt") or "").strip()
    if text:
        setup = load_prompt_matchup().resolve_prompt_matchup(text)
        return save_auto_post_setup(setup)
    if body.get("matchup"):
        return save_auto_post_setup(body)
    saved = load_auto_post_setup()
    if saved:
        return saved
    raise ValueError(
        'Send a prompt like "Make a video of Daemon and Aragorn fighting with swords", '
        "or finish Make setup + Make intro in the workflow UI first"
    )


def produce_one_short(setup: dict, on_stage=None) -> dict:
    """Record + compose + caption for one take (no YouTube upload).

    If compose fails after a successful record, still returns the raw clip so
    Slack can preview / post (compose runs again on YouTube upload).
    """
    mode = setup.get("mode") or "collision"
    matchup = setup["matchup"]
    intro_mode = setup.get("introMode") or "skip"
    intros = setup.get("intros") if intro_mode != "skip" else None

    if on_stage:
        on_stage("recording")
    record = offline_record_video(mode, matchup, intro_mode=intro_mode, intros=intros)
    raw_name = record["file"]
    winner = record.get("winner")
    raw_path = STAGES["raw"] / raw_name
    fighter_names, _ = fighter_display_names(raw_name)
    if len(fighter_names) < 2:
        meta = record.get("fighters") or []
        fighter_names = [
            str(f.get("name") if isinstance(f, dict) else f).strip()
            for f in meta
            if (f.get("name") if isinstance(f, dict) else f)
        ]

    if on_stage:
        on_stage("composing", winner=winner)
    script = ""
    composed_name = None
    path = raw_path
    compose_error = None
    try:
        script = draft_script(raw_name)
        composed = compose_video(raw_name, script)
        composed_name = composed["composed"]
        path = STAGES["composed"] / composed_name
        fighters, _ = fighter_display_names(composed_name)
        if len(fighters) >= 2:
            fighter_names = fighters
    except Exception as exc:  # noqa: BLE001
        compose_error = str(exc)
        print(f"compose failed for {raw_name}: {exc}", file=sys.stderr)
        traceback.print_exc()
        if not script:
            script = " vs ".join(fighter_names[:2]) if len(fighter_names) >= 2 else "Ball Arena fight"

    title = build_title(fighter_names)
    description = build_description(*fighter_names[:2]) if len(fighter_names) >= 2 else build_description("Fighter A", "Fighter B")
    intro_frames = int(record.get("introFrames") or 0)
    if on_stage:
        on_stage(
            "done",
            winner=winner,
            composed=composed_name,
            raw_only=composed_name is None,
        )
    out = {
        "raw": raw_name,
        "composed": composed_name,
        "path": str(path),
        "title": title,
        "description": description,
        "winner": winner,
        "script": script,
        "introFrames": intro_frames,
        "hasIntro": bool(record.get("hasIntro") or intro_frames),
    }
    if compose_error:
        out["composeError"] = compose_error
    return out


def generate_short_candidates(
    setup: dict | None = None,
    prompt: str | None = None,
    count: int = 3,
    on_progress=None,
    on_candidate=None,
) -> dict:
    """Produce N independent takes; caller picks one to upload.

    on_progress receives dicts like:
      {"take": 1, "total": 3, "phase": "recording"|"composing"|"done", ...}
    on_candidate(index, take, total) is called after each successful take
    (including raw-only fallbacks) so Slack can upload incrementally.
    """
    data = setup or setup_from_request(prompt=prompt)
    n = max(1, min(int(count), 5))
    candidates: list[dict] = []
    errors: list[str] = []
    for i in range(n):
        take_num = i + 1

        def on_stage(phase: str, take=take_num, **extra) -> None:
            if not on_progress:
                return
            on_progress({"take": take, "total": n, "phase": phase, **extra})

        try:
            take = produce_one_short(data, on_stage=on_stage)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            errors.append(f"Take {take_num}: {exc}")
            if on_progress:
                on_progress(
                    {
                        "take": take_num,
                        "total": n,
                        "phase": "error",
                        "error": str(exc),
                    }
                )
            continue
        candidates.append(take)
        if on_candidate:
            on_candidate(len(candidates) - 1, take, n)

    if not candidates:
        raise RuntimeError(
            "; ".join(errors) if errors else "No takes produced"
        )

    job_id = secrets.token_hex(8)
    job = {
        "jobId": job_id,
        "createdAt": time.time(),
        "prompt": data.get("prompt"),
        "resolved": data.get("resolved"),
        "setup": {
            "mode": data.get("mode"),
            "matchup": data.get("matchup"),
            "introMode": data.get("introMode"),
            "intros": data.get("intros"),
        },
        "candidates": candidates,
        "errors": errors,
    }
    save_candidate_job(job)
    return {"ok": True, **job}


def upload_candidate(
    job_id: str,
    index: int,
    *,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """YouTube-upload one take from a candidate job."""
    job = load_candidate_job(job_id)
    if not job:
        raise ValueError(f"Unknown job: {job_id}")
    candidates = job.get("candidates") or []
    if index < 0 or index >= len(candidates):
        raise ValueError(f"Candidate index out of range: {index}")
    take = candidates[index]
    composed_name = take.get("composed")
    composed_path = (
        STAGES["composed"] / composed_name if composed_name else None
    )
    if not composed_path or not composed_path.is_file():
        raw_name = take.get("raw")
        if not raw_name:
            raise ValueError("Take has no composed or raw video")
        script = take.get("script") or draft_script(raw_name)
        composed = compose_video(raw_name, script)
        composed_name = composed["composed"]
        take["composed"] = composed_name
        take["path"] = str(STAGES["composed"] / composed_name)
        take.pop("composeError", None)
        save_candidate_job(job)
    if title is not None:
        take["title"] = str(title).strip()[:100]
    if description is not None:
        take["description"] = str(description)
    save_candidate_job(job)
    uploaded = upload_video(
        composed_name,
        take["title"],
        take["description"],
        raw_name=take.get("raw"),
    )
    return {
        "ok": True,
        "jobId": job_id,
        "index": index,
        "title": take["title"],
        "description": take["description"],
        "composed": composed_name,
        **uploaded,
        "pipeline": pipeline_status(),
    }


def save_candidate_job(job: dict) -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    path = JOBS_DIR / f"{job['jobId']}.json"
    path.write_text(json.dumps(job, indent=2) + "\n")


def load_candidate_job(job_id: str) -> dict | None:
    path = JOBS_DIR / f"{job_id}.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def latest_undecided_candidate_job() -> dict | None:
    """Most recent candidate job that still needs a Post / Don't post choice."""
    if not JOBS_DIR.is_dir():
        return None
    best: dict | None = None
    best_mtime = -1.0
    for path in JOBS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict) or data.get("decided"):
            continue
        if not data.get("candidates"):
            continue
        mtime = path.stat().st_mtime
        if mtime > best_mtime:
            best_mtime = mtime
            best = data
    return best


def setup_from_weapon_form(
    fighter_a: str,
    fighter_b: str,
    weapon_a: str | None = None,
    weapon_b: str | None = None,
) -> dict:
    """Build a weapon matchup from form fields (Slack / workflow-style)."""
    a = (fighter_a or "").strip()
    b = (fighter_b or "").strip()
    if not a or not b:
        raise ValueError("fighter A and fighter B are required")
    wa = (weapon_a or "sword").strip() or "sword"
    wb = (weapon_b or wa).strip() or wa
    prompt = f"{a} and {b} fighting with {wa} and {wb}"
    return save_auto_post_setup(load_prompt_matchup().resolve_prompt_matchup(prompt))


def setup_from_arena_form(
    *,
    mode: str,
    slots: list[dict],
    intro_mode: str | None = None,
    intros: list[str] | None = None,
) -> dict:
    """Build matchup from Slack/workflow-style per-fighter slots."""
    mode = (mode or "weapon").strip()
    if mode not in {"collision", "weapon"}:
        raise ValueError("mode must be collision or weapon")
    if not isinstance(slots, list) or len(slots) < 2:
        raise ValueError("need at least 2 fighters")
    if len(slots) > 6:
        raise ValueError("max 6 fighters")

    pm = load_prompt_matchup()
    weapons = pm.load_weapon_names()
    powerups = {row["id"]: row["name"] for row in list_powerup_options()}
    matchup: list[dict] = []
    resolved_names: list[str] = []
    resolved_weapons: list[str] = []

    for i, slot in enumerate(slots):
        name = str(slot.get("name") or "").strip()
        name_key = name.lower()
        if not name or name_key in {"none", "_weapon"}:
            if mode == "weapon":
                # Arena default: colored ball, no skin image (`_weapon`).
                fid, display = "_weapon", "Weapon"
            else:
                balls = pm.load_ball_fighters()
                if not balls:
                    raise ValueError(f"fighter {i + 1}: no premade balls available")
                fid = next(iter(sorted(balls.keys())))
                display = balls[fid]
        else:
            fid, display = pm.resolve_fighter_name(name, mode=mode)
        config: dict = {}

        health = slot.get("health")
        if health is not None and str(health).strip() != "":
            try:
                config["health"] = max(1.0, float(health))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"fighter {i + 1}: invalid health") from exc

        radius = slot.get("radius")
        if radius is not None and str(radius).strip() != "":
            try:
                config["radius"] = max(0.1, float(radius))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"fighter {i + 1}: invalid radius") from exc

        if mode == "collision":
            mass = slot.get("mass")
            if mass is not None and str(mass).strip() != "":
                try:
                    config["mass"] = max(0.1, float(mass))
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"fighter {i + 1}: invalid mass") from exc
        else:
            weapon_id = str(slot.get("weaponId") or "sword").strip() or "sword"
            if weapon_id not in weapons:
                raise ValueError(f"fighter {i + 1}: unknown weapon {weapon_id}")
            config["weaponId"] = weapon_id
            resolved_weapons.append(weapons[weapon_id])
            if fid == "_weapon":
                display = weapons[weapon_id]

        powerup_id = str(slot.get("powerupId") or "").strip()
        if powerup_id and powerup_id not in {"none", "null"}:
            if powerup_id not in powerups:
                raise ValueError(f"fighter {i + 1}: unknown powerup {powerup_id}")
            config["powerupId"] = powerup_id

        matchup.append({"id": fid, "config": config})
        resolved_names.append(display)

    resolved_intro_mode, resolved_intros = _resolve_intro_choice(intro_mode, intros)
    return save_auto_post_setup(
        {
            "mode": mode,
            "matchup": matchup,
            "introMode": resolved_intro_mode,
            "intros": resolved_intros,
            "resolved": {
                "fighters": resolved_names,
                "weapons": resolved_weapons,
            },
        }
    )


def _resolve_intro_choice(
    intro_mode: str | None,
    intros: list[str] | None,
) -> tuple[str, list[str]]:
    """Normalize Slack/UI intro choice to (introMode, intros)."""
    mode = (intro_mode or "default").strip().lower()
    available = {row["id"]: row["name"] for row in list_intro_options()}

    if mode in {"skip", "off", "none", "false"}:
        return "skip", []

    if mode == "default":
        return load_prompt_matchup().default_intro_mode()

    # manual / custom
    picks = [str(x).strip().lower() for x in (intros or []) if str(x).strip()]
    picks = [p for p in picks if p not in {"none", "null", ""}]
    if len(picks) < 2:
        raise ValueError("custom intro needs intro A and intro B")
    for pid in picks[:2]:
        if pid not in available:
            raise ValueError(f"unknown intro: {pid}")
    return "manual", picks[:2]
