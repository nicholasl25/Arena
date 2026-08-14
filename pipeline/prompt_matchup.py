"""Resolve a natural-language fight request into an offline-record matchup."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import Path

FUN_DIR = Path(__file__).resolve().parent.parent
BALLS_DIR = FUN_DIR / "premade-balls"
WEAPONS_DIR = FUN_DIR / "premade-weapons"
SKINS_DIR = FUN_DIR / "skins"

# Common misspellings / nicknames → catalog id
SKIN_ALIASES = {
    "daeon": "daemon",
    "demon": "daemon",
    "spider-man": "spiderman",
    "spider man": "spiderman",
    "dr strange": "dr. strange",
    "doctor strange": "dr. strange",
    "mcgregor": "connor mcgregor",
    "connor": "connor mcgregor",
    "topuria": "ilia topuria",
    "makhachev": "islam makhachev",
    "kobe": "kobe bryant",
    "jaime": "jaime lannister",
    "jamie lannister": "jaime lannister",
}

WEAPON_ALIASES = {
    "swords": "sword",
    "blade": "sword",
    "blades": "sword",
    "daggers": "dagger",
    "hammers": "hammer",
    "staffs": "staff",
    "staves": "staff",
    "bows": "bow",
    "lasers": "laser",
    "shields": "shield",
    "fists": "fists",
    "punch": "fists",
    "punches": "fists",
    "hands": "fists",
    "spikes": "spikes",
    "webs": "webs",
    "slingshots": "slingshot",
    "basketballs": "basketball",
    "boomerang": "boomerang",
    "boomerangs": "boomerang",
    "thunderrod": "thunderrod",
    "thunder rod": "thunderrod",
    "thunder rods": "thunderrod",
    "lightning rod": "thunderrod",
    "lightning bolt": "thunderrod",
    "lightning bolts": "thunderrod",
    "zeus bolt": "thunderrod",
    "witch": "witch",
    "witches": "witch",
    "bats": "witch",
}

WEAPON_HINTS = (
    "sword", "swords", "blade", "weapon", "weapons", "dagger", "hammer",
    "staff", "bow", "laser", "shield", "fist", "fists", "spike", "web",
    "slingshot", "basketball", "boomerang", "thunder", "thunderrod",
    "lightning", "bolt", "witch", "bat",
    "fighting with", "armed",
)


def _js_str(source: str, key: str) -> str | None:
    m = re.search(rf"{key}:\s*'((?:\\.|[^'\\])*)'", source)
    if not m:
        return None
    return m.group(1).replace("\\'", "'").replace('\\"', '"')


def load_ball_fighters() -> dict[str, str]:
    """id -> display name"""
    out: dict[str, str] = {}
    if not BALLS_DIR.is_dir():
        return out
    for js in BALLS_DIR.glob("*.js"):
        if js.name in {"index.js", "registry.js"}:
            continue
        source = js.read_text()
        m = re.search(r"PremadeBallRegistry\.register\(\s*'([^']+)'", source)
        if not m:
            continue
        ball_id = m.group(1)
        out[ball_id] = _js_str(source, "name") or ball_id.replace("-", " ").title()
    return out


def load_skin_fighters() -> dict[str, str]:
    """id -> display name (id is lowercased filename stem). Skips skins/Default/."""
    out: dict[str, str] = {}
    if not SKINS_DIR.is_dir():
        return out
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    for path in SKINS_DIR.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in exts:
            continue
        rel = path.relative_to(SKINS_DIR)
        if rel.parts and rel.parts[0] == "Default":
            continue
        skin_id = path.stem.lower()
        out[skin_id] = path.stem.replace("-", " ").replace("_", " ")
    return out


def load_weapon_names() -> dict[str, str]:
    """id -> display name"""
    out: dict[str, str] = {}
    if not WEAPONS_DIR.is_dir():
        return out
    skip = {"index.js", "registry.js"}
    for js in WEAPONS_DIR.glob("*.js"):
        if js.name in skip:
            continue
        source = js.read_text()
        m = re.search(r"PremadeWeaponRegistry\.register\(\s*'([^']+)'", source)
        if not m:
            continue
        weapon_id = m.group(1)
        out[weapon_id] = _js_str(source, "name") or weapon_id.replace("-", " ").title()
    return out


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _score_name(prompt: str, name: str) -> float:
    """How well `name` appears in prompt (1.0 = exact phrase)."""
    n = _norm(name)
    if not n:
        return 0.0
    if re.search(rf"\b{re.escape(n)}\b", prompt):
        return 1.0
    # fuzzy: best window similarity
    words = n.split()
    prompt_words = prompt.split()
    if not prompt_words:
        return 0.0
    best = 0.0
    span = max(1, len(words))
    for i in range(len(prompt_words)):
        chunk = " ".join(prompt_words[i : i + span + 1])
        best = max(best, SequenceMatcher(None, n, chunk).ratio())
        chunk2 = " ".join(prompt_words[i : i + span])
        best = max(best, SequenceMatcher(None, n, chunk2).ratio())
    # single-token fuzzy (Daeon ~ Daemon)
    if len(words) == 1:
        for pw in prompt_words:
            if len(pw) < 3:
                continue
            best = max(best, SequenceMatcher(None, n, pw).ratio())
    return best


def _apply_aliases(prompt: str, aliases: dict[str, str]) -> str:
    text = prompt
    for alias, target in sorted(aliases.items(), key=lambda kv: -len(kv[0])):
        text = re.sub(rf"\b{re.escape(alias)}\b", target, text)
    return text


def _find_fighters(prompt: str, catalog: dict[str, str], *, limit: int = 2) -> list[tuple[str, float]]:
    scored: list[tuple[str, float, int]] = []
    for fid, name in catalog.items():
        score = max(_score_name(prompt, fid), _score_name(prompt, name))
        if score < 0.72:
            continue
        # prefer earlier mention
        pos = prompt.find(_norm(name))
        if pos < 0:
            pos = prompt.find(fid)
        if pos < 0:
            pos = 10_000
        scored.append((fid, score, pos))
    scored.sort(key=lambda row: (-row[1], row[2]))
    picked: list[tuple[str, float]] = []
    seen: set[str] = set()
    for fid, score, _ in scored:
        if fid in seen:
            continue
        seen.add(fid)
        picked.append((fid, score))
        if len(picked) >= limit:
            break
    return picked


def _find_weapons(prompt: str, weapons: dict[str, str]) -> list[str]:
    found: list[tuple[int, str]] = []
    for wid, name in weapons.items():
        for label in {wid, _norm(name), WEAPON_ALIASES.get(wid, wid)}:
            label = _norm(label)
            for m in re.finditer(rf"\b{re.escape(label)}\b", prompt):
                found.append((m.start(), wid))
    # also alias keys that map into weapons
    for alias, wid in WEAPON_ALIASES.items():
        if wid not in weapons:
            continue
        for m in re.finditer(rf"\b{re.escape(alias)}\b", prompt):
            found.append((m.start(), wid))
    found.sort(key=lambda row: row[0])
    ordered: list[str] = []
    for _, wid in found:
        if wid not in ordered:
            ordered.append(wid)
    return ordered


def _wants_weapon_mode(prompt: str, weapon_hits: list[str]) -> bool:
    if weapon_hits:
        return True
    return any(hint in prompt for hint in WEAPON_HINTS)


def default_intro_mode() -> tuple[str, list[str]]:
    """Prefer default VS intro when Sukuna/Gojo (or first two) intros exist."""
    intros_dir = FUN_DIR / "intros"
    if not intros_dir.is_dir():
        return "skip", []
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    ids = sorted(
        p.stem.lower()
        for p in intros_dir.iterdir()
        if p.is_file() and p.suffix.lower() in exts
    )
    preferred = [i for i in ("sukuna", "gojo") if i in ids]
    if len(preferred) >= 2:
        return "default", preferred[:2]
    if len(ids) >= 2:
        return "default", ids[:2]
    return "skip", []


def resolve_fighter_name(name: str, *, mode: str = "weapon") -> tuple[str, str]:
    """Resolve a typed fighter/skin name to (id, display_name)."""
    raw = (name or "").strip()
    if not raw:
        raise ValueError("fighter name is empty")
    text = _apply_aliases(_norm(raw), SKIN_ALIASES)
    if mode == "weapon":
        catalog = load_skin_fighters()
        kind = "skin"
    else:
        catalog = load_ball_fighters()
        kind = "fighter"
    if not catalog:
        raise ValueError(f"no {kind}s available")
    key = text
    if key in catalog:
        return key, catalog[key]
    # Exact display-name match
    for fid, label in catalog.items():
        if _norm(label) == text:
            return fid, label
    hits = _find_fighters(text, catalog, limit=1)
    if not hits:
        raise ValueError(f"Unknown {kind}: {raw}")
    fid = hits[0][0]
    return fid, catalog[fid]


def resolve_prompt_matchup(prompt: str) -> dict:
    """
    Turn NL like "Make a video of Daeon and Aragorn fighting with swords"
    into {mode, matchup, introMode, intros, prompt, resolved}.
    """
    raw = (prompt or "").strip()
    if not raw:
        raise ValueError("prompt is empty")

    text = _norm(raw)
    text = _apply_aliases(text, SKIN_ALIASES)

    skins = load_skin_fighters()
    balls = load_ball_fighters()
    weapons = load_weapon_names()
    weapon_hits = _find_weapons(text, weapons)
    weapon_mode = _wants_weapon_mode(text, weapon_hits)

    if weapon_mode:
        fighters = _find_fighters(text, skins, limit=2)
        if len(fighters) < 2:
            missing = " / ".join(sorted(skins.values())[:12])
            raise ValueError(
                f"Need two skins in the prompt. Could not resolve both fighters. "
                f"Examples: {missing}…"
            )
        w_ids = weapon_hits or ["sword"]
        if len(w_ids) == 1:
            w_a = w_b = w_ids[0]
        else:
            w_a, w_b = w_ids[0], w_ids[1]
        matchup = [
            {"id": fighters[0][0], "config": {"weaponId": w_a}},
            {"id": fighters[1][0], "config": {"weaponId": w_b}},
        ]
        mode = "weapon"
        resolved = {
            "fighters": [skins[fighters[0][0]], skins[fighters[1][0]]],
            "weapons": [weapons.get(w_a, w_a), weapons.get(w_b, w_b)],
        }
    else:
        fighters = _find_fighters(text, balls, limit=2)
        if len(fighters) < 2:
            # fall back to skins as weapon fight with default sword
            fighters = _find_fighters(text, skins, limit=2)
            if len(fighters) < 2:
                raise ValueError(
                    "Need two fighters in the prompt "
                    '(e.g. "Daemon and Aragorn fighting with swords")'
                )
            matchup = [
                {"id": fighters[0][0], "config": {"weaponId": "sword"}},
                {"id": fighters[1][0], "config": {"weaponId": "sword"}},
            ]
            mode = "weapon"
            resolved = {
                "fighters": [skins[fighters[0][0]], skins[fighters[1][0]]],
                "weapons": ["Sword", "Sword"],
            }
        else:
            matchup = [
                {"id": fighters[0][0], "config": {}},
                {"id": fighters[1][0], "config": {}},
            ]
            mode = "collision"
            resolved = {
                "fighters": [balls[fighters[0][0]], balls[fighters[1][0]]],
                "weapons": [],
            }

    intro_mode, intros = default_intro_mode()
    return {
        "mode": mode,
        "matchup": matchup,
        "introMode": intro_mode,
        "intros": intros,
        "prompt": raw,
        "resolved": resolved,
    }
