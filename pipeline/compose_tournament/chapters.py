"""Round labels and YouTube chapter timestamps."""
from __future__ import annotations

from . import config


def parse_match_round(match: dict | None, match_key: str = "") -> int:
    if isinstance(match, dict) and match.get("round") is not None:
        try:
            return int(match["round"])
        except (TypeError, ValueError):
            pass
    mid = ""
    if isinstance(match, dict) and match.get("id"):
        mid = str(match["id"])
    elif match_key:
        mid = str(match_key).split("|", 1)[0]
    found = config.MATCH_ID.match(mid)
    return int(found.group(1)) if found else 0


def round_label(round_index: int, total_rounds: int) -> str:
    from_end = max(0, int(total_rounds) - 1 - int(round_index))
    if from_end == 0:
        return "Final"
    if from_end == 1:
        return "Semifinals"
    if from_end == 2:
        return "Quarterfinals"
    players_here = 2 ** (from_end + 1)
    if players_here >= 16:
        return f"Round of {players_here}"
    return f"Round {int(round_index) + 1}"


def round_card(
    bracket: dict | None,
    match: dict | None = None,
    *,
    match_key: str = "",
) -> dict:
    rounds = bracket.get("rounds") if isinstance(bracket, dict) else None
    total = len(rounds) if isinstance(rounds, list) and rounds else 1
    ri = min(max(0, parse_match_round(match, match_key)), total - 1)
    label = round_label(ri, total)
    row = rounds[ri] if isinstance(rounds, list) and ri < len(rounds) else []
    fights = [item for item in (row or []) if isinstance(item, dict) and not item.get("bye")]
    mid = ""
    if isinstance(match, dict) and match.get("id"):
        mid = str(match["id"])
    elif match_key:
        mid = str(match_key).split("|", 1)[0]
    idx = next((i for i, item in enumerate(fights) if item.get("id") == mid), 0)
    detail = "" if label == "Final" or len(fights) <= 1 else f"{idx + 1} OF {len(fights)}"
    return {
        "heading": "FINAL" if label == "Final" else label.upper(),
        "detail": detail,
        "roundLabel": label,
    }


def chapter_title_for(
    bracket: dict | None,
    match: dict | None,
    a_name: str | None,
    b_name: str | None,
    *,
    match_key: str = "",
) -> str:
    card = round_card(bracket, match, match_key=match_key)
    left = (a_name or "").strip()
    right = (b_name or "").strip()
    vs = f"{left} vs {right}" if left and right else (left or right)
    if vs:
        return f"{card['roundLabel']} — {vs}"
    return card["roundLabel"]


def format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def build_chapters(
    segments: list,
    *,
    champion_name: str | None = None,
    champion_duration: float = 0.0,
    intro_duration: float = 0.0,
) -> list[dict]:
    chapters: list[dict] = []
    cursor = 0.0
    if intro_duration > 0:
        chapters.append({"at": 0.0, "title": "Intro"})
        cursor += float(intro_duration)
    for entry in segments or []:
        if not isinstance(entry, dict) or entry.get("status") != "done":
            continue
        title = entry.get("chapterTitle") or ""
        if not title:
            left = entry.get("aName") or "Match"
            right = entry.get("bName")
            title = f"{left} vs {right}" if right else str(left)
        chapters.append({"at": round(cursor, 3), "title": title})
        cursor += float(entry.get("duration") or 0)
    if champion_duration > 0 or champion_name:
        label = f"Champion — {champion_name}" if champion_name else "Champion"
        chapters.append({"at": round(cursor, 3), "title": label})
    return chapters


def format_chapters_description(chapters: list) -> str:
    lines = []
    for item in chapters or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        lines.append(f"{format_timestamp(float(item.get('at') or 0))} {title}")
    return "\n".join(lines)
