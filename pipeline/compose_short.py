#!/usr/bin/env python3
"""
Overlay a spoken intro + CapCut-style karaoke captions onto an arena recording.
Also speaks "{winner} wins" near the end when recordings/{name}.json has a winner.

Script format (auto-built from filename + premade ball bios):
    "{X} vs. {Y} — who will win? {X ability} {Y ability}"

The voiceover starts at t=0 and is shorter than the fight; captions highlight
each word as it is spoken, then disappear and the fight plays out.

Run standalone:
    python pipeline/compose_short.py                       # newest recordings/*.webm
    python pipeline/compose_short.py path/to/fight.webm

Output: {stem}-final.mp4 next to the input. post_short.py calls this
automatically when COMPOSE = True.

Requires: ffmpeg/ffprobe on PATH, edge-tts in youtube/.venv
(pip install -r youtube/requirements.txt).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parent.parent
_YT_DIR = ARENA_DIR / "youtube"

# Re-exec with youtube/.venv (has edge-tts) only when run as a script.
# Never execv on import — workflow_server loads this module in-process; replacing
# that process mid-job kills Slack takes right after raw recording finishes.
_VENV_PY = _YT_DIR / ".venv/bin/python"
try:
    import edge_tts  # noqa: F401
except ImportError:
    if (
        __name__ == "__main__"
        and _VENV_PY.is_file()
        and not os.environ.get("COMPOSE_SHORT_REEXEC")
    ):
        os.environ["COMPOSE_SHORT_REEXEC"] = "1"
        os.execv(str(_VENV_PY), [str(_VENV_PY), *sys.argv])
    if __name__ == "__main__":
        raise SystemExit(
            "edge-tts not installed. Run: "
            f"python3 -m venv {_YT_DIR}/.venv && "
            f"{_YT_DIR}/.venv/bin/pip install -r {_YT_DIR}/requirements.txt"
        )
    # Imported by workflow_server (Arena/venv): draft/helpers are fine; TTS compose
    # still runs as a subprocess via youtube/.venv.

# ============ CONFIG — edit these ============

# Voiceover (edge-tts). Try: en-US-GuyNeural, en-US-ChristopherNeural,
# en-US-AriaNeural. List all: .venv/bin/edge-tts --list-voices
VOICE = "en-AU-WilliamMultilingualNeural"
RATE = "+10%"  # speaking speed, e.g. "+0%", "+15%"

# Script template. Placeholders: {names} {bios}
SCRIPT_TEMPLATE = "{names} — who will win? {bios}"

# Weapon mode script
WEAPON_SCRIPT_TEMPLATE = "{names}, who will win?"

END_SCRIPT_TEMPLATE = "{winner} wins"
# Leave this much silence after the outro before the video ends (win-screen hold).
END_VO_TAIL_PAD = 0.45

# Per-ball overrides when the code bio reads badly aloud, keyed by premade id.
# e.g. {"exponential": "Every hit doubles its damage."}
BIO_OVERRIDES: dict[str, str] = {}

# Display spelling → TTS pronunciation. Captions keep the left side; audio uses the right.
# Matching is case-insensitive on letters only (so "McGregor," still hits).
SPEAK_AS: dict[str, str] = {
    "vs": "versus",
    "vs.": "versus",
    "McGregor": "muh Gregor",
    "Baratheon": "buh Rath ee un",
    "LeBron": "luh Bron",
    "Targaryen": "tar Gair ee un",
    "Targaryan": "tar Gair ee un",
    "Kobe": "koh bee",
    "Bryant": "bry ant",
    "Legolas": "LEG oh lass",
}

# Captions
WORDS_PER_LINE = 3
CAPTION_UPPERCASE = True
FONT_NAME = "Arial Black"
FONT_SIZE = 92            # in 1080x1440 coordinates
ACTIVE_COLOR = "&H0000FFFF"    # ASS &HAABBGGRR — yellow (spoken words)
UPCOMING_COLOR = "&H00FFFFFF"  # white (unspoken words)
OUTLINE_COLOR = "&H00000000"   # black
ALIGNMENT = 5             # 5 = dead center; 2 = bottom center; 8 = top center
MARGIN_V = 60             # vertical margin for alignment 2/8 (ignored for 5)

# Audio mix: fight SFX weight vs voiceover weight
FIGHT_AUDIO_WEIGHT = 0.7
VOICE_AUDIO_WEIGHT = 1.6

# VS intro at start of recording — delay opening voiceover until after it
INTRO_FPS = 30
DEFAULT_INTRO_SEC = 4.0
SHOW_CAPTIONS = False  # karaoke text overlay disabled for now

KEEP_INTERMEDIATES = False  # keep the .vo.mp3 / .ass files next to the output

# =============================================

RECORDINGS_DIR = ARENA_DIR / "recordings"
BALLS_DIR = ARENA_DIR / "premade-balls"
SKINS_DIR = ARENA_DIR / "skins"
WEAPONS_DIR = ARENA_DIR / "premade-weapons"


# ---------- fighter data from premade-balls/*.js ----------

def _js_str(source: str, key: str) -> str | None:
    m = re.search(rf"{key}:\s*'((?:\\.|[^'\\])*)'", source)
    if not m:
        return None
    return m.group(1).replace("\\'", "'").replace('\\"', '"')


def load_fighters() -> dict[str, dict[str, str]]:
    """Map premade id -> {name, bio} parsed from the registry calls."""
    fighters: dict[str, dict[str, str]] = {}
    for js in BALLS_DIR.glob("*.js"):
        source = js.read_text()
        m = re.search(r"PremadeBallRegistry\.register\(\s*'([^']+)'", source)
        if not m:
            continue
        ball_id = m.group(1)
        fighters[ball_id] = {
            "name": _js_str(source, "name") or ball_id.title(),
            "bio": BIO_OVERRIDES.get(ball_id) or _js_str(source, "bio") or "",
        }
    return fighters


def load_skins() -> dict[str, dict[str, str]]:
    """Map skin id -> {name} from image filenames in skins/ (incl. category subfolders)."""
    skins: dict[str, dict[str, str]] = {}
    if not SKINS_DIR.is_dir():
        return skins
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    for path in sorted(SKINS_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in exts:
            continue
        rel = path.relative_to(SKINS_DIR)
        if rel.parts and rel.parts[0] == "Default":
            continue
        skin_id = path.stem.lower()
        name = path.stem.replace("-", " ").replace("_", " ").title()
        skins[skin_id] = {
            "name": name,
            "bio": "",
        }
    return skins


def load_weapons() -> dict[str, dict[str, str]]:
    """Map weapon id -> {name, bio} from premade-weapons/*.js registry calls."""
    weapons: dict[str, dict[str, str]] = {}
    if not WEAPONS_DIR.is_dir():
        return weapons
    skip = {"index.js", "registry.js"}
    for js in WEAPONS_DIR.glob("*.js"):
        if js.name in skip:
            continue
        source = js.read_text()
        m = re.search(r"PremadeWeaponRegistry\.register\(\s*'([^']+)'", source)
        if not m:
            continue
        weapon_id = m.group(1)
        weapons[weapon_id] = {
            "name": _js_str(source, "name") or weapon_id.replace("-", " ").title(),
            "bio": BIO_OVERRIDES.get(weapon_id) or _js_str(source, "bio") or "",
        }
    return weapons


def resolve_weapon_fighter(
    fighter_id: str,
    skins: dict[str, dict[str, str]],
    weapons: dict[str, dict[str, str]],
) -> dict[str, str]:
    """Resolve a weapon-mode filename slug to a display name (skin, else weapon)."""
    if fighter_id in skins:
        return skins[fighter_id]
    if fighter_id in weapons:
        return weapons[fighter_id]
    return {
        "name": fighter_id.replace("-", " ").title(),
        "bio": "",
    }


def parse_fighter_ids(path: Path) -> tuple[list[str], bool]:
    base = path.stem
    if base.rsplit("-", 1)[-1].isdigit():
        base = base.rsplit("-", 1)[0]
    weapon_mode = base.startswith("weapon-")
    if weapon_mode:
        base = base[len("weapon-"):]
    if "-vs-" not in base:
        raise SystemExit(f"Cannot parse fighters from filename: {path.name}")
    slugs = [part for part in base.split("-vs-") if part]
    if len(slugs) < 2:
        raise SystemExit(f"Cannot parse fighters from filename: {path.name}")
    return slugs, weapon_mode


def powerup_speak_label(entry: dict | None) -> str:
    """Short powerup clause label: 'Speed I' / 'speed-i' → 'Speed'."""
    if not isinstance(entry, dict):
        return ""
    named = entry.get("powerupName")
    if isinstance(named, str) and named.strip():
        return re.sub(r"\s+[IVXLC\d]+$", "", named.strip(), flags=re.I).strip()
    pid = entry.get("powerupId")
    if isinstance(pid, str) and pid.strip():
        base = pid.strip().split("-")[0]
        return base[:1].upper() + base[1:] if base else ""
    return ""


def strip_powerup_clause(label: str) -> str:
    """'Dagger with Speed' → 'Dagger' for winner lines."""
    return re.sub(r"\s+with\s+[A-Za-z][\w'-]*$", "", (label or "").strip(), flags=re.I).strip()


def fighter_speak_name(entry) -> str:
    """Display name plus optional 'with Powerup' for TTS openings only."""
    if isinstance(entry, dict):
        name = re.sub(r"\s+", " ", str(entry.get("name") or "").strip())
        powerup = powerup_speak_label(entry)
    else:
        name = re.sub(r"\s+", " ", str(entry or "").strip())
        powerup = ""
    name = strip_powerup_clause(name)
    if not name:
        return ""
    return f"{name} with {powerup}" if powerup else name


def build_end_script(winner: str) -> str:
    name = strip_powerup_clause(re.sub(r"\s+", " ", (winner or "").strip()))
    if not name:
        return ""
    return END_SCRIPT_TEMPLATE.format(winner=name)


def join_matchup_names(fighters: list, *, include_powerups: bool = False) -> str:
    """Group same-color fighters with 'and'; separate teams with 'vs.'

    Accepts either plain name strings or dicts with ``name`` / ``color``.
    When ``include_powerups`` is true, dict entries may append ``with Speed``.
    """
    groups: list[list[str]] = []
    index_by_color: dict[str, int] = {}
    for i, entry in enumerate(fighters or []):
        if isinstance(entry, dict):
            name = fighter_speak_name(entry) if include_powerups else re.sub(
                r"\s+", " ", str(entry.get("name") or "").strip()
            )
            color = str(entry.get("color") or "").strip().lower()
        else:
            name = re.sub(r"\s+", " ", str(entry or "").strip())
            color = ""
        if not name:
            continue
        key = color or f"__solo_{i}"
        gi = index_by_color.get(key)
        if gi is None:
            gi = len(groups)
            index_by_color[key] = gi
            groups.append([])
        groups[gi].append(name)
    if not groups:
        return ""
    return " vs. ".join(" and ".join(g) for g in groups)


def _join_vs(names: list[str]) -> str:
    return join_matchup_names(names)


def load_matchup_fighters(video: Path) -> list[dict] | None:
    """Fighters with colors from recording sidecar, if present."""
    meta_path = video.with_suffix(".json")
    if not meta_path.is_file():
        return None
    try:
        data = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    fighters = data.get("fighters")
    if not isinstance(fighters, list) or len(fighters) < 2:
        return None
    out = []
    for row in fighters:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        entry = {
            "name": name.strip(),
            "color": row.get("color") if isinstance(row.get("color"), str) else "",
        }
        pid = row.get("powerupId")
        if isinstance(pid, str) and pid.strip():
            entry["powerupId"] = pid.strip()
        pname = row.get("powerupName")
        if isinstance(pname, str) and pname.strip():
            entry["powerupName"] = pname.strip()
        out.append(entry)
    return out if len(out) >= 2 else None


def build_script(video: Path, health: int = 100) -> str:
    slugs, weapon_mode = parse_fighter_ids(video)
    sidecar = load_matchup_fighters(video)

    if weapon_mode:
        skins = load_skins()
        weapons = load_weapons()
        if sidecar:
            names_joined = join_matchup_names(sidecar, include_powerups=True)
        else:
            names = [resolve_weapon_fighter(slug, skins, weapons)["name"] for slug in slugs]
            names_joined = join_matchup_names(names)
        script = WEAPON_SCRIPT_TEMPLATE.format(names=names_joined)
    else:
        fighters = load_fighters()
        resolved = [
            fighters.get(slug, {"name": slug.replace("-", " ").title(), "bio": ""})
            for slug in slugs
        ]
        if sidecar:
            names_joined = join_matchup_names(sidecar, include_powerups=True)
        else:
            names_joined = join_matchup_names([f["name"] for f in resolved])
        bios = " ".join(f["bio"] for f in resolved if f.get("bio"))
        script = SCRIPT_TEMPLATE.format(names=names_joined, bios=bios).strip()
    return re.sub(r"\s+", " ", script).strip()


def load_winner(video: Path, override: str | None = None) -> str | None:
    if override and override.strip():
        return override.strip()
    meta_path = video.with_suffix(".json")
    if not meta_path.is_file():
        return None
    try:
        data = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    name = data.get("winner")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return None


def load_intro_delay(video: Path) -> float:
    """Seconds to skip before opening voiceover (VS splash at start of recording)."""
    meta_path = video.with_suffix(".json")
    if not meta_path.is_file():
        return 0.0
    try:
        data = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return 0.0
    if not data.get("hasIntro"):
        return 0.0
    frames = data.get("introFrames")
    if isinstance(frames, (int, float)) and frames > 0:
        return float(frames) / INTRO_FPS
    return DEFAULT_INTRO_SEC


def media_duration(path: Path) -> float:
    """Return media length in seconds.

    Chrome MediaRecorder WebMs often omit container/stream duration — fall back
    to the last video packet pts when format.duration is missing.
    """
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(path),
        ],
        text=True,
    )
    data = json.loads(out)
    for candidate in (
        data.get("format", {}).get("duration"),
        *(s.get("duration") for s in data.get("streams", [])),
    ):
        if candidate is not None and candidate != "N/A":
            return float(candidate)

    pkt = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "packet=pts_time",
            "-of", "csv=p=0",
            str(path),
        ],
        text=True,
        stderr=subprocess.DEVNULL,
    )
    last = None
    for line in pkt.splitlines():
        line = line.strip()
        if line and line != "N/A":
            last = line
    if last is None:
        raise RuntimeError(f"Could not determine duration of {path}")
    return float(last)


def shift_words(words: list[dict], offset: float) -> list[dict]:
    return [
        {
            "text": w["text"],
            "start": w["start"] + offset,
            "end": w["end"] + offset,
        }
        for w in words
    ]


# ---------- TTS with word timings ----------

def _word_key(word: str) -> str:
    return re.sub(r"[^A-Za-z]", "", word).lower()


def build_speak_script(display: str) -> tuple[str, list[tuple[str, int]]]:
    """Build TTS text from display text via SPEAK_AS.

    Returns (speak_text, align) where align is [(display_word, n_speak_words), ...].
    """
    lookup = {_word_key(k): v for k, v in SPEAK_AS.items()}
    speak_parts: list[str] = []
    align: list[tuple[str, int]] = []
    for word in display.split():
        spoken = lookup.get(_word_key(word))
        if spoken:
            bits = spoken.split()
            speak_parts.extend(bits)
            align.append((word, len(bits)))
        else:
            speak_parts.append(word)
            align.append((word, 1))
    return " ".join(speak_parts), align


def attach_display_words(
    tts_words: list[dict],
    align: list[tuple[str, int]],
) -> list[dict]:
    """Map TTS word timings onto display spellings using SPEAK_AS groups."""
    out: list[dict] = []
    i = 0
    for display_word, n in align:
        if i >= len(tts_words):
            break
        take = min(n, len(tts_words) - i)
        chunk = tts_words[i : i + take]
        out.append({
            "text": display_word,
            "start": chunk[0]["start"],
            "end": chunk[-1]["end"],
        })
        i += take
    return out


def remap_caption_words(display: str, tts_words: list[dict]) -> list[dict]:
    """Prefer SPEAK_AS group alignment; fall back to 1:1 or proportional."""
    _, align = build_speak_script(display)
    expected = sum(n for _, n in align)
    if expected == len(tts_words):
        return attach_display_words(tts_words, align)

    display_words = display.split()
    if len(display_words) == len(tts_words):
        return [
            {"text": dw, "start": tw["start"], "end": tw["end"]}
            for dw, tw in zip(display_words, tts_words)
        ]

    if not tts_words or not display_words:
        return [
            {"text": w, "start": 0.0, "end": 0.05}
            for w in display_words
        ]

    t0 = tts_words[0]["start"]
    t1 = tts_words[-1]["end"]
    span = max(t1 - t0, 0.05)
    n = len(display_words)
    out: list[dict] = []
    for i, word in enumerate(display_words):
        start = t0 + span * (i / n)
        end = t0 + span * ((i + 1) / n)
        out.append({"text": word, "start": start, "end": end})
    return out


async def synthesize(text: str, audio_path: Path) -> list[dict]:
    """Generate VO audio and return [{text, start, end}, ...] in seconds.

    `text` is the display script. SPEAK_AS only affects what is spoken; captions
    keep the display spelling.
    """
    import edge_tts

    speak_text, _align = build_speak_script(text)
    words: list[dict] = []
    communicate = edge_tts.Communicate(speak_text, VOICE, rate=RATE, boundary="WordBoundary")
    with open(audio_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({
                    "text": chunk["text"],
                    "start": start,
                    "end": start + chunk["duration"] / 1e7,
                })
    if not words:
        raise SystemExit("TTS produced no word timings.")
    return remap_caption_words(text, words)


# ---------- ASS karaoke captions ----------

def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def group_lines(words: list[dict]) -> list[list[dict]]:
    """Chunk words into caption lines; break early on big pauses."""
    lines: list[list[dict]] = []
    current: list[dict] = []
    for word in words:
        if current:
            gap = word["start"] - current[-1]["end"]
            if len(current) >= WORDS_PER_LINE or gap > 0.45:
                lines.append(current)
                current = []
        current.append(word)
    if current:
        lines.append(current)
    return lines


def build_ass(words: list[dict]) -> str:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1440
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{FONT_NAME},{FONT_SIZE},{ACTIVE_COLOR},{UPCOMING_COLOR},{OUTLINE_COLOR},&H80000000,-1,0,0,0,100,100,0,0,1,7,2,{ALIGNMENT},40,40,{MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    for line in group_lines(words):
        start = line[0]["start"]
        end = line[-1]["end"] + 0.12
        parts: list[str] = []
        for i, word in enumerate(line):
            if i + 1 < len(line):
                dur = line[i + 1]["start"] - word["start"]
            else:
                dur = word["end"] - word["start"]
            k = max(1, round(dur * 100))
            text = word["text"].upper() if CAPTION_UPPERCASE else word["text"]
            parts.append(f"{{\\k{k}}}{text}")
        dialogue = "{\\fad(60,60)}" + " ".join(parts)
        events.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{dialogue}"
        )
    return header + "\n".join(events) + "\n"


# ---------- ffmpeg composition ----------

def has_audio_stream(video: Path) -> bool:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", "-select_streams", "a", str(video),
        ],
        text=True,
    )
    return bool(json.loads(out).get("streams"))


def compose(
    video: Path,
    vo_path: Path,
    ass_path: Path | None,
    out_path: Path,
    end_vo_path: Path | None = None,
    end_start: float = 0.0,
    vo_start: float = 0.0,
    show_captions: bool = False,
) -> None:
    vo_delay_ms = max(0, int(round(vo_start * 1000)))
    end_delay_ms = max(0, int(round(end_start * 1000)))
    has_end = bool(end_vo_path and end_vo_path.is_file())
    aformat = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"

    def delay_input(label: str, delay_ms: int) -> str:
        chain = f"[{label}:a]{aformat}"
        if delay_ms > 0:
            chain += f",adelay={delay_ms}|{delay_ms}"
        return chain

    if has_audio_stream(video):
        vo_chain = delay_input("1", vo_delay_ms) + "[vo]"
        if has_end:
            outro_chain = delay_input("2", end_delay_ms) + "[outro]"
            audio_filter = (
                f"{vo_chain};{outro_chain};"
                f"[0:a][vo][outro]amix=inputs=3:duration=first:normalize=0:"
                f"weights={FIGHT_AUDIO_WEIGHT} {VOICE_AUDIO_WEIGHT} {VOICE_AUDIO_WEIGHT}[a]"
            )
        else:
            audio_filter = (
                f"{vo_chain};"
                f"[0:a][vo]amix=inputs=2:duration=first:normalize=0:"
                f"weights={FIGHT_AUDIO_WEIGHT} {VOICE_AUDIO_WEIGHT}[a]"
            )
        extra: list[str] = []
    else:
        vo_chain = delay_input("1", vo_delay_ms)
        if has_end:
            outro_chain = delay_input("2", end_delay_ms) + ",apad[outro]"
            audio_filter = (
                f"{vo_chain},apad[vo];{outro_chain};"
                f"[vo][outro]amix=inputs=2:duration=longest:normalize=0[a]"
            )
        else:
            audio_filter = f"{vo_chain},apad[a]"
        extra = ["-shortest"]

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-i", str(vo_path),
    ]
    if has_end:
        cmd += ["-i", str(end_vo_path)]

    if show_captions and ass_path:
        cmd += [
            "-filter_complex", f"[0:v]ass={ass_path}[v];{audio_filter}",
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "21",
            "-pix_fmt", "yuv420p",
        ]
    else:
        cmd += [
            "-filter_complex", audio_filter,
            "-map", "0:v", "-map", "[a]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "21",
            "-pix_fmt", "yuv420p",
        ]

    cmd += [
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        *extra,
        str(out_path),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---------- entry point ----------

def resolve_video(arg: str | None) -> Path:
    if arg:
        path = Path(arg).expanduser()
        if not path.is_absolute():
            for base in (Path(arg), RECORDINGS_DIR / "raw" / arg, RECORDINGS_DIR / arg):
                if base.is_file():
                    path = base.resolve()
                    break
            else:
                path = (RECORDINGS_DIR / path).resolve()
        else:
            path = path.resolve()
    else:
        search_dirs = [RECORDINGS_DIR / "raw", RECORDINGS_DIR]
        webms: list[Path] = []
        for folder in search_dirs:
            if folder.is_dir():
                webms.extend(folder.glob("*.webm"))
        if not webms:
            raise SystemExit(f"No .webm files in {RECORDINGS_DIR}/raw/")
        webms.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        path = webms[0]
    if not path.is_file():
        raise SystemExit(f"Video not found: {path}")
    return path


def main() -> None:
    import argparse

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("ffmpeg not found. Install: brew install ffmpeg")

    parser = argparse.ArgumentParser(description="Voiceover + karaoke captions overlay")
    parser.add_argument("video", nargs="?", help="Input .webm (default: newest in recordings/)")
    parser.add_argument("--script", help="Override spoken script text")
    parser.add_argument("--winner", help="Override winner name for end TTS ('{name} wins')")
    parser.add_argument("--output-dir", type=Path, help="Directory for output .mp4")
    args = parser.parse_args()

    video = resolve_video(args.video)
    script = args.script.strip() if args.script else build_script(video)
    winner = load_winner(video, args.winner)
    end_script = build_end_script(winner) if winner else ""
    print(f"Video:  {video.name}", file=sys.stderr)
    print(f"Script: {script}", file=sys.stderr)
    if end_script:
        print(f"Outro:  {end_script}", file=sys.stderr)
    else:
        print("Outro:  (none — no winner metadata)", file=sys.stderr)

    vo_path = video.with_suffix(".vo.mp3")
    end_vo_path = video.with_suffix(".end.vo.mp3")
    ass_path = video.with_suffix(".captions.ass") if SHOW_CAPTIONS else None
    out_name = f"{video.stem}-final.mp4"
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        out_path = args.output_dir / out_name
    else:
        out_path = video.with_name(out_name)

    intro_delay = load_intro_delay(video)
    if intro_delay > 0:
        print(f"Intro delay: {intro_delay:.1f}s (voiceover starts after VS splash)", file=sys.stderr)

    print("Generating voiceover…", file=sys.stderr)
    speak_preview, _ = build_speak_script(script)
    if speak_preview != script:
        print(f"Speak:  {speak_preview}", file=sys.stderr)
    words = asyncio.run(synthesize(script, vo_path))
    print(f"Voiceover: {words[-1]['end']:.1f}s, {len(words)} words", file=sys.stderr)

    end_start = 0.0
    has_end = False
    end_words: list[dict] = []
    if end_script:
        print("Generating end voiceover…", file=sys.stderr)
        end_speak, _ = build_speak_script(end_script)
        if end_speak != end_script:
            print(f"End speak: {end_speak}", file=sys.stderr)
        end_words = asyncio.run(synthesize(end_script, end_vo_path))
        end_len = end_words[-1]["end"] if end_words else 0.0
        duration = media_duration(video)
        end_start = max(0.0, duration - end_len - END_VO_TAIL_PAD)
        if SHOW_CAPTIONS:
            all_words.extend(shift_words(end_words, end_start))
        has_end = True
        print(
            f"End VO: {end_len:.1f}s at t={end_start:.1f}s ({len(end_words)} words)",
            file=sys.stderr,
        )

    if SHOW_CAPTIONS and ass_path:
        caption_words = shift_words(words, intro_delay) if intro_delay > 0 else list(words)
        if has_end:
            caption_words.extend(shift_words(end_words, end_start))
        ass_path.write_text(build_ass(caption_words))

    print("Compositing with ffmpeg…", file=sys.stderr)
    compose(
        video,
        vo_path,
        ass_path,
        out_path,
        end_vo_path=end_vo_path if has_end else None,
        end_start=end_start,
        vo_start=intro_delay,
        show_captions=SHOW_CAPTIONS,
    )

    if not KEEP_INTERMEDIATES:
        vo_path.unlink(missing_ok=True)
        end_vo_path.unlink(missing_ok=True)
        if ass_path and ass_path.is_file():
            ass_path.unlink(missing_ok=True)

    print(f"Done: {out_path.name}", file=sys.stderr)
    # Last stdout line = output path (consumed by post_short.py)
    print(out_path)


if __name__ == "__main__":
    main()
