""" /random-short — last setup, random weapons + powerups (skins/stats fixed). """

from __future__ import annotations

import copy
import random
import traceback

from ._common import reply, resolve_channel, run_async


def _randomize_loadout(setup: dict, ws) -> dict:
    """Keep fighter ids + health/radius/mass; shuffle weaponId + powerupId."""
    data = copy.deepcopy(setup)
    mode = data.get("mode") or "weapon"
    matchup = data.get("matchup")
    if not isinstance(matchup, list) or len(matchup) < 2:
        raise ValueError("No saved matchup — run `/short` once first")

    weapon_rows = ws.list_weapon_options()
    weapon_ids = [row["id"] for row in weapon_rows]
    weapon_names = {row["id"]: row["name"] for row in weapon_rows}
    powerup_ids = [row["id"] for row in ws.list_powerup_options()]
    if not weapon_ids:
        weapon_ids = ["sword"]
        weapon_names = {"sword": "Sword"}

    prev = data.get("resolved") or {}
    fighters = list(prev.get("fighters") or [])
    resolved_weapons: list[str] = []

    for i, slot in enumerate(matchup):
        if not isinstance(slot, dict):
            continue
        config = dict(slot.get("config") or {})
        # Preserve health / radius / mass; only touch weapon + powerup.
        if mode == "weapon":
            wid = random.choice(weapon_ids)
            config["weaponId"] = wid
            wname = weapon_names.get(wid, wid)
            resolved_weapons.append(wname)
            if slot.get("id") == "_weapon":
                while len(fighters) <= i:
                    fighters.append(wname)
                fighters[i] = wname
        if powerup_ids and random.random() < 0.65:
            config["powerupId"] = random.choice(powerup_ids)
        else:
            config.pop("powerupId", None)
        slot["config"] = config

    data["introMode"] = data.get("introMode") or "skip"
    if data["introMode"] == "skip":
        data["intros"] = []
    data["resolved"] = {
        "fighters": fighters,
        "weapons": resolved_weapons if mode == "weapon" else [],
    }
    return ws.save_auto_post_setup(data)


def _loadout_summary(setup: dict) -> str:
    resolved = setup.get("resolved") or {}
    fighters = resolved.get("fighters") or []
    weapons = resolved.get("weapons") or []
    label = " vs ".join(str(x) for x in fighters) if fighters else "matchup"
    if weapons:
        label += f" ({' / '.join(str(w) for w in weapons)})"
    bits = []
    for slot in setup.get("matchup") or []:
        if not isinstance(slot, dict):
            continue
        cfg = slot.get("config") or {}
        pu = cfg.get("powerupId")
        if pu:
            bits.append(str(pu))
    if bits:
        label += f" · powerups: {', '.join(bits)}"
    return label


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]
    run_candidates = ctx["run_candidates_job"]

    @app.command("/random-short")
    def cmd_random_short(ack, body, client):
        ack()
        user = body["user_id"]

        def work():
            try:
                saved = ws.load_auto_post_setup()
                if not saved:
                    reply(
                        client,
                        body,
                        "No saved setup — run `/short` once to lock skins/stats, "
                        "then `/random-short` will reshuffle weapons + powerups.",
                    )
                    return
                setup = _randomize_loadout(saved, ws)
                label = _loadout_summary(setup)
                ch = resolve_channel(client, body)
                client.chat_postMessage(
                    channel=ch,
                    text=(
                        f"<@{user}> *Random short* — same skins/stats, new weapons/powerups:\n"
                        f"*{label}*\nGenerating *1* take…"
                    ),
                )
                run_candidates(
                    client, channel=ch, user=user, setup=setup, count=1
                )
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                reply(client, body, f"`/random-short` failed: `{exc}`")

        run_async(work)
