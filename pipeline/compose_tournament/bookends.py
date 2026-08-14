"""Tournament intro/outro clip builders."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import step_log as slog

from . import config
from .captions import align_caption_words, build_bookend_ass, fallback_words, mix_spoken_overlay
from .media import make_title_card_clip, media_duration, mix_music_bed
from .tts import synthesize_timed

def join_spoken_names(names: list | None) -> str:
    clean = [str(name).strip() for name in (names or []) if str(name).strip()]
    if not clean:
        return ""
    if len(clean) == 1:
        return clean[0]
    if len(clean) == 2:
        return f"{clean[0]}, and {clean[1]}"
    return f"{', '.join(clean[:-1])}, and {clean[-1]}"


def _title_case_words(text: str) -> str:
    """Capitalize the first letter of each word; leave the rest of each word intact."""
    return " ".join(
        (word[:1].upper() + word[1:]) if word else ""
        for word in str(text).split()
    )


def build_intro_title(
    names: list | None = None,
    *,
    champion_name: str | None = None,
    skin_folder: str | None = None,
    weapon_mode: bool | None = None,
    entrant_count: int | None = None,
) -> str:
    """On-screen intro heading — never spoil the champion.

    Skins: "{Folder} Ball Arena Tournament"
    Weapons: "{N} Weapon Arena Tournament"
    """
    _ = champion_name  # call-site compat; must not appear in the title
    folder = (skin_folder or "").strip()
    if folder and folder.lower() != "none":
        return f"{_title_case_words(folder)} Ball Arena Tournament"

    count = entrant_count
    if count is None:
        count = len([n for n in (names or []) if str(n).strip()])

    # Named skin folders handled above; otherwise use competitor count for weapon tours.
    if weapon_mode is not False and count and count > 0:
        return f"{int(count)} Weapon Arena Tournament"
    return "Ball Arena Tournament"


def build_intro_script(
    names: list | None,
    *,
    weapon_spin: bool = False,
    powerup_spin: bool = False,
) -> str:
    clean = [str(name).strip() for name in (names or []) if str(name).strip()]
    if not clean:
        return ""
    bits = ["Welcome to the Ball Arena tournament."]
    # Listing every name gets unusable past a small field — speak the count instead.
    if len(clean) > 8:
        bits.append(f"{len(clean)} competitors enter the arena.")
    else:
        bits.append(f"{join_spoken_names(clean)}.")
    if weapon_spin:
        bits.append("Each match they spin for a weapon.")
    if powerup_spin:
        bits.append("Powerups are on.")
    bits.append("Who takes the crown?")
    return " ".join(bits)


def build_outro_script(champion_name: str | None) -> str:
    name = (champion_name or "").strip() or "The champion"
    return f"{name} has won the tournament."


def fighter_names_from_bracket(state: dict | None) -> list[str]:
    fighters = (state or {}).get("fighters") if isinstance(state, dict) else None
    if not isinstance(fighters, list):
        return []
    names = []
    for fighter in fighters:
        if not isinstance(fighter, dict):
            continue
        name = str(fighter.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def is_skin_tournament(state: dict | None) -> bool:
    fighters = (state or {}).get("fighters") if isinstance(state, dict) else None
    if not isinstance(fighters, list):
        return False
    return any(
        isinstance(fighter, dict)
        and (fighter.get("id") or "") != "_weapon"
        and (fighter.get("skinId") or fighter.get("id"))
        for fighter in fighters
    )


def ensure_intro_clip(
    names: list | None,
    *,
    weapon_spin: bool = False,
    powerup_spin: bool = False,
    script: str | None = None,
    title: str | None = None,
    fighters: list | None = None,
    champion_name: str | None = None,
    base_url: str | None = None,
    weapon_mode: bool | None = None,
) -> Path | None:
    """Title + roster card, setup TTS, black karaoke captions. None if nothing to say."""
    text = (script or "").strip() or build_intro_script(
        names, weapon_spin=weapon_spin, powerup_spin=powerup_spin
    )
    if not text:
        return None
    config.ensure_dirs()
    out = config.CLIPS_DIR / "intro.mp4"
    heading = (title or "").strip() or build_intro_title(
        names,
        weapon_mode=weapon_mode if weapon_mode is not None else (not weapon_spin),
        entrant_count=len([n for n in (names or []) if str(n).strip()]),
    )
    roster = fighters if isinstance(fighters, list) else None
    show_weapons = bool(weapon_mode) if weapon_mode is not None else (not weapon_spin)
    slog.log(f"intro: {text}")
    with tempfile.TemporaryDirectory(prefix="tour-intro-") as tmp:
        tmp_dir = Path(tmp)
        vo = tmp_dir / "intro.mp3"
        words = asyncio.run(synthesize_timed(text, vo))
        vo_dur = media_duration(vo) if vo.is_file() else 0.0
        if not words:
            words = fallback_words(text, vo_dur)
        else:
            words = align_caption_words(text, words)
        dur = max(config.INTRO_MIN_SEC, vo_dur + config.INTRO_TAIL_PAD)
        silent = tmp_dir / "card.mp4"
        card_ok = False
        if base_url and roster:
            try:
                import tournament_record as tr  # noqa: WPS433

                tr.render_intro_card_clip(
                    silent,
                    title=heading,
                    fighters=roster,
                    weapon_mode=show_weapons,
                    base_url=base_url,
                    duration=dur,
                )
                card_ok = silent.is_file() and silent.stat().st_size > 0
            except Exception as exc:  # noqa: BLE001
                slog.log(f"intro: roster card failed ({exc}); falling back")
        if not card_ok:
            make_title_card_clip(
                silent,
                heading=heading,
                detail=join_spoken_names(names) if names else "",
                duration=dur,
            )
        ass_path = tmp_dir / "intro.ass"
        # Bottom captions so title + balls stay readable.
        ass_path.write_text(
            build_bookend_ass(words, align=2, font_size=48, margin_v=36)
        )
        mix_spoken_overlay(silent, vo_mp3=vo, ass_path=ass_path, out_path=out, extend_to=dur)
    mix_music_bed(out, volume=0.12)
    slog.log(f"intro: done {out.name} ({media_duration(out):.1f}s)")
    return out


def pick_champion_fighters(fighters: list | None, champion_name: str | None) -> list[dict]:
    """Return the roster entry for the champion (single-ball intro card)."""
    name = (champion_name or "").strip()
    if not name:
        return []
    needle = name.lower()
    for fighter in fighters or []:
        if not isinstance(fighter, dict):
            continue
        labels = (
            str(fighter.get("name") or "").strip(),
            str(fighter.get("id") or "").strip(),
            str(fighter.get("skinId") or "").strip(),
        )
        if any(label.lower() == needle for label in labels if label):
            return [fighter]
    return [{"name": name, "color": "#f59e0b"}]


def ensure_outro_clip(
    champion_name: str | None,
    *,
    script: str | None = None,
    title: str | None = None,
    fighters: list | None = None,
    weapon_mode: bool = False,
    base_url: str | None = None,
) -> Path | None:
    """Same intro graphic with only the winner, then '{name} has won the tournament'."""
    text = (script or "").strip() or build_outro_script(champion_name)
    if not text:
        return None
    config.ensure_dirs()
    out = config.CLIPS_DIR / "outro.mp4"
    slog.log(f"outro: {text}")
    from .media import ensure_victor_sting  # local import keeps bookends light

    sting = ensure_victor_sting()
    lead = float(config.OUTRO_LEAD_PAD)
    heading = (title or "").strip() or "Ball Arena Tournament"
    winners = pick_champion_fighters(fighters, champion_name)
    with tempfile.TemporaryDirectory(prefix="tour-outro-") as tmp:
        tmp_dir = Path(tmp)
        vo = tmp_dir / "outro.mp3"
        words = asyncio.run(synthesize_timed(text, vo))
        vo_dur = media_duration(vo) if vo.is_file() else 0.0
        if not words:
            words = fallback_words(text, vo_dur)
        else:
            words = align_caption_words(text, words)
        if lead > 0:
            words = [
                {
                    "text": w["text"],
                    "start": float(w["start"]) + lead,
                    "end": float(w["end"]) + lead,
                }
                for w in words
            ]
        need = max(
            config.OUTRO_MIN_SEC,
            lead + vo_dur + config.OUTRO_TAIL_PAD,
            lead + config.VICTOR_STING_SEC + 0.35,
        )
        silent = tmp_dir / "card.mp4"
        card_ok = False
        if base_url and winners:
            try:
                import tournament_record as tr  # noqa: WPS433

                tr.render_intro_card_clip(
                    silent,
                    title=heading,
                    fighters=winners,
                    weapon_mode=bool(weapon_mode),
                    base_url=base_url,
                    duration=need,
                )
                card_ok = silent.is_file() and silent.stat().st_size > 0
            except Exception as exc:  # noqa: BLE001
                slog.log(f"outro: champion card failed ({exc}); falling back")
        if not card_ok:
            make_title_card_clip(
                silent,
                heading=heading,
                detail=(champion_name or "").strip(),
                duration=need,
            )
        ass_path = tmp_dir / "outro.ass"
        ass_path.write_text(build_bookend_ass(words, align=2, font_size=64, margin_v=56))
        mix_spoken_overlay(
            silent,
            vo_mp3=vo,
            ass_path=ass_path,
            out_path=out,
            extend_to=need,
            sfx_wav=sting,
            sfx_volume=config.VICTOR_STING_VOLUME,
            vo_delay=lead,
            sfx_delay=lead,
        )
    mix_music_bed(out, volume=0.12)
    slog.log(f"outro: done {out.name} ({media_duration(out):.1f}s)")
    return out
