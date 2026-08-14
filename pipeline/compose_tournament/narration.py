"""Match script parsing and spin-announce timing."""
from __future__ import annotations

import re

_WINS_LINE = re.compile(r"\bwins\s*$", re.I)
_WINNER_WITH_POWERUP = re.compile(
    r"\b([\w'.-]+(?:\s+[\w'.-]+)*)\s+with\s+[\w'-]+\s+wins\b",
    re.I,
)


def parse_match_narration(script: str) -> dict:
    """opening / mid-spin announces / delayed winner line."""
    text = (script or "").strip()
    parts = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if not parts:
        return {"opening": "", "announces": [], "outcome": ""}
    opening = parts[0]
    rest = parts[1:]
    outcome = ""
    if rest and _WINS_LINE.search(rest[-1]):
        outcome = _WINNER_WITH_POWERUP.sub(r"\1 wins", rest.pop())
    return {"opening": opening, "announces": rest, "outcome": outcome}


def split_match_narration(script: str) -> tuple[str, str]:
    """Split opening tease from winner reveal. Opening plays early; outcome is delayed."""
    parsed = parse_match_narration(script)
    return parsed["opening"], parsed["outcome"]


def replace_outcome_winner(script: str, winner_name: str) -> str:
    """Keep opening + spin announces; set the delayed winner line from the arena."""
    parsed = parse_match_narration(script)
    plain = re.sub(
        r"\s+with\s+[\w'-]+$",
        "",
        (winner_name or "").strip(),
        flags=re.I,
    ).strip()
    if not plain:
        return script
    parts = [part for part in [parsed["opening"], *parsed["announces"]] if part]
    parts.append(f"{plain} wins")
    return "\n\n".join(parts)


def announce_at_secs(
    pre_dur: float,
    spins: dict | None,
    count: int,
    offset: float = 0.0,
) -> list[float]:
    """Wall-clock times for 'X gets Y' lines: start of each wheel's reveal."""
    times: list[float] = []
    start = float(offset) + float(pre_dur)
    if isinstance(spins, dict):
        for key in ("a", "b"):
            spin = spins.get(key)
            if not isinstance(spin, dict):
                continue
            delay = float(spin.get("delayMs") or 0) / 1000.0
            dur = float(spin.get("durationMs") or 7000) / 1000.0
            times.append(start + delay + dur)
    while len(times) < count:
        times.append((times[-1] + 2.2) if times else start + 8.2)
    return times[:count]
