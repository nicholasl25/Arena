""" /long — Long YouTube tournament (shared stats; skins list OR weapons list). """

from __future__ import annotations

import json
import traceback
from pathlib import Path

from ._common import caption_modal, field_value, reply, resolve_channel, run_async


def _field(values: dict | None, block_id: str) -> str | None:
    if not values:
        return None
    block = values.get(block_id) or {}
    if not isinstance(block, dict) or not block:
        return None
    entry = block.get("value")
    if not isinstance(entry, dict):
        entry = next((v for v in block.values() if isinstance(v, dict)), {}) or {}
    if "selected_option" in entry:
        opt = entry.get("selected_option") or {}
        return opt.get("value")
    if "selected_options" in entry:
        opts = entry.get("selected_options") or []
        return ",".join(
            str(o.get("value") or "") for o in opts if isinstance(o, dict) and o.get("value")
        )
    return entry.get("value")


def _multi_values(values: dict | None, block_id: str) -> list[str]:
    raw = _field(values, block_id) or ""
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _static_select(*, options: list[dict], initial: str | None, placeholder: str, action_id: str = "value") -> dict:
    el: dict = {
        "type": "static_select",
        "action_id": action_id,
        "options": options,
        "placeholder": {"type": "plain_text", "text": placeholder[:75]},
    }
    if initial:
        for opt in options:
            if opt.get("value") == initial:
                el["initial_option"] = opt
                break
    return el


def _multi_static_select(
    *,
    options: list[dict],
    placeholder: str,
    initial: list[str] | None = None,
    max_selected: int | None = None,
) -> dict:
    el: dict = {
        "type": "multi_static_select",
        "action_id": "value",
        "options": options[:100],
        "placeholder": {"type": "plain_text", "text": placeholder[:75]},
    }
    if max_selected and max_selected > 0:
        el["max_selected_items"] = max_selected
    if initial:
        chosen = [opt for opt in options if opt.get("value") in set(initial)]
        if chosen:
            el["initial_options"] = chosen[:32]
    return el


def _select_options(rows: list[dict], *, id_key: str = "id", name_key: str = "name") -> list[dict]:
    return [
        {
            "text": {"type": "plain_text", "text": str(row[name_key])[:75]},
            "value": str(row[id_key]),
        }
        for row in rows
    ]


def _long_modal(
    ws,
    *,
    channel: str = "",
    health: str = "75",
    radius: str = "33",
    powerups: str = "on",
    folder: str = "none",
    skin_pick: str = "all",
    weapon_ids: list[str] | None = None,
    skin_ids: list[str] | None = None,
) -> dict:
    cats = [{"text": {"type": "plain_text", "text": "None (weapons tournament)"}, "value": "none"}]
    for name in ws.list_skin_categories():
        cats.append(
            {
                "text": {"type": "plain_text", "text": name[:75]},
                "value": name,
            }
        )
    weapons = _select_options(ws.list_weapon_options())
    power_opts = [
        {"text": {"type": "plain_text", "text": "On (spin before each fight)"}, "value": "on"},
        {"text": {"type": "plain_text", "text": "Off"}, "value": "off"},
    ]
    folder = (folder or "none").strip() or "none"
    skin_pick = "custom" if (skin_pick or "").strip().lower() == "custom" else "all"
    skin_opts: list[dict] = []
    if folder.lower() != "none":
        try:
            skin_opts = _select_options(ws.list_skins_in_category(folder))
        except ValueError:
            skin_opts = []
    wanted_skins = [sid for sid in (skin_ids or []) if any(o["value"] == sid for o in skin_opts)]
    skin_count = len(skin_opts)
    all_label = (
        f"Select all ({skin_count} in folder)"
        if skin_count
        else "Select all in folder"
    )
    pick_opts = [
        {"text": {"type": "plain_text", "text": all_label[:75]}, "value": "all"},
        {"text": {"type": "plain_text", "text": "Pick skins…"}, "value": "custom"},
    ]
    blocks: list[dict] = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        "*Long YouTube* — same health/radius for every ball.\n"
                        "• *Skins folder* → *Select all* or pick *2–32 skins*, "
                        "plus *2+ weapons* for the per-match weapon wheel\n"
                        "• Folder *None* → weapons tournament from your weapons list"
                    ),
                },
            },
            {
                "type": "input",
                "block_id": "health",
                "optional": True,
                "label": {"type": "plain_text", "text": "Health (all balls)"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "value",
                    "initial_value": str(health or "75")[:20],
                    "placeholder": {"type": "plain_text", "text": "75"},
                },
            },
            {
                "type": "input",
                "block_id": "radius",
                "optional": True,
                "label": {"type": "plain_text", "text": "Radius (all balls)"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "value",
                    "initial_value": str(radius or "33")[:20],
                    "placeholder": {"type": "plain_text", "text": "33"},
                },
            },
            {
                "type": "input",
                "block_id": "powerups",
                "label": {"type": "plain_text", "text": "Powerup spins"},
                "element": _static_select(
                    options=power_opts,
                    initial=powerups if powerups in {"on", "off"} else "on",
                    placeholder="Powerups",
                ),
            },
            {
                "type": "input",
                "block_id": "skin_folder",
                "optional": True,
                "dispatch_action": True,
                "label": {"type": "plain_text", "text": "Skins folder"},
                "element": _static_select(
                    options=cats[:100],
                    initial=folder if any(c["value"] == folder for c in cats) else "none",
                    placeholder="Folder",
                    action_id="long_skin_folder",
                ),
            },
    ]
    if skin_opts:
        blocks.append(
            {
                "type": "input",
                "block_id": "skin_pick",
                "dispatch_action": True,
                "label": {"type": "plain_text", "text": "Skin roster"},
                "hint": {
                    "type": "plain_text",
                    "text": "Select all uses the folder (capped at 32). Pick skins for a custom 2–32.",
                },
                "element": _static_select(
                    options=pick_opts,
                    initial=skin_pick,
                    placeholder="Roster",
                    action_id="long_skin_pick",
                ),
            }
        )
        if skin_pick == "custom":
            blocks.append(
                {
                    "type": "input",
                    "block_id": "skins",
                    "optional": True,
                    "label": {"type": "plain_text", "text": "Skins"},
                    "hint": {
                        "type": "plain_text",
                        "text": "Pick 2–32 skins from this folder.",
                    },
                    "element": _multi_static_select(
                        options=skin_opts,
                        placeholder="Select skins…",
                        initial=wanted_skins,
                        max_selected=32,
                    ),
                }
            )
    blocks.append(
            {
                "type": "input",
                "block_id": "weapons",
                "optional": True,
                "label": {"type": "plain_text", "text": "Weapons"},
                "hint": {
                    "type": "plain_text",
                    "text": "Required (2+). Skin tournaments: weapon wheel pool. Weapons tournaments: entrants (max 32).",
                },
                "element": _multi_static_select(
                    options=weapons,
                    placeholder="Select weapons…",
                    initial=weapon_ids,
                    max_selected=32,
                ),
            },
    )
    return {
        "type": "modal",
        "callback_id": "long_setup",
        "private_metadata": channel or "",
        "title": {"type": "plain_text", "text": "Long tournament"},
        "submit": {"type": "plain_text", "text": "Record"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": blocks,
    }


def _read_long_state(
    values: dict | None,
    *,
    folder: str | None = None,
    skin_pick: str | None = None,
) -> dict:
    pick = (
        skin_pick
        if skin_pick is not None
        else (_field(values, "skin_pick") or "all")
    )
    pick = "custom" if str(pick).strip().lower() == "custom" else "all"
    return {
        "health": (_field(values, "health") or "75").strip() or "75",
        "radius": (_field(values, "radius") or "33").strip() or "33",
        "powerups": (_field(values, "powerups") or "on").strip() or "on",
        "folder": (folder if folder is not None else (_field(values, "skin_folder") or "none")).strip()
        or "none",
        "skin_pick": pick,
        "weapon_ids": _multi_values(values, "weapons"),
        "skin_ids": _multi_values(values, "skins") if pick == "custom" else [],
    }


def _parse_long_form(ws, values: dict) -> tuple[list[dict], dict, str]:
    state = _read_long_state(values)
    try:
        health = float(state["health"])
    except (TypeError, ValueError) as exc:
        raise ValueError("health must be a number") from exc
    try:
        radius = float(state["radius"])
    except (TypeError, ValueError) as exc:
        raise ValueError("radius must be a number") from exc
    folder = state["folder"]
    if folder.lower() == "none":
        folder = None
    weapon_ids = state["weapon_ids"]
    # Select all → empty skin_ids (whole folder). Custom → chosen list.
    skin_ids = state["skin_ids"] if folder and state["skin_pick"] == "custom" else []
    powerup_spin = state["powerups"].lower() != "off"
    weapon_spin = bool(folder)
    roster = ws.build_long_tournament_roster(
        health=health,
        radius=radius,
        skin_folder=folder,
        weapon_ids=weapon_ids,
        skin_ids=skin_ids,
    )
    label = " vs ".join(f.get("name") or "?" for f in roster[:4])
    if len(roster) > 4:
        label = f"{len(roster)} entrants · {label}…"
    if folder:
        label = f"{folder}: {label}"
    opts = {
        "powerup_spin": powerup_spin,
        "weapon_spin": weapon_spin,
        "weapon_ids": weapon_ids,
        "skin_folder": folder,
    }
    return roster, opts, label


def _form_error_block(exc: Exception, values: dict) -> str:
    msg = str(exc).lower()
    folder = (_field(values, "skin_folder") or "none").strip().lower()
    pick = (_field(values, "skin_pick") or "all").strip().lower()
    if "skin" in msg:
        if folder not in {"", "none"} and pick == "custom" and "skins" in (values or {}):
            return "skins"
        if folder not in {"", "none"} and "skin_pick" in (values or {}):
            return "skin_pick"
        return "skin_folder"
    if "health" in msg:
        return "health"
    if "radius" in msg:
        return "radius"
    return "weapons"


def _rebuild_long_modal(ws, view: dict, *, folder: str | None = None, skin_pick: str | None = None) -> dict:
    values = (view.get("state") or {}).get("values") or {}
    state = _read_long_state(values, folder=folder, skin_pick=skin_pick)
    # Switching folders defaults back to Select all.
    if folder is not None:
        state["skin_pick"] = "all"
        state["skin_ids"] = []
    return _long_modal(
        ws,
        channel=view.get("private_metadata") or "",
        health=state["health"],
        radius=state["radius"],
        powerups=state["powerups"],
        folder=state["folder"],
        skin_pick=state["skin_pick"],
        weapon_ids=state["weapon_ids"],
        skin_ids=state["skin_ids"],
    )


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]
    upload_take = ctx["upload_take_to_slack"]
    composed_dir = Path(ctx["composed_dir"])

    @app.command("/long")
    def cmd_long(ack, body, client):
        ack()
        channel = body.get("channel_id") or body.get("user_id") or ""
        try:
            client.views_open(
                trigger_id=body["trigger_id"],
                view=_long_modal(ws, channel=channel),
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            reply(client, body, f"Could not open form: `{exc}`")

    @app.view("long_setup")
    def on_long_setup(ack, body, client):
        values = (body.get("view") or {}).get("state", {}).get("values") or {}
        try:
            roster, opts, label = _parse_long_form(ws, values)
        except Exception as exc:  # noqa: BLE001
            ack(
                response_action="errors",
                errors={_form_error_block(exc, values): str(exc)[:100]},
            )
            return
        ack()
        user = body["user"]["id"]
        reply_channel = (body.get("view") or {}).get("private_metadata") or user
        powerup_spin = opts["powerup_spin"]
        weapon_spin = opts["weapon_spin"]

        def work():
            ch = reply_channel or user
            try:
                if str(ch).startswith("U"):
                    im = client.conversations_open(users=ch)
                    ch = im["channel"]["id"]
                spin_bits = []
                if weapon_spin:
                    spin_bits.append("weapon wheel")
                if powerup_spin:
                    spin_bits.append("powerup spins")
                spin_line = " · ".join(spin_bits) if spin_bits else "no wheels"
                ws.save_last_run(
                    kind="long",
                    label=label,
                    payload={
                        "roster": roster,
                        "powerup_spin": powerup_spin,
                        "weapon_spin": weapon_spin,
                        "weapon_ids": opts.get("weapon_ids"),
                        "skin_folder": opts.get("skin_folder"),
                    },
                    user=user,
                    channel=ch,
                )
                status = client.chat_postMessage(
                    channel=ch,
                    text=(
                        f"<@{user}> *Long tournament* — *{label}*\n"
                        f"{spin_line} · recording bracket + fights (this takes a while)…"
                    ),
                )
                status_ts = status.get("ts")

                def on_progress(info: dict) -> None:
                    phase = info.get("phase") or ""
                    detail = info.get("detail") or ""
                    line = f"<@{user}> *Long tournament* — *{label}*\n_{phase}_ {detail}".rstrip()
                    try:
                        client.chat_update(channel=ch, ts=status_ts, text=line)
                    except Exception:  # noqa: BLE001
                        pass

                result = ws.produce_long_tournament(
                    roster,
                    powerup_spin=powerup_spin,
                    weapon_spin=weapon_spin,
                    weapon_ids=opts.get("weapon_ids"),
                    skin_folder=opts.get("skin_folder"),
                    on_progress=on_progress,
                )
                path = Path(result.get("path") or (composed_dir / "tournament-final.mp4"))
                champ = result.get("champion") or "?"
                caption = (
                    f"*Long tournament ready* — champion *{champ}*\n"
                    f"`{result.get('final')}` · {result.get('segmentCount')} segments\n"
                    "Use the button below to upload to YouTube."
                )
                try:
                    client.chat_update(
                        channel=ch,
                        ts=status_ts,
                        text=f"<@{user}> {caption}",
                        blocks=[
                            {
                                "type": "section",
                                "text": {"type": "mrkdwn", "text": f"<@{user}> {caption}"},
                            },
                            {
                                "type": "actions",
                                "block_id": "long_post",
                                "elements": [
                                    {
                                        "type": "button",
                                        "action_id": "long_post_youtube",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "Post to YouTube",
                                        },
                                        "style": "primary",
                                        "value": "tournament-final.mp4",
                                    }
                                ],
                            },
                        ],
                    )
                except Exception:  # noqa: BLE001
                    traceback.print_exc()
                upload_take(
                    client,
                    channel=ch,
                    path=path,
                    caption=f"<@{user}> Champion *{champ}* — full long video",
                    title="tournament-final",
                )
                ws.mark_last_run_ok()
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                ws.mark_last_run_failed(exc)
                reply(
                    client,
                    {"user_id": user, "channel_id": ch},
                    f"`/long` failed: `{exc}` — `/retry` to run again",
                )

        run_async(work)

    @app.action("long_skin_folder")
    def on_long_skin_folder(ack, body, client):
        ack()
        view = body.get("view") or {}
        action = (body.get("actions") or [{}])[0]
        folder = ((action.get("selected_option") or {}).get("value")) or "none"
        try:
            client.views_update(
                view_id=view.get("id"),
                hash=view.get("hash"),
                view=_rebuild_long_modal(ws, view, folder=folder),
            )
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    @app.action("long_skin_pick")
    def on_long_skin_pick(ack, body, client):
        ack()
        view = body.get("view") or {}
        action = (body.get("actions") or [{}])[0]
        pick = ((action.get("selected_option") or {}).get("value")) or "all"
        try:
            client.views_update(
                view_id=view.get("id"),
                hash=view.get("hash"),
                view=_rebuild_long_modal(ws, view, skin_pick=pick),
            )
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    @app.action("long_post_youtube")
    def on_long_post(ack, body, client):
        ack()
        user = body.get("user", {}).get("id") or ""
        channel = body.get("channel", {}).get("id") or user
        filename = (body.get("actions") or [{}])[0].get("value") or "tournament-final.mp4"
        manifest = ws.load_compose_tournament().load_manifest()
        title = ws.build_long_title(manifest)
        description = ws.build_long_description(manifest)
        try:
            client.views_open(
                trigger_id=body["trigger_id"],
                view=caption_modal(
                    callback_id="long_post_caption",
                    metadata={"file": filename, "channel": channel, "user": user},
                    title=title,
                    description=description,
                    heading="Post Long Video",
                ),
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            reply(
                client,
                {"user_id": user, "channel_id": channel},
                f"Could not open caption form: `{exc}`",
            )

    @app.view("long_post_caption")
    def on_long_post_caption(ack, body, client):
        view = body.get("view") or {}
        values = (view.get("state") or {}).get("values") or {}
        title = (field_value(values, "title") or "").strip()
        if not title:
            ack(response_action="errors", errors={"title": "Title required"})
            return
        ack()
        try:
            meta = json.loads(view.get("private_metadata") or "{}")
        except json.JSONDecodeError:
            meta = {}
        filename = meta.get("file") or "tournament-final.mp4"
        user = meta.get("user") or body.get("user", {}).get("id") or ""
        channel = meta.get("channel") or user
        description = (field_value(values, "caption") or "").strip()

        def work():
            try:
                ch = resolve_channel(client, {"channel_id": channel, "user_id": user})
                client.chat_postMessage(
                    channel=ch,
                    text=f"<@{user}> Uploading `{filename}` to YouTube…",
                )
                uploaded = ws.upload_video(filename, title, description)
                url = uploaded.get("url") or uploaded.get("videoUrl") or uploaded.get("watchUrl") or ""
                extra = ""
                if uploaded.get("thumbnail"):
                    extra += "\nThumbnail: intro still"
                elif uploaded.get("thumbnailError"):
                    extra += (
                        f"\nThumbnail skipped: `{uploaded['thumbnailError']}` "
                        "(re-run `youtube/scripts/auth.py` if this is a scope error)"
                    )
                if isinstance(uploaded.get("tiktok"), dict):
                    tk = uploaded["tiktok"]
                    extra += f"\nTikTok: `{tk.get('status') or 'ok'}`"
                    if tk.get("shareUrl"):
                        extra += f" {tk['shareUrl']}"
                elif uploaded.get("tiktokError"):
                    extra += f"\nTikTok failed: `{uploaded['tiktokError']}`"
                client.chat_postMessage(
                    channel=ch,
                    text=f"<@{user}> Posted: {url or filename}\n`{title}`{extra}",
                )
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                reply(
                    client,
                    {"user_id": user, "channel_id": channel},
                    f"YouTube upload failed: `{exc}`",
                )

        run_async(work)
