#!/usr/bin/env python3
"""Pure helpers for powerup clip identity + matchup merge."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ARENA_DIR / "pipeline"))

import tournament_record as tr  # noqa: E402


class TournamentRecordHelperTests(unittest.TestCase):
    def test_normalized_spins_requires_both_wheels(self) -> None:
        self.assertIsNone(tr._normalized_spins(None))
        self.assertIsNone(tr._normalized_spins({"a": {"resultId": "speed-i"}}))
        self.assertIsNone(tr._normalized_spins({
            "a": {"resultId": "speed-i"},
            "b": {"resultId": ""},
        }))
        spins = {
            "a": {"resultId": "speed-i", "slices": [{"id": "speed-i"}]},
            "b": {"resultId": "", "slices": [{"id": ""}]},
        }
        self.assertEqual(tr._normalized_spins(spins)["a"]["resultId"], "speed-i")

    def test_apply_spins_sets_and_clears_powerup_ids(self) -> None:
        matchup = [
            {"id": "a", "config": {"name": "Hammer"}},
            {"id": "b", "config": {"name": "Dagger", "powerupId": "stale"}},
        ]
        spins = {
            "a": {"resultId": "speed-i", "slices": [{"id": "speed-i"}]},
            "b": {"resultId": "", "slices": [{"id": ""}]},
        }
        out = tr._apply_spins_to_matchup(matchup, spins)
        self.assertEqual(out[0]["config"]["powerupId"], "speed-i")
        self.assertNotIn("powerupId", out[1]["config"])
        self.assertEqual(matchup[0]["config"].get("powerupId"), None)

    def test_sync_bracket_uses_arena_winner_not_demo(self) -> None:
        pre = {
            "size": 2,
            "complete": False,
            "champion": None,
            "fighters": [
                {"id": "a", "name": "Sword", "color": "#ef4444", "slotKey": "slot-0:a"},
                {"id": "b", "name": "Spikes", "color": "#a855f7", "slotKey": "slot-1:b"},
            ],
            "rounds": [[{
                "id": "r0m0",
                "round": 0,
                "index": 0,
                "a": {"id": "a", "name": "Sword", "color": "#ef4444", "slotKey": "slot-0:a"},
                "b": {"id": "b", "name": "Spikes", "color": "#a855f7", "slotKey": "slot-1:b"},
                "winner": None,
                "decided": False,
                "bye": False,
            }]],
        }
        synced = tr._sync_bracket_to_arena_winner(pre, "Spikes")
        self.assertIsNotNone(synced)
        self.assertEqual(synced["winnerName"], "Spikes")
        self.assertEqual(synced["bracketPost"]["rounds"][0][0]["winner"]["name"], "Spikes")

    def test_sanitize_matchup_coerces_unknown_colors(self) -> None:
        out = tr._sanitize_arena_matchup([
            {"id": "_weapon", "config": {"color": "#b45309", "weaponId": "hammer"}},
            {"id": "_weapon", "config": {"color": "#3b82f6", "weaponId": "dagger"}},
        ])
        self.assertEqual(out[0]["config"]["color"], "#ef4444")
        self.assertEqual(out[1]["config"]["color"], "#3b82f6")

    def test_match_in_state_prefers_post_slot(self) -> None:
        match = {"id": "r0m0", "winner": None}
        state = {"rounds": [[{"id": "r0m0", "winner": {"name": "Spikes"}, "decided": True}]]}
        found = tr._match_in_state(state, match)
        self.assertEqual(found["winner"]["name"], "Spikes")
        self.assertIsNone(tr._match_in_state(None, None))

    def test_powerup_parts_stale_when_toggle_changes(self) -> None:
        without = {"parts": [{"kind": "bracket-pre"}, {"kind": "arena"}]}
        with_spin = {"parts": [{"kind": "bracket-pre"}, {"kind": "powerup-spin"}]}
        spins = {
            "a": {"resultId": "x", "slices": [{}]},
            "b": {"resultId": "", "slices": [{}]},
        }
        self.assertTrue(tr._powerup_parts_stale(without, spins))
        self.assertFalse(tr._powerup_parts_stale(with_spin, spins))
        self.assertTrue(tr._powerup_parts_stale(with_spin, None))
        self.assertFalse(tr._powerup_parts_stale(without, None))


if __name__ == "__main__":
    unittest.main()
