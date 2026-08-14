"""Titles, descriptions, and hashtags for Shorts / long tournament uploads."""
from __future__ import annotations

import random
import re
from pathlib import Path

from .pipeline_ops import load_compose_short, load_compose_tournament

# Description hashtags: usual + battle/arena/fight/minecraft/gaming/sandbox.
# Each draft picks ~6 at random (always keeps Shorts when present).
HASHTAG_POOL = (
    "Shorts",
    "physics",
    "simulation",
    "gaming",
    "battle",
    "arena",
    "fight",
    "minecraft",
    "sandbox",
)
DESCRIPTION_HASHTAG_COUNT = 6


def pick_description_hashtags(count: int = DESCRIPTION_HASHTAG_COUNT) -> list[str]:
    """Random ~6 topical tags; always includes Shorts when available."""
    pool = list(dict.fromkeys(HASHTAG_POOL))
    if not pool:
        return []
    n = max(1, min(count, len(pool)))
    chosen = random.sample(pool, n)
    if "Shorts" in pool and "Shorts" not in chosen:
        chosen[-1] = "Shorts"
    if "Shorts" in chosen:
        chosen = ["Shorts"] + [t for t in chosen if t != "Shorts"]
    return chosen


def to_hashtag(label: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9]", "", label)
    return f"#{token}" if token else ""


def build_description(*fighters) -> str:
    names = []
    for entry in fighters:
        if isinstance(entry, dict):
            name = str(entry.get("name") or "").strip()
        else:
            name = str(entry or "").strip()
        if name:
            names.append(name)
    tags = [to_hashtag(tag) for tag in pick_description_hashtags()]
    tags.extend(to_hashtag(name) for name in names)
    # Dedupe while keeping order (#Shorts / topical first, then fighters).
    seen: set[str] = set()
    unique: list[str] = []
    for tag in tags:
        if not tag or tag.lower() in seen:
            continue
        seen.add(tag.lower())
        unique.append(tag)
    return " ".join(unique)


def is_tournament_final(filename: str | None) -> bool:
    return Path(filename or "").name == "tournament-final.mp4"


def build_long_title(manifest: dict | None) -> str:
    segs = [
        entry for entry in ((manifest or {}).get("segments") or [])
        if isinstance(entry, dict) and entry.get("status") == "done"
    ]
    champ = segs[-1].get("winnerName") if segs else None
    if champ:
        return f"{champ} wins the Ball Arena tournament"[:100]
    return "Ball Arena tournament"


def build_long_description(manifest: dict | None) -> str:
    ct = load_compose_tournament()
    tags = " ".join(
        to_hashtag(tag)
        for tag in ("physics", "simulation", "gaming", "arena", "battle", "tournament")
    )
    data = manifest if isinstance(manifest, dict) else {}
    chapters = (data.get("stitch") or {}).get("chapters")
    if not chapters:
        chapters = ct.build_chapters(
            [entry for entry in (data.get("segments") or []) if entry.get("status") == "done"]
        )
    body = (data.get("stitch") or {}).get("chaptersText") or ct.format_chapters_description(chapters)
    return f"{tags}\n\n{body}".strip() if body else tags


def build_title(fighters: list) -> str:
    """YouTube title (≤100 chars). Same-color teams join with 'and'; foes with 'vs.'"""
    cs = load_compose_short()
    matchup = cs.join_matchup_names(fighters)
    # Flat name list for stacking / truncation fallbacks.
    if fighters and isinstance(fighters[0], dict):
        names = [
            re.sub(r"\s+", " ", str(f.get("name") or "").strip())
            for f in fighters
            if isinstance(f, dict) and str(f.get("name") or "").strip()
        ]
    else:
        names = [re.sub(r"\s+", " ", (n or "").strip()) for n in fighters if (n or "").strip()]
    if len(names) < 2:
        names = (names + ["Fighter A", "Fighter B"])[:2]
        matchup = cs.join_matchup_names(names)

    cta = "who wins? #Shorts"
    limit = 100

    def fit(candidate: str) -> str | None:
        text = candidate.strip()
        return text if 0 < len(text) <= limit else None

    def stack_names(chosen: list[str]) -> str:
        if len(chosen) == 1:
            return chosen[0]
        return "\n".join([f"{n} vs." for n in chosen[:-1]] + [chosen[-1]])

    # Always keep a space before "who" (via " - ").
    def with_cta(label: str) -> str:
        return f"{label} - {cta}"

    if len(names) == 2 and " and " not in matchup:
        single = fit(with_cta(matchup))
        if single:
            return single
        return f"{names[0]} vs. {names[1]} #Shorts"[:limit]

    # Prefer full team-aware matchup on one line.
    stacked = fit(with_cta(matchup))
    if stacked:
        return stacked

    # One fighter per line; CTA stays on the last name line so "who" keeps its leading space.
    multiline = fit(with_cta(stack_names(names)))
    if multiline:
        return multiline

    # Keep every fighter if possible; drop the who-wins CTA.
    multiline = fit(f"{stack_names(names)}\n#Shorts")
    if multiline:
        return multiline

    # Budget ran out — include as many full names as fit (no dangling "vs.").
    chosen: list[str] = []
    for name in names:
        trial = fit(f"{stack_names(chosen + [name])}\n#Shorts")
        if not trial:
            break
        chosen.append(name)
    if len(chosen) < 2:
        a = names[0][:40].rstrip()
        b = names[1][:40].rstrip()
        return f"{a} vs.\n{b}\n#Shorts"[:limit]
    return f"{stack_names(chosen)}\n#Shorts"[:limit]
