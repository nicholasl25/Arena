#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ARENA_DIR / "pipeline"))

import validate_schema as vs  # noqa: E402


class ValidateSchemaTests(unittest.TestCase):
    def test_bracket_state_requires_rounds_and_roster(self) -> None:
        ok = {"rounds": [[{}]], "fighters": [{}, {}]}
        self.assertIs(vs.require_bracket_state(ok), ok)
        with self.assertRaisesRegex(ValueError, "object required"):
            vs.require_bracket_state([])
        with self.assertRaisesRegex(ValueError, "rounds"):
            vs.require_bracket_state({"fighters": [{}, {}]})
        with self.assertRaisesRegex(ValueError, "fighters"):
            vs.require_bracket_state({"rounds": [[{}]], "fighters": [{}]})

    def test_match_segment_request_skips_brackets_when_synthetic(self) -> None:
        body = {
            "matchKey": "r0m0|a|b",
            "script": "A vs. B",
            "matchup": [{"id": "a"}, {"id": "b"}],
            "syntheticArena": True,
        }
        self.assertIs(vs.require_match_segment_request(body), body)
        with self.assertRaisesRegex(ValueError, "bracketPre"):
            vs.require_match_segment_request({
                "matchKey": "k",
                "script": "s",
                "matchup": [{"id": "a"}, {"id": "b"}],
            })


if __name__ == "__main__":
    unittest.main()
