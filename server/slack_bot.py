#!/usr/bin/env python3
"""
Slack bot for Ball Arena Shorts — Socket Mode.

Slash commands (core in this file; extras in server/slack_commands/):
  /short         Match setup → generate takes → pick one to post
  /short-pick    Re-show Post / Don't post for the latest unfinished job
  /add-skin      Upload an image as a new fighter skin
  /quota         YouTube upload quota hint
  /arena-status  Server + pipeline + latest job (/status is Slack-reserved)
  /cancel        Cancel unfinished candidate job (nothing posted)
  /skins         List fighter skins
  /weapons       List premade weapons
  /random-short  Last setup, random weapons + powerups (skins/stats fixed)
  /long          Long YouTube tournament (shared stats; skins list or weapons)

Also: mention the bot or DM it with a fight prompt
  e.g. "Make Daemon and Aragorn fighting with swords"

Requires server/.env:
  SLACK_BOT_TOKEN=xoxb-...
  SLACK_APP_TOKEN=xapp-...   (Socket Mode)
  SLACK_SIGNING_SECRET=...   (optional with Socket Mode)

App setup (api.slack.com):
  1. Create New App → "From an app manifest"
     paste server/slack_app_manifest.yaml (or .json)
  2. Basic Information → App-Level Tokens → Generate
     (scope: connections:write) → copy xapp-… into server/.env as SLACK_APP_TOKEN
  3. Install to Workspace → copy Bot User OAuth Token xoxb-… as SLACK_BOT_TOKEN
  4. Invite the bot to your channel; restart workflow_server.py
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sys
import threading
import traceback
from pathlib import Path
from urllib.request import Request, urlopen

SERVER_DIR = Path(__file__).resolve().parent
ARENA_DIR = SERVER_DIR.parent
ENV_PATH = SERVER_DIR / ".env"

# Import pipeline helpers from the workflow server module.
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import workflow_server as ws  # noqa: E402


def _load_dotenv(path: Path = ENV_PATH) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _weapon_select_options() -> list[dict]:
    options = []
    for row in ws.list_weapon_options():
        options.append(
            {
                "text": {"type": "plain_text", "text": row["name"][:75]},
                "value": row["id"],
            }
        )
    return options[:100]


def _powerup_select_options() -> list[dict]:
    options = [
        {"text": {"type": "plain_text", "text": "None"}, "value": "none"},
    ]
    for row in ws.list_powerup_options():
        options.append(
            {
                "text": {"type": "plain_text", "text": row["name"][:75]},
                "value": row["id"],
            }
        )
    return options[:100]


def _skin_select_options() -> list[dict]:
    options = [
        {"text": {"type": "plain_text", "text": "None"}, "value": "none"},
    ]
    for row in ws.list_skin_options():
        options.append(
            {
                "text": {"type": "plain_text", "text": row["name"][:75]},
                "value": row["id"],
            }
        )
    return options[:100]


def _ball_select_options() -> list[dict]:
    options = [
        {"text": {"type": "plain_text", "text": "None"}, "value": "none"},
    ]
    for row in ws.list_ball_options():
        options.append(
            {
                "text": {"type": "plain_text", "text": row["name"][:75]},
                "value": row["id"],
            }
        )
    return options[:100]


def _intro_select_options() -> list[dict]:
    options = []
    for row in ws.list_intro_options():
        options.append(
            {
                "text": {"type": "plain_text", "text": row["name"][:75]},
                "value": row["id"],
            }
        )
    return options[:100]


def _select_option(options: list[dict], value: str | None) -> dict | None:
    if not value:
        return None
    return next((o for o in options if o["value"] == value), None)


def _static_select(
    *,
    options: list[dict],
    initial: str | None = None,
    placeholder: str = "Pick…",
    action_id: str = "value",
) -> dict:
    el: dict = {
        "type": "static_select",
        "action_id": action_id,
        "options": options,
        "placeholder": {"type": "plain_text", "text": placeholder[:75]},
    }
    opt = _select_option(options, initial)
    if opt:
        el["initial_option"] = opt
    return el


def _plain_input(
    *,
    placeholder: str = "",
    initial: str | None = None,
    multiline: bool = False,
) -> dict:
    el: dict = {
        "type": "plain_text_input",
        "action_id": "value",
    }
    if placeholder:
        el["placeholder"] = {"type": "plain_text", "text": placeholder[:75]}
    if initial:
        el["initial_value"] = str(initial)[:3000]
    if multiline:
        el["multiline"] = True
    return el


def _option_label(options: list[dict], value: str | None, fallback: str = "?") -> str:
    opt = _select_option(options, value)
    if not opt:
        return fallback
    text = (opt.get("text") or {}).get("text") or fallback
    return str(text)


def _default_fighter_slot(mode: str = "weapon") -> dict:
    weapons = _weapon_select_options()
    default_weapon = "sword" if _select_option(weapons, "sword") else (
        weapons[0]["value"] if weapons else "sword"
    )
    return {
        "name": "none",
        "weaponId": default_weapon,
        "powerupId": "none",
        "health": "",
        "radius": "",
        "mass": "",
    }


# In-memory /short drafts: draft_id → form state (slots live here, not as top-level inputs).
_SHORT_DRAFTS: dict[str, dict] = {}


def _new_short_draft(channel: str) -> str:
    draft_id = secrets.token_hex(8)
    mode = "weapon"
    _SHORT_DRAFTS[draft_id] = {
        "channel": channel,
        "mode": mode,
        "count": 2,
        "takes": 1,
        "intro": "skip",
        "intro_a": "",
        "intro_b": "",
        "prompt": "",
        "slots": [_default_fighter_slot(mode), _default_fighter_slot(mode)],
        "root_view_id": None,
    }
    return draft_id


def _get_draft(draft_id: str | None) -> dict | None:
    if not draft_id:
        return None
    return _SHORT_DRAFTS.get(draft_id)


def _parse_short_meta(meta: str) -> tuple[str, str]:
    """Return (channel_or_user, draft_id) from private_metadata."""
    meta = (meta or "").strip()
    if not meta:
        return "", ""
    try:
        data = json.loads(meta)
        if isinstance(data, dict):
            return str(data.get("channel") or ""), str(data.get("draft") or "")
    except json.JSONDecodeError:
        pass
    # Legacy: bare channel id
    return meta, ""


def _short_meta(channel: str, draft_id: str) -> str:
    return json.dumps({"channel": channel, "draft": draft_id}, separators=(",", ":"))


def _sync_draft_slots(draft: dict) -> None:
    mode = draft.get("mode") or "weapon"
    count = max(2, min(int(draft.get("count") or 2), 6))
    draft["count"] = count
    slots = list(draft.get("slots") or [])
    while len(slots) < count:
        slots.append(_default_fighter_slot(mode))
    if len(slots) > count:
        slots = slots[:count]
    draft["slots"] = slots


def _fighter_summary(slot: dict, mode: str) -> str:
    skins = _skin_select_options() if mode == "weapon" else _ball_select_options()
    weapons = _weapon_select_options()
    powerups = _powerup_select_options()
    skin_id = slot.get("name") or "none"
    name = _option_label(skins, skin_id, "None" if skin_id in {"", "none"} else skin_id)
    parts = [name]
    if mode == "weapon":
        parts.append(_option_label(weapons, slot.get("weaponId"), "sword"))
    pu = slot.get("powerupId") or "none"
    if pu and pu != "none":
        parts.append(_option_label(powerups, pu, pu))
    extras = []
    if slot.get("health"):
        extras.append(f"HP {slot['health']}")
    if slot.get("radius"):
        extras.append(f"r {slot['radius']}")
    if mode == "collision" and slot.get("mass"):
        extras.append(f"m {slot['mass']}")
    if extras:
        parts.append(", ".join(extras))
    return " · ".join(parts)


def _read_modal_prefs(values: dict | None) -> dict:
    values = values or {}
    mode = (_field(values, "mode") or "weapon").strip()
    if mode not in {"weapon", "collision"}:
        mode = "weapon"
    try:
        count = int(_field(values, "fighter_count") or "2")
    except (TypeError, ValueError):
        count = 2
    count = max(2, min(count, 6))
    try:
        takes = int(_field(values, "takes") or "1")
    except (TypeError, ValueError):
        takes = 1
    takes = max(1, min(takes, 3))
    intro = (_field(values, "intro_mode") or "skip").strip().lower()
    if intro not in {"skip", "default", "custom"}:
        intro = "skip"
    return {
        "mode": mode,
        "count": count,
        "takes": takes,
        "intro": intro,
        "intro_a": _field(values, "intro_a") or "",
        "intro_b": _field(values, "intro_b") or "",
        "prompt": (_field(values, "prompt") or "").strip(),
    }


def _apply_prefs_to_draft(draft: dict, prefs: dict) -> None:
    old_mode = draft.get("mode")
    draft["mode"] = prefs["mode"]
    draft["count"] = prefs["count"]
    draft["takes"] = prefs["takes"]
    draft["intro"] = prefs["intro"]
    draft["intro_a"] = prefs.get("intro_a") or draft.get("intro_a") or ""
    draft["intro_b"] = prefs.get("intro_b") or draft.get("intro_b") or ""
    if "prompt" in prefs:
        draft["prompt"] = prefs.get("prompt") or ""
    if old_mode != prefs["mode"]:
        # Mode switch: refresh defaults for empty/unknown slots
        draft["slots"] = [
            _default_fighter_slot(prefs["mode"]) for _ in range(prefs["count"])
        ]
    else:
        _sync_draft_slots(draft)


def _short_modal(
    *,
    draft_id: str,
    private_metadata: str = "",
) -> dict:
    draft = _get_draft(draft_id)
    if not draft:
        raise ValueError("short draft expired — run /short again")
    _sync_draft_slots(draft)
    mode = draft["mode"]
    count = draft["count"]
    takes = draft["takes"]
    intro = draft["intro"]
    intros = _intro_select_options()
    default_intro_a = "sukuna" if _select_option(intros, "sukuna") else (
        intros[0]["value"] if intros else ""
    )
    default_intro_b = "gojo" if _select_option(intros, "gojo") else (
        intros[1]["value"] if len(intros) > 1 else default_intro_a
    )
    if not draft.get("intro_a"):
        draft["intro_a"] = default_intro_a
    if not draft.get("intro_b"):
        draft["intro_b"] = default_intro_b

    mode_opts = [
        {"text": {"type": "plain_text", "text": "Weapon Arena"}, "value": "weapon"},
        {"text": {"type": "plain_text", "text": "Ball Arena (collision)"}, "value": "collision"},
    ]
    count_opts = [
        {"text": {"type": "plain_text", "text": str(n)}, "value": str(n)}
        for n in range(2, 7)
    ]
    takes_opts = [
        {"text": {"type": "plain_text", "text": str(n)}, "value": str(n)}
        for n in range(1, 4)
    ]
    intro_opts = [
        {"text": {"type": "plain_text", "text": "Off (no intro)"}, "value": "skip"},
        {"text": {"type": "plain_text", "text": "Default (Sukuna vs Gojo)"}, "value": "default"},
        {"text": {"type": "plain_text", "text": "Custom pair"}, "value": "custom"},
    ]

    blocks: list[dict] = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "*Match setup* — match options above; tap each fighter’s menu "
                    "to set skin, weapon, powerup, and stats."
                ),
            },
        },
        {
            "type": "input",
            "block_id": "mode",
            "dispatch_action": True,
            "label": {"type": "plain_text", "text": "Mode"},
            "element": _static_select(
                options=mode_opts,
                initial=mode,
                placeholder="Mode",
                action_id="short_mode",
            ),
        },
        {
            "type": "input",
            "block_id": "fighter_count",
            "dispatch_action": True,
            "label": {"type": "plain_text", "text": "Number of fighters"},
            "element": _static_select(
                options=count_opts,
                initial=str(count),
                placeholder="Count",
                action_id="short_count",
            ),
        },
        {
            "type": "input",
            "block_id": "takes",
            "label": {"type": "plain_text", "text": "Sample takes to generate"},
            "element": _static_select(
                options=takes_opts,
                initial=str(takes),
                placeholder="Takes",
            ),
        },
        {
            "type": "input",
            "block_id": "intro_mode",
            "dispatch_action": True,
            "label": {"type": "plain_text", "text": "VS intro"},
            "element": _static_select(
                options=intro_opts,
                initial=intro,
                placeholder="Intro",
                action_id="short_intro",
            ),
        },
    ]

    if intro == "custom":
        if not intros:
            blocks.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "_No intro images in `intros/` — add PNGs or pick Default/Off._",
                    },
                }
            )
        else:
            blocks.append(
                {
                    "type": "input",
                    "block_id": "intro_a",
                    "label": {"type": "plain_text", "text": "Intro A (top)"},
                    "element": _static_select(
                        options=intros,
                        initial=draft.get("intro_a") or default_intro_a,
                        placeholder="Intro A",
                    ),
                }
            )
            blocks.append(
                {
                    "type": "input",
                    "block_id": "intro_b",
                    "label": {"type": "plain_text", "text": "Intro B (bottom)"},
                    "element": _static_select(
                        options=intros,
                        initial=draft.get("intro_b") or default_intro_b,
                        placeholder="Intro B",
                    ),
                }
            )

    blocks.append({"type": "divider"})
    for i, slot in enumerate(draft["slots"]):
        summary = _fighter_summary(slot, mode)
        blocks.append(
            {
                "type": "section",
                "block_id": f"fighter_{i}",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Fighter {i + 1}*\n{summary}",
                },
                "accessory": {
                    "type": "static_select",
                    "action_id": "fighter_menu",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Edit fighter…",
                    },
                    "options": [
                        {
                            "text": {
                                "type": "plain_text",
                                "text": "Edit skin / weapon / powerup / stats",
                            },
                            "value": f"{draft_id}:{i}",
                        }
                    ],
                },
            }
        )

    blocks.append(
        {
            "type": "input",
            "block_id": "prompt",
            "optional": True,
            "label": {"type": "plain_text", "text": "Or freeform prompt (overrides above)"},
            "element": _plain_input(
                placeholder="Make a video of Daemon and Aragorn fighting with swords",
                multiline=True,
                initial=(draft.get("prompt") or "").strip() or None,
            ),
        }
    )

    view: dict = {
        "type": "modal",
        "callback_id": "short_setup",
        "title": {"type": "plain_text", "text": "Post Short"},
        "submit": {"type": "plain_text", "text": "Generate"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": blocks,
        "private_metadata": private_metadata
        or _short_meta(str(draft.get("channel") or ""), draft_id),
    }
    return view


def _fighter_edit_modal(*, draft_id: str, index: int, root_view_id: str) -> dict:
    draft = _get_draft(draft_id)
    if not draft:
        raise ValueError("draft expired")
    _sync_draft_slots(draft)
    slots = draft["slots"]
    if index < 0 or index >= len(slots):
        raise ValueError("bad fighter index")
    slot = slots[index]
    mode = draft["mode"]
    fighters = _skin_select_options() if mode == "weapon" else _ball_select_options()
    weapons = _weapon_select_options()
    powerups = _powerup_select_options()
    default_weapon = "sword" if _select_option(weapons, "sword") else (
        weapons[0]["value"] if weapons else "sword"
    )

    blocks: list[dict] = [
        {
            "type": "input",
            "block_id": "name",
            "optional": True,
            "label": {
                "type": "plain_text",
                "text": "Skin" if mode == "weapon" else "Ball fighter",
            },
            "element": _static_select(
                options=fighters,
                initial=slot.get("name") or "none",
                placeholder="None",
            ),
        }
    ]
    if mode == "weapon":
        blocks.append(
            {
                "type": "input",
                "block_id": "weapon",
                "label": {"type": "plain_text", "text": "Weapon"},
                "element": _static_select(
                    options=weapons,
                    initial=slot.get("weaponId") or default_weapon,
                    placeholder="Weapon",
                ),
            }
        )
    blocks.append(
        {
            "type": "input",
            "block_id": "powerup",
            "optional": True,
            "label": {"type": "plain_text", "text": "Powerup"},
            "element": _static_select(
                options=powerups,
                initial=slot.get("powerupId") or "none",
                placeholder="Powerup",
            ),
        }
    )
    blocks.append(
        {
            "type": "input",
            "block_id": "health",
            "optional": True,
            "label": {"type": "plain_text", "text": "Health"},
            "element": _plain_input(
                placeholder="60" if mode == "weapon" else "100",
                initial=(slot.get("health") or None),
            ),
        }
    )
    blocks.append(
        {
            "type": "input",
            "block_id": "radius",
            "optional": True,
            "label": {"type": "plain_text", "text": "Radius"},
            "element": _plain_input(
                placeholder="36",
                initial=(slot.get("radius") or None),
            ),
        }
    )
    if mode == "collision":
        blocks.append(
            {
                "type": "input",
                "block_id": "mass",
                "optional": True,
                "label": {"type": "plain_text", "text": "Mass"},
                "element": _plain_input(
                    placeholder="36",
                    initial=(slot.get("mass") or None),
                ),
            }
        )

    meta = json.dumps(
        {"draft": draft_id, "index": index, "root": root_view_id},
        separators=(",", ":"),
    )
    return {
        "type": "modal",
        "callback_id": "short_fighter_edit",
        "title": {"type": "plain_text", "text": f"Fighter {index + 1}"[:24]},
        "submit": {"type": "plain_text", "text": "Save"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "private_metadata": meta,
        "blocks": blocks,
    }


def _category_select_options() -> list[dict]:
    options = [
        {"text": {"type": "plain_text", "text": "None (top-level skins/)"}, "value": "none"},
    ]
    for name in ws.list_skin_categories():
        options.append(
            {
                "text": {"type": "plain_text", "text": name[:75]},
                "value": name,
            }
        )
    return options[:100]


def _add_skin_modal() -> dict:
    return {
        "type": "modal",
        "callback_id": "add_skin",
        "title": {"type": "plain_text", "text": "Add Skin"},
        "submit": {"type": "plain_text", "text": "Save"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": [
            {
                "type": "input",
                "block_id": "name",
                "label": {"type": "plain_text", "text": "Fighter name"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "value",
                    "placeholder": {"type": "plain_text", "text": "e.g. Jon Snow"},
                },
            },
            {
                "type": "input",
                "block_id": "category",
                "optional": True,
                "label": {"type": "plain_text", "text": "Category"},
                "element": _static_select(
                    options=_category_select_options(),
                    initial="none",
                    placeholder="None",
                ),
            },
            {
                "type": "input",
                "block_id": "new_category",
                "optional": True,
                "label": {"type": "plain_text", "text": "Or new category name"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "value",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Creates a folder; shows in the dropdown next time",
                    },
                },
            },
            {
                "type": "input",
                "block_id": "image",
                "label": {"type": "plain_text", "text": "Skin image"},
                "element": {
                    "type": "file_input",
                    "action_id": "value",
                    "filetypes": ["png", "jpg", "jpeg", "webp", "gif"],
                    "max_files": 1,
                },
            },
        ],
    }


def _field(values: dict | None, block_id: str) -> str | None:
    if not values:
        return None
    block = values.get(block_id) or {}
    if not isinstance(block, dict) or not block:
        return None
    entry = block.get("value")
    if not isinstance(entry, dict):
        # dispatch_action selects use a custom action_id (e.g. short_mode)
        entry = next((v for v in block.values() if isinstance(v, dict)), {}) or {}
    if "selected_option" in entry:
        opt = entry.get("selected_option") or {}
        return opt.get("value")
    if "files" in entry:
        files = entry.get("files") or []
        return files[0]["id"] if files else None
    return entry.get("value")


def _download_slack_file(client, file_id: str, token: str) -> tuple[bytes, str]:
    info = client.files_info(file=file_id)
    meta = info["file"]
    url = meta.get("url_private_download") or meta.get("url_private")
    if not url:
        raise RuntimeError("Slack file has no download URL")
    req = Request(url, headers={"Authorization": f"Bearer {token}"})
    with urlopen(req, timeout=60) as resp:
        data = resp.read()
    name = meta.get("name") or "skin.png"
    ext = Path(name).suffix.lower() or ".png"
    return data, ext


def _ensure_in_channel(client, channel: str) -> None:
    """Join public channels when the bot isn't a member yet."""
    try:
        client.conversations_join(channel=channel)
    except Exception:  # noqa: BLE001
        pass


def _post_progress(client, channel: str, text: str, thread_ts: str | None = None) -> str:
    try:
        resp = client.chat_postMessage(channel=channel, text=text, thread_ts=thread_ts)
    except Exception as exc:  # noqa: BLE001
        err = getattr(exc, "response", None)
        error = (err.get("error") if err is not None else "") or str(exc)
        if error == "not_in_channel":
            _ensure_in_channel(client, channel)
            try:
                resp = client.chat_postMessage(
                    channel=channel, text=text, thread_ts=thread_ts
                )
            except Exception as retry_exc:  # noqa: BLE001
                raise RuntimeError(
                    "Bot is not in this channel. In Slack run: /invite @Ball Arena"
                ) from retry_exc
        else:
            raise
    return resp["ts"]


def _dm_user(client, user: str, text: str) -> None:
    im = client.conversations_open(users=user)
    client.chat_postMessage(channel=im["channel"]["id"], text=text)

def _slack_err_text(exc: BaseException) -> str:
    err = getattr(exc, "response", None)
    if err is not None:
        try:
            data = err.data if hasattr(err, "data") else err
            if isinstance(data, dict):
                return str(data.get("error") or data)[:200]
        except Exception:  # noqa: BLE001
            pass
    return str(exc)[:200]


def _upload_take_to_slack(
    client,
    *,
    channel: str,
    path: Path,
    caption: str,
    title: str,
) -> None:
    """Share a take clip into the channel (visible in the main timeline)."""
    if not path.is_file():
        raise FileNotFoundError(f"Missing video file: {path}")
    _ensure_in_channel(client, channel)
    # Prefer channel timeline (no thread) so phone users see the clip + can scrub it.
    try:
        client.files_upload_v2(
            channel=channel,
            file=str(path),
            filename=path.name,
            title=title,
            initial_comment=caption,
        )
        return
    except Exception as first:  # noqa: BLE001
        print(
            f"[slack] files_upload_v2 failed ({_slack_err_text(first)}); retrying…",
            file=sys.stderr,
            flush=True,
        )
        _ensure_in_channel(client, channel)
        client.files_upload_v2(
            channel=channel,
            file=str(path),
            filename=path.name,
            title=title,
            initial_comment=caption,
        )


def _pick_blocks(
    *,
    user: str,
    job_id: str,
    candidates: list,
    label: str,
    decided: str | None = None,
) -> list[dict]:
    """Blocks for the take-picker message. decided locks the buttons after a choice."""
    n = len(candidates)
    if decided:
        return [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"<@{user}> *{label}* — {decided}",
                },
            }
        ]

    lines = [
        f"<@{user}> *{n} take{'s' if n != 1 else ''}* ready for *{label}*.",
        "Watch the clips above, then pick one to post — or skip:",
    ]
    for i, take in enumerate(candidates):
        winner = take.get("winner") or "?"
        lines.append(f"• *Take {i + 1}* — winner *{winner}* · `{take.get('title') or ''}`")

    # Slack allows ≤5 buttons per actions block.
    post_buttons = []
    for i, take in enumerate(candidates):
        winner = take.get("winner") or "?"
        label_txt = f"Post {i + 1} ({winner})"
        if len(label_txt) > 75:
            label_txt = f"Post take {i + 1}"
        post_buttons.append(
            {
                "type": "button",
                "action_id": f"post_take_{i}",
                "text": {"type": "plain_text", "text": label_txt},
                "value": f"{job_id}:{i}",
                "style": "primary" if i == 0 else None,
            }
        )
    for el in post_buttons:
        if el.get("style") is None:
            el.pop("style", None)

    skip_btn = {
        "type": "button",
        "action_id": "reject_job",
        "text": {"type": "plain_text", "text": "Don't post"},
        "value": job_id,
        "style": "danger",
    }

    blocks: list[dict] = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "\n".join(lines)},
        },
    ]
    # Pack post buttons (max 4) + skip into actions blocks of ≤5.
    row: list[dict] = []
    for btn in post_buttons + [skip_btn]:
        row.append(btn)
        if len(row) >= 5:
            blocks.append(
                {"type": "actions", "block_id": f"pick_{job_id}_{len(blocks)}", "elements": row}
            )
            row = []
    if row:
        blocks.append(
            {"type": "actions", "block_id": f"pick_{job_id}_{len(blocks)}", "elements": row}
        )
    return blocks


def _post_pick_buttons(
    client,
    *,
    channel: str,
    user: str,
    job_id: str,
    candidates: list,
    label: str,
    status_ts: str | None = None,
) -> str:
    """Post (or update) the pick message; returns message ts."""
    blocks = _pick_blocks(
        user=user, job_id=job_id, candidates=candidates, label=label
    )
    text = f"Pick a take to post for {label} — or Don't post"
    if status_ts:
        try:
            client.chat_update(
                channel=channel,
                ts=status_ts,
                text=text,
                blocks=blocks,
            )
            return status_ts
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    resp = client.chat_postMessage(channel=channel, text=text, blocks=blocks)
    return resp["ts"]


def _lock_pick_message(
    client,
    *,
    channel: str,
    message_ts: str,
    user: str,
    job_id: str,
    candidates: list,
    label: str,
    decided: str,
) -> None:
    try:
        client.chat_update(
            channel=channel,
            ts=message_ts,
            text=decided,
            blocks=_pick_blocks(
                user=user,
                job_id=job_id,
                candidates=candidates,
                label=label,
                decided=decided,
            ),
        )
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def _run_candidates_job(
    client,
    *,
    channel: str,
    user: str,
    setup: dict,
    thread_ts: str | None = None,
    count: int = 3,
) -> None:
    resolved = setup.get("resolved") or {}
    fighters = resolved.get("fighters") or []
    weapons = resolved.get("weapons") or []
    label = " vs ".join(str(x) for x in fighters) if fighters else "matchup"
    if weapons:
        label = f"{label} ({' / '.join(str(w) for w in weapons)})"
    n = max(1, min(int(count), 5))

    _ensure_in_channel(client, channel)
    status_ts = _post_progress(
        client,
        channel,
        f"<@{user}> Generating *{n} take{'s' if n != 1 else ''}* for *{label}*…\n"
        "_Starting…_",
        thread_ts,
    )

    def _status_line(info: dict) -> str:
        take = info.get("take", "?")
        total = info.get("total", n)
        phase = info.get("phase") or ""
        winner = info.get("winner")
        if phase == "recording":
            detail = f"Take *{take}/{total}* — recording fight…"
        elif phase == "composing":
            detail = f"Take *{take}/{total}* — composing…"
            if winner:
                detail += f" (winner: *{winner}*)"
        elif phase == "done":
            detail = f"Take *{take}/{total}* — done"
            if winner:
                detail += f" (winner: *{winner}*)"
            if info.get("raw_only"):
                detail += " _(raw preview — compose will finish on Post)_"
        elif phase == "error":
            detail = f"Take *{take}/{total}* — failed: `{info.get('error') or '?'}`"
        elif phase == "uploading":
            detail = f"Take *{take}/{total}* — uploading to Slack…"
        else:
            detail = f"Take *{take}/{total}* — {phase or 'working'}…"
        return (
            f"<@{user}> Generating *{total} take{'s' if total != 1 else ''}* "
            f"for *{label}*\n{detail}"
        )

    def on_progress(info) -> None:
        if not isinstance(info, dict):
            return
        line = _status_line(info)
        print(
            f"[slack] {info.get('phase')} take {info.get('take')}/{info.get('total')}",
            file=sys.stderr,
            flush=True,
        )
        try:
            client.chat_update(channel=channel, ts=status_ts, text=line)
        except Exception:  # noqa: BLE001
            pass

    def on_candidate(index: int, take: dict, total: int) -> None:
        """Upload each clip as soon as it's ready (don't wait for all takes)."""
        path = Path(take["path"])
        winner = take.get("winner") or "?"
        take_num = index + 1
        on_progress({"take": take_num, "total": total, "phase": "uploading"})
        note = ""
        if take.get("composeError") or not take.get("composed"):
            note = " _(raw — will compose on Post)_"
        caption = (
            f"*Take {take_num}/{total}* — winner: *{winner}*{note}\n"
            f"Title: `{take['title']}`"
        )
        try:
            _upload_take_to_slack(
                client,
                channel=channel,
                path=path,
                caption=caption,
                title=f"Take {take_num}",
            )
            print(f"[slack] uploaded take {take_num}/{total}", file=sys.stderr, flush=True)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            _post_progress(
                client,
                channel,
                (
                    f"Take {take_num} Slack upload failed: `{_slack_err_text(exc)}`\n"
                    f"File on disk: `{path}` — Post buttons will still appear."
                ),
            )

    try:
        job = ws.generate_short_candidates(
            setup,
            count=n,
            on_progress=on_progress,
            on_candidate=on_candidate,
        )
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        try:
            client.chat_update(
                channel=channel,
                ts=status_ts,
                text=f"<@{user}> Failed to generate takes: `{exc}`",
            )
        except Exception:  # noqa: BLE001
            _post_progress(
                client,
                channel,
                f"<@{user}> Failed to generate takes: `{exc}`",
            )
        return

    job_id = job["jobId"]
    candidates = job["candidates"]
    total = len(candidates)
    print(f"[slack] {total} takes ready — posting pick buttons", file=sys.stderr, flush=True)

    try:
        _post_pick_buttons(
            client,
            channel=channel,
            user=user,
            job_id=job_id,
            candidates=candidates,
            label=label,
            status_ts=status_ts,
        )
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        _post_progress(
            client,
            channel,
            f"<@{user}> Takes are ready but buttons failed: `{_slack_err_text(exc)}` "
            f"(job `{job_id}`)",
        )


def _resolve_setup_from_draft(draft: dict, values: dict | None = None) -> tuple[dict, int]:
    """Return (setup, takes) from draft (+ optional freeform prompt in values)."""
    prefs = _read_modal_prefs(values) if values else {
        "mode": draft["mode"],
        "count": draft["count"],
        "takes": draft["takes"],
        "intro": draft["intro"],
        "intro_a": draft.get("intro_a") or "",
        "intro_b": draft.get("intro_b") or "",
        "prompt": draft.get("prompt") or "",
    }
    # Prefer live form values for top-level prefs; slots always from draft.
    if values:
        _apply_prefs_to_draft(draft, prefs)
    prompt = (prefs.get("prompt") or draft.get("prompt") or "").strip()
    if prompt:
        return ws.setup_from_request(prompt=prompt), int(draft["takes"])

    _sync_draft_slots(draft)
    slots: list[dict] = []
    for i, slot in enumerate(draft["slots"]):
        name = (slot.get("name") or "none").strip() or "none"
        row: dict = {
            "name": name,
            "health": slot.get("health") or None,
            "radius": slot.get("radius") or None,
            "powerupId": slot.get("powerupId") or "none",
        }
        if draft["mode"] == "weapon":
            row["weaponId"] = slot.get("weaponId") or "sword"
        else:
            row["mass"] = slot.get("mass") or None
        slots.append(row)

    intro_mode = draft["intro"]
    intros = None
    if intro_mode == "custom":
        intros = [draft.get("intro_a") or "", draft.get("intro_b") or ""]
    elif intro_mode == "skip":
        intros = []

    setup = ws.setup_from_arena_form(
        mode=draft["mode"],
        slots=slots,
        intro_mode=intro_mode,
        intros=intros,
    )
    return setup, int(draft["takes"])


def _looks_like_fight_prompt(text: str) -> bool:
    t = text.lower()
    if len(t) < 8:
        return False
    cues = ("fight", "vs", "versus", "make a video", "short", "battle", "with sword")
    return any(c in t for c in cues)


def build_app():
    from slack_bolt import App
    from slack_bolt.adapter.socket_mode import SocketModeHandler

    bot_token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    app_token = os.environ.get("SLACK_APP_TOKEN", "").strip()
    signing = os.environ.get("SLACK_SIGNING_SECRET", "").strip() or "socket-mode-unused"
    if not bot_token or not app_token:
        return None, None

    app = App(token=bot_token, signing_secret=signing, process_before_response=True)

    from slack_commands import register_all

    register_all(
        app,
        {
            "ws": ws,
            "run_candidates_job": _run_candidates_job,
            "upload_take_to_slack": _upload_take_to_slack,
            "composed_dir": ws.STAGES["composed"],
        },
    )

    @app.command("/short")
    def cmd_short(ack, body, client):
        ack()
        channel = body.get("channel_id") or body["user_id"]
        draft_id = _new_short_draft(channel)
        view = _short_modal(
            draft_id=draft_id,
            private_metadata=_short_meta(channel, draft_id),
        )
        opened = client.views_open(trigger_id=body["trigger_id"], view=view)
        draft = _get_draft(draft_id)
        if draft and opened.get("view"):
            draft["root_view_id"] = opened["view"]["id"]

    @app.command("/short-pick")
    def cmd_short_pick(ack, body, client):
        """Re-show Post / Don't post buttons for the latest unfinished job."""
        ack()
        user = body["user_id"]
        channel = body.get("channel_id") or user
        job = ws.latest_undecided_candidate_job()
        if not job:
            try:
                ch = channel
                if str(ch).startswith("U"):
                    im = client.conversations_open(users=ch)
                    ch = im["channel"]["id"]
                client.chat_postMessage(
                    channel=ch,
                    text=f"<@{user}> No unfinished takes to pick. Run `/short` first.",
                )
            except Exception:  # noqa: BLE001
                pass
            return

        def work():
            ch = channel
            try:
                if str(ch).startswith("U"):
                    im = client.conversations_open(users=ch)
                    ch = im["channel"]["id"]
                resolved = job.get("resolved") or {}
                fighters = resolved.get("fighters") or []
                weapons = resolved.get("weapons") or []
                label = (
                    " vs ".join(str(x) for x in fighters) if fighters else "matchup"
                )
                if weapons:
                    label = f"{label} ({' / '.join(str(w) for w in weapons)})"
                _post_pick_buttons(
                    client,
                    channel=ch,
                    user=user,
                    job_id=job["jobId"],
                    candidates=job["candidates"],
                    label=label,
                )
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                try:
                    _dm_user(client, user, f"/short-pick failed: `{exc}`")
                except Exception:  # noqa: BLE001
                    pass

        threading.Thread(target=work, daemon=True).start()

    @app.action("short_mode")
    @app.action("short_count")
    @app.action("short_intro")
    def on_short_prefs(ack, body, client):
        ack()
        view = body.get("view") or {}
        values = (view.get("state") or {}).get("values") or {}
        channel, draft_id = _parse_short_meta(view.get("private_metadata") or "")
        draft = _get_draft(draft_id)
        if not draft:
            return
        action = (body.get("actions") or [{}])[0]
        aid = action.get("action_id")
        selected = ((action.get("selected_option") or {}).get("value")) or ""
        prefs = _read_modal_prefs(values)
        if aid == "short_mode" and selected in {"weapon", "collision"}:
            prefs["mode"] = selected
        if aid == "short_count" and selected.isdigit():
            prefs["count"] = max(2, min(int(selected), 6))
        if aid == "short_intro" and selected in {"skip", "default", "custom"}:
            prefs["intro"] = selected
        _apply_prefs_to_draft(draft, prefs)
        draft["root_view_id"] = view.get("id") or draft.get("root_view_id")
        updated = _short_modal(
            draft_id=draft_id,
            private_metadata=_short_meta(channel or draft["channel"], draft_id),
        )
        client.views_update(view_id=view["id"], hash=view.get("hash"), view=updated)

    @app.action("fighter_menu")
    def on_fighter_menu(ack, body, client):
        ack()
        view = body.get("view") or {}
        action = (body.get("actions") or [{}])[0]
        value = ((action.get("selected_option") or {}).get("value")) or ""
        draft_id, _, idx_s = value.partition(":")
        try:
            index = int(idx_s)
        except ValueError:
            return
        draft = _get_draft(draft_id)
        if not draft:
            return
        # Sync top-level prefs before editing so count/mode stay current.
        values = (view.get("state") or {}).get("values") or {}
        _apply_prefs_to_draft(draft, _read_modal_prefs(values))
        root_id = view.get("id") or draft.get("root_view_id") or ""
        draft["root_view_id"] = root_id
        try:
            pushed = _fighter_edit_modal(
                draft_id=draft_id, index=index, root_view_id=root_id
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return
        client.views_push(trigger_id=body["trigger_id"], view=pushed)
        # Rebuild parent so the fighter dropdown doesn't stay stuck on "Edit…"
        channel, _ = _parse_short_meta(view.get("private_metadata") or "")
        try:
            client.views_update(
                view_id=root_id,
                view=_short_modal(
                    draft_id=draft_id,
                    private_metadata=_short_meta(
                        channel or draft.get("channel") or "", draft_id
                    ),
                ),
            )
        except Exception:  # noqa: BLE001
            pass

    @app.command("/add-skin")
    def cmd_add_skin(ack, body, client):
        ack()
        view = _add_skin_modal()
        view["private_metadata"] = body.get("channel_id") or body["user_id"]
        client.views_open(trigger_id=body["trigger_id"], view=view)

    @app.view("short_fighter_edit")
    def on_fighter_edit(ack, body, client):
        view = body.get("view") or {}
        try:
            meta = json.loads(view.get("private_metadata") or "{}")
        except json.JSONDecodeError:
            ack()
            return
        draft_id = str(meta.get("draft") or "")
        root_view_id = str(meta.get("root") or "")
        try:
            index = int(meta.get("index"))
        except (TypeError, ValueError):
            ack()
            return
        draft = _get_draft(draft_id)
        if not draft:
            ack()
            return
        values = (view.get("state") or {}).get("values") or {}
        _sync_draft_slots(draft)
        if index < 0 or index >= len(draft["slots"]):
            ack()
            return
        slot = draft["slots"][index]
        name = (_field(values, "name") or "none").strip() or "none"
        slot["name"] = name
        slot["weaponId"] = (_field(values, "weapon") or slot.get("weaponId") or "sword")
        slot["powerupId"] = (_field(values, "powerup") or "none")
        slot["health"] = (_field(values, "health") or "").strip()
        slot["radius"] = (_field(values, "radius") or "").strip()
        slot["mass"] = (_field(values, "mass") or "").strip()
        ack()

        channel = draft.get("channel") or ""
        parent = _short_modal(
            draft_id=draft_id,
            private_metadata=_short_meta(channel, draft_id),
        )
        if root_view_id:
            try:
                client.views_update(view_id=root_view_id, view=parent)
            except Exception:  # noqa: BLE001
                traceback.print_exc()

    @app.view("short_setup")
    def on_short_setup(ack, body, client):
        view = body.get("view") or {}
        values = (view.get("state") or {}).get("values") or {}
        channel, draft_id = _parse_short_meta(view.get("private_metadata") or "")
        draft = _get_draft(draft_id)
        if not draft:
            ack(
                response_action="errors",
                errors={"prompt": "Form expired — close and run /short again"},
            )
            return
        try:
            setup, takes = _resolve_setup_from_draft(draft, values)
        except Exception as exc:  # noqa: BLE001
            err_block = "prompt" if (draft.get("prompt") or "").strip() else "mode"
            # Surface fighter errors on prompt when no fighter inputs exist on parent.
            ack(
                response_action="errors",
                errors={err_block: str(exc)[:100]},
            )
            return
        ack()
        _SHORT_DRAFTS.pop(draft_id, None)
        user = body["user"]["id"]
        reply_channel = channel or draft.get("channel") or user

        def work():
            try:
                ch = reply_channel
                if str(ch).startswith("U"):
                    im = client.conversations_open(users=ch)
                    ch = im["channel"]["id"]
                _run_candidates_job(
                    client, channel=ch, user=user, setup=setup, count=takes
                )
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                try:
                    _dm_user(
                        client,
                        user,
                        f"Could not start short in that channel: `{exc}`\n"
                        "Fix: invite the bot with `/invite @Ball Arena`, then `/short` again.",
                    )
                except Exception:  # noqa: BLE001
                    pass

        threading.Thread(target=work, daemon=True).start()

    @app.view("add_skin")
    def on_add_skin(ack, body, client):
        values = body["view"]["state"]["values"]
        name = (_field(values, "name") or "").strip()
        new_cat = (_field(values, "new_category") or "").strip()
        picked = (_field(values, "category") or "none").strip()
        if new_cat:
            category = new_cat
        elif picked and picked.lower() != "none":
            category = picked
        else:
            category = None
        file_id = _field(values, "image")
        if not name or not file_id:
            ack(
                response_action="errors",
                errors={"name": "Name and image are required"},
            )
            return
        ack()
        user = body["user"]["id"]
        meta = (body.get("view") or {}).get("private_metadata") or ""
        reply_channel = meta if meta.startswith(("C", "G", "D")) else None

        def work():
            try:
                data, ext = _download_slack_file(client, file_id, bot_token)
                result = ws.add_skin_bytes(name, data, ext=ext, category=category)
                text = (
                    f"Saved skin *{result['id']}* → `skins/{result['file']}` "
                    f"({len(result['files'])} skins total)."
                )
                if category:
                    text += f" Category *{category}* is in the /add-skin dropdown now."
                if reply_channel:
                    client.chat_postMessage(channel=reply_channel, text=f"<@{user}> {text}")
                else:
                    im = client.conversations_open(users=user)
                    client.chat_postMessage(channel=im["channel"]["id"], text=text)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                try:
                    msg = f"Add skin failed: `{exc}`"
                    if reply_channel:
                        client.chat_postMessage(
                            channel=reply_channel, text=f"<@{user}> {msg}"
                        )
                    else:
                        im = client.conversations_open(users=user)
                        client.chat_postMessage(channel=im["channel"]["id"], text=msg)
                except Exception:  # noqa: BLE001
                    pass

        threading.Thread(target=work, daemon=True).start()

    @app.action(re.compile(r"post_take_\d+"))
    def on_post_take(ack, body, client):
        ack()
        value = body["actions"][0]["value"]
        job_id, _, idx_s = value.partition(":")
        index = int(idx_s)
        user = body["user"]["id"]
        channel = body["channel"]["id"]
        message_ts = body["message"]["ts"]
        job = ws.load_candidate_job(job_id) or {}
        candidates = job.get("candidates") or []
        resolved = (job.get("resolved") or {})
        fighters = resolved.get("fighters") or []
        label = " vs ".join(str(x) for x in fighters) if fighters else "matchup"
        if job.get("decided"):
            client.chat_postMessage(
                channel=channel,
                thread_ts=message_ts,
                text=f"<@{user}> Already decided: {job['decided']}",
            )
            return

        decided = f"Posting take {index + 1} to YouTube…"
        job["decided"] = decided
        ws.save_candidate_job(job)
        _lock_pick_message(
            client,
            channel=channel,
            message_ts=message_ts,
            user=user,
            job_id=job_id,
            candidates=candidates,
            label=label,
            decided=decided,
        )

        def work():
            try:
                result = ws.upload_candidate(job_id, index)
                url = result.get("shortsUrl") or result.get("watchUrl") or "(no url)"
                done = (
                    f"Posted take {index + 1}: {url}\n`{result.get('title')}`"
                )
                if isinstance(result.get("tiktok"), dict):
                    tk = result["tiktok"]
                    done += f"\nTikTok: `{tk.get('status') or 'ok'}`"
                    if tk.get("shareUrl"):
                        done += f" {tk['shareUrl']}"
                elif result.get("tiktokError"):
                    done += f"\nTikTok failed: `{result['tiktokError']}`"
                job2 = ws.load_candidate_job(job_id) or job
                job2["decided"] = done
                ws.save_candidate_job(job2)
                _lock_pick_message(
                    client,
                    channel=channel,
                    message_ts=message_ts,
                    user=user,
                    job_id=job_id,
                    candidates=candidates,
                    label=label,
                    decided=done,
                )
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                # Unlock so they can retry / skip
                job2 = ws.load_candidate_job(job_id) or job
                job2.pop("decided", None)
                ws.save_candidate_job(job2)
                try:
                    _post_pick_buttons(
                        client,
                        channel=channel,
                        user=user,
                        job_id=job_id,
                        candidates=candidates,
                        label=label,
                        status_ts=message_ts,
                    )
                except Exception:  # noqa: BLE001
                    pass
                client.chat_postMessage(
                    channel=channel,
                    thread_ts=message_ts,
                    text=f"<@{user}> Upload failed: `{exc}` — pick again or Don't post.",
                )

        threading.Thread(target=work, daemon=True).start()

    @app.action("reject_job")
    def on_reject(ack, body, client):
        ack()
        user = body["user"]["id"]
        channel = body["channel"]["id"]
        message_ts = body["message"]["ts"]
        job_id = body["actions"][0]["value"]
        job = ws.load_candidate_job(job_id) or {}
        if job.get("decided"):
            return
        candidates = job.get("candidates") or []
        resolved = job.get("resolved") or {}
        fighters = resolved.get("fighters") or []
        label = " vs ".join(str(x) for x in fighters) if fighters else "matchup"
        decided = "Skipped — nothing posted."
        job["decided"] = decided
        if job.get("jobId"):
            ws.save_candidate_job(job)
        _lock_pick_message(
            client,
            channel=channel,
            message_ts=message_ts,
            user=user,
            job_id=job_id,
            candidates=candidates,
            label=label,
            decided=decided,
        )

    bot_user_id = {"id": None}
    allowed_channel = os.environ.get("SLACK_CHANNEL_ID", "").strip()

    def _bot_id(client) -> str | None:
        if bot_user_id["id"]:
            return bot_user_id["id"]
        try:
            bot_user_id["id"] = client.auth_test()["user_id"]
        except Exception:  # noqa: BLE001
            return None
        return bot_user_id["id"]

    def _handle_prompt_message(event, client, text: str):
        text = (text or "").strip()
        # Strip bot mention
        text = re.sub(r"<@[^>]+>\s*", "", text).strip()
        if not text or not _looks_like_fight_prompt(text):
            return
        channel = event["channel"]
        if allowed_channel and channel != allowed_channel and event.get("channel_type") != "im":
            return
        user = event["user"]
        thread = event.get("thread_ts") or event["ts"]

        def work():
            try:
                setup = ws.setup_from_request(prompt=text)
                _run_candidates_job(
                    client,
                    channel=channel,
                    user=user,
                    setup=setup,
                    thread_ts=thread,
                )
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                client.chat_postMessage(
                    channel=channel,
                    thread_ts=thread,
                    text=f"<@{user}> Could not start short: `{exc}`",
                )

        threading.Thread(target=work, daemon=True).start()

    @app.event("app_mention")
    def on_mention(event, client):
        _handle_prompt_message(event, client, event.get("text") or "")

    @app.event("message")
    def on_message(event, client):
        if event.get("subtype") or event.get("bot_id"):
            return
        text = event.get("text") or ""
        bid = _bot_id(client)
        if bid and f"<@{bid}>" in text:
            return  # app_mention handler owns these
        channel_type = event.get("channel_type")
        if channel_type == "im" or _looks_like_fight_prompt(text):
            _handle_prompt_message(event, client, text)

    handler = SocketModeHandler(app, app_token)
    return app, handler


def start_slack_bot_background() -> None:
    _load_dotenv()
    bot_token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    app_token = os.environ.get("SLACK_APP_TOKEN", "").strip()
    if not bot_token or not app_token:
        print(
            "Slack bot idle — add SLACK_BOT_TOKEN + SLACK_APP_TOKEN to server/.env "
            "(see server/slack_bot.py docstring). Then use /short, /long, etc.",
            file=sys.stderr,
        )
        return

    try:
        app, handler = build_app()
    except Exception as exc:  # noqa: BLE001
        print(f"Slack bot failed to start: {exc}", file=sys.stderr)
        traceback.print_exc()
        return
    if not handler:
        return

    def run() -> None:
        print(
            "Slack bot → Socket Mode connected "
            "(/short /short-pick /add-skin /long /quota /arena-status /cancel "
            "/skins /weapons /random-short)",
            file=sys.stderr,
        )
        handler.start()

    threading.Thread(target=run, daemon=True, name="slack-bot").start()


if __name__ == "__main__":
    _load_dotenv()
    _, handler = build_app()
    if not handler:
        print(
            "Missing SLACK_BOT_TOKEN / SLACK_APP_TOKEN in server/.env",
            file=sys.stderr,
        )
        sys.exit(1)
    print("Slack bot starting (Socket Mode)…", file=sys.stderr)
    handler.start()
