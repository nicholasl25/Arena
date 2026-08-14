"""Skins, intros, placements, and option lists for the workflow UI / Slack."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .config import ARENA_DIR, INTRO_EXTS, INTROS_DIR, SKIN_EXTS, SKINS_DIR


def list_skin_files() -> list[str]:
    """Relative paths under skins/ (posix). Skips skins/Default/."""
    if not SKINS_DIR.is_dir():
        return []
    files: list[str] = []
    for p in SKINS_DIR.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in SKIN_EXTS:
            continue
        rel = p.relative_to(SKINS_DIR)
        if rel.parts and rel.parts[0] == "Default":
            continue
        files.append(rel.as_posix())
    return sorted(files)


def write_skin_manifest() -> list[str]:
    """Rescan skins/ and refresh manifest.json for the static arena UI."""
    SKINS_DIR.mkdir(parents=True, exist_ok=True)
    files = list_skin_files()
    manifest = SKINS_DIR / "manifest.json"
    manifest.write_text(json.dumps(files, indent=2) + "\n")
    return files


def list_intro_files() -> list[str]:
    if not INTROS_DIR.is_dir():
        return []
    return sorted(
        p.name
        for p in INTROS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in INTRO_EXTS
    )


def write_intro_manifest() -> list[str]:
    """Rescan intros/ and refresh manifest.json for the workflow UI."""
    INTROS_DIR.mkdir(parents=True, exist_ok=True)
    (INTROS_DIR / "music").mkdir(parents=True, exist_ok=True)
    files = list_intro_files()
    manifest = INTROS_DIR / "manifest.json"
    manifest.write_text(json.dumps(files, indent=2) + "\n")
    placements_path = INTROS_DIR / "placements.json"
    if not placements_path.is_file():
        placements_path.write_text("{}\n")
    return files


def _clamp01(value: object, fallback: float) -> float:
    try:
        n = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    if n != n:  # NaN
        return fallback
    return max(0.0, min(1.0, n))


def normalize_intro_placement(raw: dict | None) -> dict:
    raw = raw or {}
    radius = _clamp01(raw.get("radius"), 0.14)
    if radius <= 0:
        radius = 0.14
    return {
        "x": _clamp01(raw.get("x"), 0.5),
        "y": _clamp01(raw.get("y"), 0.4),
        "radius": radius,
    }


def load_intro_placements() -> dict[str, dict]:
    write_intro_manifest()
    path = INTROS_DIR / "placements.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict] = {}
    for key, value in data.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        out[key.lower()] = normalize_intro_placement(value)
    return out


def save_intro_placement(intro_id: str, placement: dict) -> dict:
    intro_id = intro_id.strip().lower()
    if not intro_id:
        raise ValueError("id required")
    files = list_intro_files()
    ids = {Path(name).stem.lower() for name in files}
    if intro_id not in ids:
        raise ValueError(f'unknown intro "{intro_id}"')
    all_placements = load_intro_placements()
    normalized = normalize_intro_placement(placement)
    all_placements[intro_id] = normalized
    path = INTROS_DIR / "placements.json"
    path.write_text(json.dumps(all_placements, indent=2, sort_keys=True) + "\n")
    return normalized


def list_skin_categories() -> list[str]:
    """Top-level folder names under skins/ (excludes Default)."""
    if not SKINS_DIR.is_dir():
        return []
    cats: list[str] = []
    for path in SKINS_DIR.iterdir():
        if not path.is_dir():
            continue
        if path.name.lower() == "default":
            continue
        cats.append(path.name)
    return sorted(cats, key=str.lower)


def add_skin_bytes(
    name: str,
    data: bytes,
    *,
    ext: str = ".png",
    category: str | None = None,
) -> dict:
    """Save an uploaded image into skins/ and refresh the manifest."""
    stem = re.sub(r"[^a-zA-Z0-9 _.-]+", "", (name or "").strip()).strip(" ._")
    if not stem:
        raise ValueError("skin name required")
    suffix = ext.lower() if ext.startswith(".") else f".{ext.lower()}"
    if suffix not in SKIN_EXTS:
        raise ValueError(f"unsupported image type: {suffix}")
    folder = SKINS_DIR
    if category:
        cat = re.sub(r"[^a-zA-Z0-9 _-]+", "", category.strip()).strip()
        if cat and cat.lower() != "default":
            folder = SKINS_DIR / cat
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{stem}{suffix}"
    if dest.exists():
        raise ValueError(f"skin already exists: {dest.relative_to(SKINS_DIR).as_posix()}")
    dest.write_bytes(data)
    files = write_skin_manifest()
    rel = dest.relative_to(SKINS_DIR).as_posix()
    return {"ok": True, "file": rel, "id": dest.stem.lower(), "files": files}


def list_weapon_options() -> list[dict]:
    from .pipeline_ops import load_prompt_matchup

    weapons = load_prompt_matchup().load_weapon_names()
    return [{"id": wid, "name": name} for wid, name in sorted(weapons.items(), key=lambda r: r[1].lower())]


def list_powerup_options() -> list[dict]:
    """Parse premade-powerups/*.js register() ids → [{id, name}]."""
    folder = ARENA_DIR / "premade-powerups"
    out: dict[str, str] = {}
    if not folder.is_dir():
        return []
    for js in folder.glob("*.js"):
        if js.name in {"index.js", "registry.js"}:
            continue
        source = js.read_text()
        for m in re.finditer(
            r"PremadePowerupRegistry\.register\(\s*'([^']+)'[\s\S]*?name:\s*'((?:\\.|[^'\\])*)'",
            source,
        ):
            out[m.group(1)] = m.group(2).replace("\\'", "'")
    return [{"id": pid, "name": name} for pid, name in sorted(out.items(), key=lambda r: r[1].lower())]


def list_skin_options() -> list[dict]:
    """Weapon-arena skins → [{id, name, color?}] with category prefix when nested."""
    if not SKINS_DIR.is_dir():
        return []
    color_cache: dict[str, dict[str, str]] = {}
    out: list[dict] = []
    for path in sorted(SKINS_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SKIN_EXTS:
            continue
        rel = path.relative_to(SKINS_DIR)
        if rel.parts and rel.parts[0] == "Default":
            continue
        skin_id = path.stem.lower()
        label = path.stem.replace("-", " ").replace("_", " ")
        category = rel.parts[0] if len(rel.parts) > 1 else ""
        if category:
            label = f"{category} / {label}"
        row = {"id": skin_id, "name": label}
        if category:
            if category not in color_cache:
                color_cache[category] = load_folder_colors(category)
            color = color_cache[category].get(skin_id)
            if color:
                row["color"] = color
        out.append(row)
    out.sort(key=lambda r: r["name"].lower())
    return out


def list_ball_options() -> list[dict]:
    """Collision-mode premade balls → [{id, name}]."""
    from .pipeline_ops import load_prompt_matchup

    balls = load_prompt_matchup().load_ball_fighters()
    return [
        {"id": bid, "name": name}
        for bid, name in sorted(balls.items(), key=lambda r: r[1].lower())
    ]


def list_intro_options() -> list[dict]:
    """Intro image stems in intros/ → [{id, name}]."""
    write_intro_manifest()
    out: list[dict] = []
    for name in list_intro_files():
        stem = Path(name).stem
        intro_id = stem.lower()
        label = stem.replace("-", " ").replace("_", " ")
        out.append({"id": intro_id, "name": label})
    return sorted(out, key=lambda r: r["name"].lower())


def load_folder_colors(category: str) -> dict[str, str]:
    """skins/<category>/colors.json → {skin_id: #rrggbb}."""
    cat = (category or "").strip()
    if not cat:
        return {}
    path = SKINS_DIR / cat / "colors.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in data.items():
        if not isinstance(value, str):
            continue
        hex_color = value.strip().lower()
        if re.fullmatch(r"#[0-9a-f]{6}", hex_color):
            out[str(key).strip().lower()] = hex_color
    return out


def list_skins_in_category(category: str) -> list[dict]:
    """Skins inside skins/<category>/ → [{id, name, file, color?}]."""
    cat = (category or "").strip()
    if not cat or cat.lower() in {"none", "default"}:
        return []
    folder = SKINS_DIR / cat
    if not folder.is_dir():
        raise ValueError(f"unknown skin folder: {cat}")
    colors = load_folder_colors(cat)
    out: list[dict] = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SKIN_EXTS:
            continue
        skin_id = path.stem.lower()
        label = path.stem.replace("-", " ").replace("_", " ")
        row = {"id": skin_id, "name": label, "file": path.name}
        if skin_id in colors:
            row["color"] = colors[skin_id]
        out.append(row)
    return out
