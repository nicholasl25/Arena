"""ASS karaoke captions for intro/outro bookends."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from . import config
from .media import media_duration, require_ffmpeg


def ass_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    hours = int(seconds // 3600)
    minutes = int(seconds % 3600 // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def ass_escape(text: str) -> str:
    return (
        str(text or "")
        .replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
    )


def group_caption_lines(words: list[dict], *, per_line: int = 5) -> list[list[dict]]:
    lines: list[list[dict]] = []
    current: list[dict] = []
    for word in words:
        if current:
            gap = float(word["start"]) - float(current[-1]["end"])
            if len(current) >= per_line or gap > 0.45:
                lines.append(current)
                current = []
        current.append(word)
    if current:
        lines.append(current)
    return lines


def build_bookend_ass(
    words: list[dict],
    *,
    align: int = 5,
    font_size: int = 56,
    margin_v: int = 42,
    primary_color: str = config.INTRO_CAPTION_PRIMARY,
    secondary_color: str = config.INTRO_CAPTION_SECONDARY,
    outline_color: str = config.INTRO_CAPTION_OUTLINE,
) -> str:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {config.WIDTH}
PlayResY: {config.HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial Black,{font_size},{primary_color},{secondary_color},{outline_color},&H80000000,-1,0,0,0,100,100,0,0,1,6,2,{align},48,48,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    for line in group_caption_lines(words):
        start = float(line[0]["start"])
        end = float(line[-1]["end"]) + 0.12
        parts: list[str] = []
        for i, word in enumerate(line):
            if i + 1 < len(line):
                dur = float(line[i + 1]["start"]) - float(word["start"])
            else:
                dur = float(word["end"]) - float(word["start"])
            k = max(1, round(dur * 100))
            parts.append(f"{{\\k{k}}}{ass_escape(str(word['text']).upper())}")
        events.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,"
            f"{{\\fad(60,60)}}{' '.join(parts)}"
        )
    return header + "\n".join(events) + "\n"


def ass_filter_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def fallback_words(script: str, duration: float) -> list[dict]:
    tokens = [part for part in re.split(r"\s+", (script or "").strip()) if part]
    if not tokens:
        return []
    span = max(0.4, float(duration))
    step = span / len(tokens)
    return [
        {"text": token, "start": i * step, "end": (i + 1) * step}
        for i, token in enumerate(tokens)
    ]


def align_caption_words(display: str, tts_words: list[dict]) -> list[dict]:
    """Keep script punctuation (commas, periods) on karaoke words.

    edge-tts WordBoundary text drops trailing punctuation, so captions would
    otherwise show "THOR HULK AND SPIDERMAN" instead of "THOR, HULK, AND SPIDERMAN".
    """
    display_words = [part for part in re.split(r"\s+", (display or "").strip()) if part]
    if not tts_words or not display_words:
        return list(tts_words or [])
    if len(display_words) == len(tts_words):
        return [
            {"text": dw, "start": float(tw["start"]), "end": float(tw["end"])}
            for dw, tw in zip(display_words, tts_words)
        ]
    return list(tts_words)


def mix_spoken_overlay(
    video: Path,
    *,
    vo_mp3: Path,
    ass_path: Path | None,
    out_path: Path,
    extend_to: float | None = None,
    sfx_wav: Path | None = None,
    sfx_volume: float = config.VICTOR_STING_VOLUME,
    vo_delay: float = 0.0,
    sfx_delay: float = 0.0,
) -> Path:
    """Burn karaoke captions and mix TTS onto a clip. Optionally clone-pad the end."""
    require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    video_dur = max(0.2, media_duration(video))
    need = max(video_dur, float(extend_to) if extend_to else video_dur)
    extra = max(0.0, need - video_dur)
    aformat = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"
    vo_ms = max(0, int(round(float(vo_delay) * 1000)))
    sfx_ms = max(0, int(round(float(sfx_delay) * 1000)))
    vo_af = aformat + (f",adelay={vo_ms}|{vo_ms}" if vo_ms else "")
    probe = subprocess.check_output(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", "-select_streams", "a", str(video),
        ],
        text=True,
    )
    has_audio = bool(json.loads(probe).get("streams"))
    use_sfx = bool(sfx_wav and Path(sfx_wav).is_file())
    vchain = "[0:v]"
    if extra > 0.02:
        vchain += f"tpad=stop_mode=clone:stop_duration={extra:.3f},"
    if ass_path and ass_path.is_file():
        vchain += f"ass={ass_filter_path(ass_path)}"
    else:
        vchain = vchain.rstrip(",")
        if vchain == "[0:v]":
            vchain += "copy"
    vchain += "[v]"

    inputs = ["-i", str(video), "-i", str(vo_mp3)]
    if use_sfx:
        inputs += ["-i", str(sfx_wav)]
        sfx_chain = (
            f"[2:a]{aformat},volume={float(sfx_volume)},"
            f"afade=t=in:st=0:d=0.04,"
            f"afade=t=out:st={max(0.2, config.VICTOR_STING_SEC - 0.35):.3f}:d=0.35"
            + (f",adelay={sfx_ms}|{sfx_ms}" if sfx_ms else "")
            + "[sfx]"
        )
        if has_audio:
            filt = (
                f"{vchain};[0:a]{aformat},apad[bg];[1:a]{vo_af}[vo];{sfx_chain};"
                f"[bg][vo][sfx]amix=inputs=3:duration=first:dropout_transition=0:"
                f"normalize=0:weights=0.45 1.7 1.15[a]"
            )
        else:
            filt = (
                f"{vchain};[1:a]{vo_af}[vo];{sfx_chain};"
                f"[vo][sfx]amix=inputs=2:duration=first:dropout_transition=0:"
                f"normalize=0:weights=1.7 1.15,apad[a]"
            )
    elif has_audio:
        filt = (
            f"{vchain};[0:a]{aformat},apad[bg];[1:a]{vo_af}[vo];"
            f"[bg][vo]amix=inputs=2:duration=first:dropout_transition=0:"
            f"normalize=0:weights=0.55 1.7[a]"
        )
    else:
        filt = f"{vchain};[1:a]{vo_af},apad[a]"
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filt,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-t", f"{need:.3f}",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_path
