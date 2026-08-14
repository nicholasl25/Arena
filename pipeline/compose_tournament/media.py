"""ffmpeg helpers: duration, color clips, music bed, title cards, concat."""
from __future__ import annotations

import json
import math
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

import step_log as slog  # noqa: E402

from . import config


def require_ffmpeg() -> str:
    import shutil
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg not found on PATH")
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe not found on PATH")
    return path


# Back-compat alias used by tournament_record
_require_ffmpeg = require_ffmpeg


def media_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            str(path),
        ],
        text=True,
    )
    return float(json.loads(out)["format"]["duration"])


def make_color_clip(
    out_path: Path,
    *,
    duration: float,
    color: str = "0xece8e1",
    label: str = "",
    width: int = config.WIDTH,
    height: int = config.HEIGHT,
    fps: int = config.FPS,
) -> Path:
    """Synthetic 16:9 H.264 clip for fixtures / bracket stand-ins."""
    require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Escape drawtext special chars.
    safe = label.replace("\\", "\\\\").replace(":", "\\:").replace("'", "")
    vf = f"scale={width}:{height},format=yuv420p"
    if safe:
        vf += (
            f",drawtext=text='{safe}':fontsize=42:fontcolor=black:"
            f"x=(w-text_w)/2:y=(h-text_h)/2"
        )
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s={width}x{height}:d={max(0.2, float(duration))}:r={fps}",
        "-f",
        "lavfi",
        "-i",
        f"anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_path


def music_bed_path() -> Path:
    config.ensure_dirs()
    return config.TOURNAMENT_DIR / config.MUSIC_BED_NAME


def ensure_music_bed(*, duration: float = config.MUSIC_BED_SEC) -> Path:
    """Soft stereo pad cached next to tournament clips. No extra assets."""
    path = music_bed_path()
    if path.is_file() and path.stat().st_size > 1000:
        return path
    sample_rate = 44100
    n = max(sample_rate, int(round(float(duration) * sample_rate)))
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        frames = bytearray()
        for i in range(n):
            t = i / sample_rate
            trem = 0.84 + 0.16 * math.sin(2 * math.pi * 0.11 * t)
            left = (
                0.24 * math.sin(2 * math.pi * 110.0 * t)
                + 0.15 * math.sin(2 * math.pi * 164.81 * t)
                + 0.08 * math.sin(2 * math.pi * 220.0 * t)
            ) * trem * 0.28
            right = (
                0.22 * math.sin(2 * math.pi * 110.4 * t)
                + 0.16 * math.sin(2 * math.pi * 164.4 * t)
                + 0.07 * math.sin(2 * math.pi * 329.63 * t)
            ) * trem * 0.28
            frames += struct.pack(
                "<hh",
                int(max(-1.0, min(1.0, left)) * 32767),
                int(max(-1.0, min(1.0, right)) * 32767),
            )
        handle.writeframes(frames)
    return path


def victor_sting_path() -> Path:
    config.ensure_dirs()
    return config.TOURNAMENT_DIR / config.VICTOR_STING_NAME


def ensure_victor_sting(*, duration: float = config.VICTOR_STING_SEC) -> Path:
    """Short triumphant fanfare for the champion outro. Cached next to tournament clips."""
    path = victor_sting_path()
    if path.is_file() and path.stat().st_size > 1000:
        return path
    sample_rate = 44100
    n = max(sample_rate // 2, int(round(float(duration) * sample_rate)))
    # Rising C-major fanfare: C4 → E4 → G4 → C5 with a short chord sustain.
    notes = [
        (261.63, 0.00, 0.28),
        (329.63, 0.18, 0.30),
        (392.00, 0.36, 0.34),
        (523.25, 0.55, 0.55),
        (659.25, 0.70, 0.70),
    ]
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        frames = bytearray()
        for i in range(n):
            t = i / sample_rate
            sample = 0.0
            for freq, start, length in notes:
                local = t - start
                if local < 0 or local > length:
                    continue
                # Fast attack, longer decay so it reads as a bite, not a beep.
                env = min(1.0, local / 0.02) * math.exp(-2.4 * local / max(0.08, length))
                sample += env * (
                    0.55 * math.sin(2 * math.pi * freq * t)
                    + 0.22 * math.sin(2 * math.pi * freq * 2 * t)
                    + 0.08 * math.sin(2 * math.pi * freq * 3 * t)
                )
            # Soft noise shimmer on the last hit.
            if 0.55 <= t <= 1.35:
                shimmer = 0.04 * math.sin(2 * math.pi * 12 * t) * math.exp(-(t - 0.55) * 2.2)
                sample += shimmer * math.sin(2 * math.pi * 784 * t)
            sample *= 0.42
            left = sample
            right = sample * 0.96
            frames += struct.pack(
                "<hh",
                int(max(-1.0, min(1.0, left)) * 32767),
                int(max(-1.0, min(1.0, right)) * 32767),
            )
        handle.writeframes(frames)
    return path


def mix_music_bed(video: Path, *, volume: float = config.MUSIC_BED_VOLUME) -> Path:
    """Quiet looping pad under an interstitial clip. Arena fights stay untouched."""
    require_ffmpeg()
    if not video.is_file():
        raise FileNotFoundError(f"missing clip for music bed: {video}")
    bed = ensure_music_bed()
    dur = max(0.4, media_duration(video))
    fade_out = min(0.35, dur / 3)
    fade_at = max(0.0, dur - fade_out)
    probe = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-select_streams",
            "a",
            str(video),
        ],
        text=True,
    )
    has_audio = bool(json.loads(probe).get("streams"))
    aformat = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"
    bed_chain = (
        f"[1:a]{aformat},volume={float(volume)},"
        f"afade=t=in:st=0:d=0.22,afade=t=out:st={fade_at:.3f}:d={fade_out:.3f}[bed]"
    )
    if has_audio:
        filt = f"{bed_chain};[0:a]{aformat}[bg];[bg][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
    else:
        filt = f"{bed_chain};[bed]apad[a]"
    tmp = video.with_name(f"{video.stem}.bed{video.suffix}")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-stream_loop",
        "-1",
        "-i",
        str(bed),
        "-filter_complex",
        filt,
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest",
        "-t",
        f"{dur:.3f}",
        "-movflags",
        "+faststart",
        str(tmp),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tmp.replace(video)
    return video


def _title_font() -> str | None:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Black.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        if Path(candidate).is_file():
            return candidate.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return None


def make_title_card_clip(
    out_path: Path,
    *,
    heading: str,
    detail: str = "",
    duration: float = config.TITLE_CARD_SEC,
) -> Path:
    """Paper title card. Prefer OfflineBracket fonts when recording; this is the fallback."""
    require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    safe_head = (heading or "MATCH").replace("\\", "\\\\").replace(":", "\\:").replace("'", "")
    safe_detail = (detail or "").replace("\\", "\\\\").replace(":", "\\:").replace("'", "")
    font = _title_font()
    font_opt = f":fontfile='{font}'" if font else ""
    vf = f"scale={config.WIDTH}:{config.HEIGHT},format=yuv420p"
    vf += (
        f",drawtext=text='{safe_head}':fontsize=72:fontcolor=black:"
        f"x=(w-text_w)/2:y=(h-text_h)/2{'-28' if safe_detail else ''}{font_opt}"
    )
    if safe_detail:
        vf += (
            f",drawtext=text='{safe_detail}':fontsize=28:fontcolor=0x666666:"
            f"x=(w-text_w)/2:y=(h-text_h)/2+42{font_opt}"
        )
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={config.PAGE_BG}:s={config.WIDTH}x{config.HEIGHT}:d={max(0.4, float(duration))}:r={config.FPS}",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_path


def concat_videos(paths: list[Path], out_path: Path) -> Path:
    """Deterministic concat with re-encode for codec compatibility."""
    require_ffmpeg()
    if not paths:
        raise ValueError("no clips to concat")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    slog.log(f"concat: {len(paths)} clips → {out_path.name}")
    with tempfile.TemporaryDirectory(prefix="tour-concat-") as tmp:
        list_path = Path(tmp) / "list.txt"
        # Re-encode each input to identical params first, then concat copy.
        normalized: list[Path] = []
        for i, src in enumerate(paths):
            if not src.is_file():
                raise FileNotFoundError(f"missing clip: {src}")
            slog.log(f"concat: normalize {i + 1}/{len(paths)} {src.name}")
            norm = Path(tmp) / f"n{i:03d}.mp4"
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(src),
                    "-vf",
                    f"scale={config.WIDTH}:{config.HEIGHT}:force_original_aspect_ratio=decrease,"
                    f"pad={config.WIDTH}:{config.HEIGHT}:(ow-iw)/2:(oh-ih)/2:color={config.PAGE_BG},fps={config.FPS},setsar=1",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "160k",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-movflags",
                    "+faststart",
                    str(norm),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            normalized.append(norm)
        list_path.write_text(
            "".join(f"file '{p.resolve()}'\n" for p in normalized)
        )
        slog.log(f"concat: join → {out_path.name}")
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_path),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(out_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return out_path


def mix_voiceover(video: Path, vo_mp3: Path, out_path: Path) -> Path:
    """Overlay a single narration track from t=0 (legacy / tests)."""
    return mix_segment_narration(
        video,
        opening_mp3=vo_mp3,
        outcome_mp3=None,
        outcome_at=0.0,
        out_path=out_path,
    )


def mix_segment_narration(
    video: Path,
    *,
    opening_mp3: Path,
    outcome_mp3: Path | None,
    outcome_at: float,
    out_path: Path,
    extra_cues: list | None = None,
    opening_at: float = 0.0,
) -> Path:
    """Overlay opening VO immediately; delay spin/winner lines to their cue times."""
    require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fight_w = 0.7
    voice_w = 1.6
    aformat = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"

    cues: list[tuple[Path, float]] = [(Path(opening_mp3), float(opening_at))]
    if extra_cues:
        for item in extra_cues:
            if isinstance(item, dict):
                cues.append((Path(item["mp3"]), float(item.get("at") or 0)))
            else:
                cues.append((Path(item[0]), float(item[1])))
    if outcome_mp3 and Path(outcome_mp3).is_file():
        cues.append((Path(outcome_mp3), float(outcome_at)))
    cues = [(path, at) for path, at in cues if path.is_file()]

    probe = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-select_streams",
            "a",
            str(video),
        ],
        text=True,
    )
    has_audio = bool(json.loads(probe).get("streams"))

    def delayed(index: int, delay_ms: int, out_label: str) -> str:
        chain = f"[{index}:a]{aformat}"
        if delay_ms > 0:
            chain += f",adelay={delay_ms}|{delay_ms}"
        return f"{chain}[{out_label}]"

    inputs = ["-i", str(video)]
    for path, _at in cues:
        inputs += ["-i", str(path)]

    vo_labels = [f"vo{i}" for i in range(len(cues))]
    chains = [
        delayed(i + 1, max(0, int(round(at * 1000))), label)
        for i, ((_path, at), label) in enumerate(zip(cues, vo_labels))
    ]
    mix_labels = "".join(f"[{label}]" for label in vo_labels)
    vo_weights = " ".join([str(voice_w)] * len(cues))
    if has_audio:
        filt = (
            "".join(f"{chain};" for chain in chains)
            + f"[0:a]{aformat}[bg];"
            + f"[bg]{mix_labels}amix=inputs={1 + len(cues)}:duration=first:"
            + f"dropout_transition=0:normalize=0:weights={fight_w} {vo_weights}[a]"
        )
    else:
        filt = (
            "".join(f"{chain};" for chain in chains)
            + f"{mix_labels}amix=inputs={len(cues)}:duration=first:"
            + "dropout_transition=0:normalize=0,apad[a]"
        )

    cmd = [
        "ffmpeg",
        "-y",
        *inputs,
        "-filter_complex",
        filt,
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
    ]
    if not has_audio:
        cmd.append("-shortest")
    cmd.append(str(out_path))
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_path
