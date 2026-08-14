#!/usr/bin/env python3
"""TTS label helpers for shorts + tournament openings."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ARENA_DIR / "pipeline"))

import compose_short as cs  # noqa: E402


class ComposeShortLabelTests(unittest.TestCase):
    def test_powerup_speak_label_strips_rank(self) -> None:
        self.assertEqual(cs.powerup_speak_label({"powerupName": "Speed I"}), "Speed")
        self.assertEqual(cs.powerup_speak_label({"powerupId": "speed-i"}), "Speed")
        self.assertEqual(cs.powerup_speak_label({"powerupId": "power-ii"}), "Power")
        self.assertEqual(cs.powerup_speak_label({}), "")
        self.assertEqual(cs.powerup_speak_label(None), "")

    def test_strip_powerup_clause(self) -> None:
        self.assertEqual(cs.strip_powerup_clause("Dagger with Speed"), "Dagger")
        self.assertEqual(cs.strip_powerup_clause("Hammer"), "Hammer")

    def test_fighter_speak_name_adds_clause(self) -> None:
        self.assertEqual(
            cs.fighter_speak_name({"name": "Hammer", "powerupId": "speed-i"}),
            "Hammer with Speed",
        )
        self.assertEqual(cs.fighter_speak_name({"name": "Hammer"}), "Hammer")
        self.assertEqual(cs.fighter_speak_name("Dagger with Speed"), "Dagger")

    def test_build_end_script_is_plain(self) -> None:
        self.assertEqual(cs.build_end_script("Dagger with Speed"), "Dagger wins")
        self.assertEqual(cs.build_end_script("Dagger"), "Dagger wins")

    def test_join_matchup_names_optional_powerups(self) -> None:
        fighters = [
            {"name": "Hammer", "color": "#111111", "powerupId": "speed-i"},
            {"name": "Hammer", "color": "#222222", "powerupId": "power-i"},
        ]
        self.assertEqual(cs.join_matchup_names(fighters), "Hammer vs. Hammer")
        self.assertEqual(
            cs.join_matchup_names(fighters, include_powerups=True),
            "Hammer with Speed vs. Hammer with Power",
        )


if __name__ == "__main__":
    unittest.main()
