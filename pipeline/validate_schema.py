#!/usr/bin/env python3
"""Lightweight required-field checks for tournament cell JSON (no jsonschema dep)."""

from __future__ import annotations


def require_bracket_state(state: object, label: str = "BracketState") -> dict:
    if not isinstance(state, dict):
        raise ValueError(f"{label}: object required")
    rounds = state.get("rounds")
    fighters = state.get("fighters")
    if not isinstance(rounds, list) or not rounds:
        raise ValueError(f"{label}.rounds required")
    if not isinstance(fighters, list) or len(fighters) < 2:
        raise ValueError(f"{label}.fighters required (≥2)")
    return state


def require_match_segment_request(body: dict) -> dict:
    if not isinstance(body, dict):
        raise ValueError("MatchSegmentRequest required")
    if not str(body.get("matchKey") or "").strip():
        raise ValueError("MatchSegmentRequest.matchKey required")
    if not str(body.get("script") or "").strip():
        raise ValueError("MatchSegmentRequest.script required")
    matchup = body.get("matchup")
    if not isinstance(matchup, list) or len(matchup) != 2:
        raise ValueError("MatchSegmentRequest.matchup must be exactly two fighters")
    if not body.get("syntheticArena"):
        require_bracket_state(body.get("bracketPre"), "MatchSegmentRequest.bracketPre")
        require_bracket_state(body.get("bracketPost"), "MatchSegmentRequest.bracketPost")
    return body
