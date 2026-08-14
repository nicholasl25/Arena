"""Long tournament roster builders and stitch/segment API."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from .config import PIPELINE_DIR, PORT

_LONG_COLORS = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#84cc16",
    "#22c55e",
    "#14b8a6",
    "#06b6d4",
    "#0ea5e9",
    "#3b82f6",
    "#6366f1",
    "#8b5cf6",
    "#a855f7",
    "#d946ef",
    "#ec4899",
    "#f43f5e",
    "#78716c",
    "#b91c1c",
    "#c2410c",
    "#a16207",
    "#4d7c0f",
    "#15803d",
    "#0f766e",
    "#0e7490",
    "#0369a1",
    "#1d4ed8",
    "#4338ca",
    "#6d28d9",
    "#7e22ce",
    "#a21caf",
    "#be185d",
    "#9f1239",
    "#44403c",
]

_LONG_MAX_ENTRANTS = 32


def _ws():
    """Public shim — so patch.object(workflow_server, ...) still hits call sites."""
    import workflow_server as ws  # noqa: WPS433

    return ws


def build_long_tournament_roster(
    *,
    health: float = 60.0,
    radius: float = 36.0,
    skin_folder: str | None = None,
    weapon_ids: list[str] | None = None,
    skin_ids: list[str] | None = None,
) -> list[dict]:
    """Build a WorkflowBracket roster (shared health/radius for every ball).

    skin_folder set → skin tournament. Optional skin_ids picks a custom subset;
    omit it to use the whole folder (capped). Weapons from the form are the
    per-match weapon wheel (placeholder weapon until spin).
    skin_folder empty → tournament of the listed weapons (no skin / `_weapon`).
    """
    health = max(1.0, float(health))
    radius = max(0.1, float(radius))
    ws = _ws()
    all_weapons = {row["id"]: row["name"] for row in ws.list_weapon_options()}
    if not all_weapons:
        raise ValueError("no weapons available")

    picked = [str(w).strip() for w in (weapon_ids or []) if str(w).strip()]
    picked = [w for w in picked if w in all_weapons]
    folder = (skin_folder or "").strip()
    if folder.lower() in {"", "none"}:
        folder = ""

    roster: list[dict] = []
    if folder:
        if len(picked) < 2:
            raise ValueError("skin tournaments need at least 2 weapons for the weapon wheel")
        available = ws.list_skins_in_category(folder)
        by_id = {row["id"]: row for row in available}
        wanted = [str(s).strip() for s in (skin_ids or []) if str(s).strip()]
        if wanted:
            skins = [by_id[sid] for sid in wanted if sid in by_id]
            if len(skins) < 2:
                raise ValueError("pick at least 2 skins from the folder")
        else:
            skins = list(available)
            if len(skins) < 2:
                raise ValueError(f"skin folder `{folder}` needs at least 2 skins (found {len(skins)})")
        if len(skins) > _LONG_MAX_ENTRANTS:
            skins = skins[:_LONG_MAX_ENTRANTS]
        # Placeholder until each match's weapon wheel assigns the real loadout.
        placeholder = picked[0]
        for i, skin in enumerate(skins):
            color = skin.get("color") or _LONG_COLORS[i % len(_LONG_COLORS)]
            name = skin["name"]
            config = {
                "weaponId": placeholder,
                "health": health,
                "radius": radius,
                "name": name,
                "color": color,
            }
            roster.append(
                {
                    "id": skin["id"],
                    "name": name,
                    "color": color,
                    "weaponId": placeholder,
                    "skinId": skin["id"],
                    "slotIndex": i,
                    "slotKey": f"slot-{i}:{skin['id']}",
                    "arenaMatchup": {"id": skin["id"], "config": config},
                }
            )
    else:
        if len(picked) < 2:
            raise ValueError("pick at least 2 weapons (or choose a skins folder)")
        if len(picked) > _LONG_MAX_ENTRANTS:
            picked = picked[:_LONG_MAX_ENTRANTS]
        for i, wid in enumerate(picked):
            color = _LONG_COLORS[i % len(_LONG_COLORS)]
            name = all_weapons[wid]
            config = {
                "weaponId": wid,
                "health": health,
                "radius": radius,
                "name": name,
                "color": color,
            }
            roster.append(
                {
                    "id": "_weapon",
                    "name": name,
                    "color": color,
                    "weaponId": wid,
                    "skinId": None,
                    "slotIndex": i,
                    "slotKey": f"slot-{i}:_weapon:{wid}",
                    "arenaMatchup": {"id": "_weapon", "config": config},
                }
            )
    return roster


def _weapon_pool_entries(weapon_ids: list[str]) -> list[dict]:
    """[{id, name, icon, color}] for the weapon wheel."""
    names = {row["id"]: row["name"] for row in _ws().list_weapon_options()}
    # Icons mirrored from workflow/bracket-preview.js fallbacks.
    icons = {
        "sword": "premade-weapons/sprites/Sword.png",
        "dagger": "premade-weapons/sprites/Sword.png",
        "hammer": "premade-weapons/sprites/Stone_Hammer.png",
        "bow": "premade-weapons/sprites/Bow-unloaded.png",
        "slingshot": "premade-weapons/sprites/Slingshot.png",
        "basketball": "premade-weapons/sprites/Basketball.png",
        "grenade": "premade-weapons/sprites/Grenade.png",
        "staff": "premade-weapons/sprites/Staff.png",
    }
    out: list[dict] = []
    for i, wid in enumerate(weapon_ids):
        if wid not in names:
            continue
        out.append(
            {
                "id": wid,
                "name": names[wid],
                "icon": icons.get(wid),
                "color": _LONG_COLORS[i % len(_LONG_COLORS)],
            }
        )
    return out


def produce_long_tournament(
    roster: list[dict],
    *,
    powerup_spin: bool = True,
    weapon_spin: bool = False,
    weapon_ids: list[str] | None = None,
    skin_folder: str | None = None,
    on_progress=None,
    clear_first: bool = True,
) -> dict:
    """Record + stitch a full long YouTube tournament (same path as wf=long).

    Returns {ok, final, path, champion, segmentCount, matchKeys, roster}.
    """
    if not isinstance(roster, list) or len(roster) < 2:
        raise ValueError("roster needs at least 2 fighters")

    ws = _ws()
    ct = ws.load_compose_tournament()
    tr = ws.load_tournament_record()
    planner = PIPELINE_DIR / "tournament_plan.js"
    if not planner.is_file():
        raise RuntimeError(f"missing planner: {planner}")

    def progress(phase: str, detail: str = "") -> None:
        if on_progress:
            try:
                on_progress({"phase": phase, "detail": detail})
            except Exception:  # noqa: BLE001
                pass
        print(f"[long] {phase} {detail}".rstrip(), file=sys.stderr, flush=True)

    with tempfile.TemporaryDirectory(prefix="arena-long-") as tmp:
        tmp_dir = Path(tmp)
        state_path = tmp_dir / "state.json"
        match_path = tmp_dir / "match.json"
        roster_path = tmp_dir / "roster.json"
        opts_path = tmp_dir / "opts.json"
        roster_path.write_text(json.dumps(roster) + "\n")
        opts_path.write_text(
            json.dumps(
                {
                    "powerupSpin": bool(powerup_spin),
                    "weaponSpin": bool(weapon_spin),
                    "weaponPool": _weapon_pool_entries(
                        [str(w) for w in (weapon_ids or []) if str(w).strip()]
                    ),
                }
            )
            + "\n"
        )

        def node(*args: str, check: bool = True) -> subprocess.CompletedProcess:
            return subprocess.run(
                ["node", str(planner), *args],
                check=check,
                capture_output=True,
                text=True,
            )

        progress("init", f"{len(roster)} entrants")
        init = node("init", str(state_path), str(roster_path), check=False)
        if init.returncode != 0:
            raise RuntimeError(init.stderr.strip() or init.stdout.strip() or "planner init failed")
        node("options", str(state_path), str(opts_path))

        if clear_first:
            progress("clear", "previous tournament media")
            ct.clear_tournament_media()

        match_keys: list[str] = []
        while True:
            nxt = node("next", str(state_path), str(match_path), check=False)
            if nxt.returncode == 2:
                break
            if nxt.returncode != 0:
                raise RuntimeError(nxt.stderr.strip() or nxt.stdout.strip() or "planner next failed")
            req = json.loads(match_path.read_text())
            key = req["matchKey"]
            match_keys.append(key)
            label = f"{req.get('aName')} vs {req.get('bName')}"
            progress("match", f"{len(match_keys)} · {label} · {req.get('spinSummary') or ''}")
            result = tr.ensure_match_segment_media(
                match_key=key,
                script=req["script"],
                order_index=int(req["order"]),
                mode=req.get("mode") or "weapon",
                matchup=req["matchup"],
                a_name=req.get("aName"),
                b_name=req.get("bName"),
                winner_name=req.get("winnerName"),
                loser_name=req.get("loserName"),
                base_url=f"http://127.0.0.1:{PORT}",
                force=True,
                synthetic_arena=False,
                bracket_pre=req.get("bracketPre"),
                bracket_post=req.get("bracketPost"),
                active_match=req.get("activeMatch"),
                last_winner=req.get("lastWinner"),
                last_loser=req.get("lastLoser"),
                powerup_spins=req.get("powerupSpins"),
                weapon_spins=req.get("weaponSpins"),
            )
            winner = result.get("winnerName") or (result.get("arena") or {}).get("winner")
            if not winner:
                raise RuntimeError(f"arena produced no winner for {key}")
            seg = result.get("segment") or {}
            progress(
                "segment",
                f"{seg.get('file')} ({seg.get('duration')}s) winner={winner}",
            )
            apply = node("apply", str(state_path), str(winner), check=False)
            if apply.returncode != 0:
                raise RuntimeError(apply.stderr.strip() or "planner apply failed")

        bag = json.loads(state_path.read_text())
        champion = bag.get("championName") or (bag.get("state") or {}).get("champion", {}).get(
            "name"
        )
        if not champion:
            raise RuntimeError("bracket did not produce a champion")
        progress("stitch", f"champion {champion}")
        fighters = (
            bag.get("state", {}).get("fighters")
            if isinstance(bag.get("state"), dict)
            else roster
        )
        intro_title = ct.build_intro_title(
            [f.get("name") for f in roster],
            skin_folder=skin_folder if weapon_spin else None,
            weapon_mode=not bool(weapon_spin),
            entrant_count=len(roster),
        )
        intro = ct.ensure_intro_clip(
            [f.get("name") for f in roster],
            weapon_spin=bool(weapon_spin),
            powerup_spin=bool(powerup_spin),
            title=intro_title,
            skin_folder=skin_folder if weapon_spin else None,
            fighters=fighters,
            champion_name=champion,
            base_url=f"http://127.0.0.1:{PORT}",
            weapon_mode=not bool(weapon_spin),
        )
        outro = ct.ensure_outro_clip(
            champion,
            title=intro_title,
            fighters=fighters,
            weapon_mode=not bool(weapon_spin),
            base_url=f"http://127.0.0.1:{PORT}",
        )
        stitched = ct.stitch_final(
            intro_clip=intro,
            champion_clip=outro,
            champion_name=champion,
            force=True,
            expected_count=len(match_keys),
            match_keys=match_keys,
        )
        final_name = stitched.get("final") or "tournament-final.mp4"
        path = Path(stitched.get("path") or ct.FINAL_PATH)
        progress("done", f"{final_name} segments={len(match_keys)}")
        return {
            "ok": True,
            "final": final_name,
            "path": str(path),
            "champion": champion,
            "segmentCount": len(match_keys),
            "matchKeys": match_keys,
            "roster": [f.get("name") for f in roster],
            "pipeline": ws.pipeline_status(),
        }


def tournament_ensure_segment(body: dict) -> dict:
    if str(PIPELINE_DIR) not in sys.path:
        sys.path.insert(0, str(PIPELINE_DIR))
    import validate_schema  # noqa: WPS433

    validate_schema.require_match_segment_request(body)
    match_key = str(body.get("matchKey") or "").strip()
    script = str(body.get("script") or "").strip()
    matchup = body.get("matchup")
    if not match_key or not script:
        raise ValueError("matchKey and script required")
    if not isinstance(matchup, list) or len(matchup) != 2:
        raise ValueError("matchup must be exactly two fighters")

    ws = _ws()
    tr = ws.load_tournament_record()
    mode = (body.get("mode") or "collision").strip()
    order = int(body.get("order") or 0)
    force = bool(body.get("force"))
    # Default to synthetic arena when requested (tests) or when offline record is too heavy;
    # production browser path can pass syntheticArena:false for real fights.
    synthetic = body.get("syntheticArena")
    if synthetic is None:
        synthetic = False

    print(
        f"[workflow] ensure-segment {match_key} order={order} synthetic={bool(synthetic)}",
        file=sys.stderr,
        flush=True,
    )
    result = tr.ensure_match_segment_media(
        match_key=match_key,
        script=script,
        order_index=order,
        mode=mode,
        matchup=matchup,
        a_name=body.get("aName"),
        b_name=body.get("bName"),
        winner_name=body.get("winnerName"),
        loser_name=body.get("loserName"),
        base_url=f"http://127.0.0.1:{PORT}",
        force=force,
        synthetic_arena=bool(synthetic),
        bracket_pre=body.get("bracketPre") if isinstance(body.get("bracketPre"), dict) else None,
        bracket_post=body.get("bracketPost") if isinstance(body.get("bracketPost"), dict) else None,
        active_match=body.get("activeMatch") if isinstance(body.get("activeMatch"), dict) else None,
        last_winner=body.get("lastWinner") if isinstance(body.get("lastWinner"), dict) else None,
        last_loser=body.get("lastLoser") if isinstance(body.get("lastLoser"), dict) else None,
        powerup_spins=body.get("powerupSpins") if isinstance(body.get("powerupSpins"), dict) else None,
        weapon_spins=body.get("weaponSpins") if isinstance(body.get("weaponSpins"), dict) else None,
    )
    return {
        "ok": True,
        **result,
        "composed": (result.get("segment") or {}).get("file"),
        "pipeline": ws.pipeline_status(),
    }


def tournament_stitch(body: dict | None = None) -> dict:
    body = body or {}
    ws = _ws()
    ct = ws.load_compose_tournament()
    champ_label = str(body.get("championName") or "CHAMPION")
    match_keys = body.get("matchKeys")
    if match_keys is not None:
        if not isinstance(match_keys, list) or not all(
            isinstance(key, str) and key for key in match_keys
        ):
            raise ValueError("matchKeys must be an ordered list of match identities")
        if len(set(match_keys)) != len(match_keys):
            raise ValueError("matchKeys must not contain duplicates")
    bracket_state = body.get("bracketState") if isinstance(body.get("bracketState"), dict) else None
    print(
        f"[workflow] stitch expected={body.get('expectedCount')} champion={champ_label}",
        file=sys.stderr,
        flush=True,
    )
    names = body.get("rosterNames")
    if not isinstance(names, list):
        names = ct.fighter_names_from_bracket(bracket_state)
    names = [str(n) for n in names if str(n).strip()]
    weapon_spin = body.get("weaponSpin")
    if not isinstance(weapon_spin, bool):
        weapon_spin = ct.is_skin_tournament(bracket_state)
    powerup_spin = body.get("powerupSpin")
    if not isinstance(powerup_spin, bool):
        powerup_spin = True
    fighters = None
    if isinstance(bracket_state, dict) and isinstance(bracket_state.get("fighters"), list):
        fighters = bracket_state["fighters"]
    title = body.get("title")
    folder = body.get("skinFolder") or body.get("skin_folder")
    if not folder and fighters:
        folder = ct.skin_folder_from_fighters(fighters)
    if not isinstance(title, str) or not title.strip():
        title = ct.build_intro_title(
            names,
            skin_folder=folder if weapon_spin else None,
            weapon_mode=not weapon_spin,
            entrant_count=len(names),
        )
    intro = ct.ensure_intro_clip(
        names,
        weapon_spin=weapon_spin,
        powerup_spin=powerup_spin,
        title=title,
        skin_folder=folder if weapon_spin else None,
        fighters=fighters,
        champion_name=champ_label,
        base_url=f"http://127.0.0.1:{PORT}",
        weapon_mode=not weapon_spin,
    )
    outro = ct.ensure_outro_clip(
        champ_label,
        title=title,
        fighters=fighters,
        weapon_mode=not weapon_spin,
        base_url=f"http://127.0.0.1:{PORT}",
    )
    result = ct.stitch_final(
        intro_clip=intro,
        champion_clip=outro,
        champion_name=champ_label,
        force=bool(body.get("force")),
        expected_count=body.get("expectedCount"),
        match_keys=match_keys,
    )
    return {"ok": True, **result, "pipeline": ws.pipeline_status()}


def tournament_preview(body: dict | None = None) -> dict:
    body = body or {}
    ws = _ws()
    ct = ws.load_compose_tournament()
    result = ct.stitch_preview(force=bool(body.get("force")))
    return {"ok": True, **result, "pipeline": ws.pipeline_status()}
