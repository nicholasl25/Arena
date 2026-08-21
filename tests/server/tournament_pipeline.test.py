#!/usr/bin/env python3
"""Fast mocked endpoint tests for long tournament composition."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ARENA_DIR = Path(__file__).resolve().parents[2]
SERVER_DIR = ARENA_DIR / "server"
sys.path.insert(0, str(SERVER_DIR))

import workflow_server as server  # noqa: E402


class TournamentEndpointTests(unittest.TestCase):
    def test_ensure_segment_requires_exactly_one_pair(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly two"):
            server.tournament_ensure_segment({
                "matchKey": "r0m0|a|b",
                "script": "A versus B",
                "matchup": [{"id": "a"}],
            })

    def test_ensure_segment_forwards_stable_identity_and_order(self) -> None:
        recorder = SimpleNamespace(
            ensure_match_segment_media=Mock(return_value={
                "created": True,
                "segment": {"file": "match-r0m0_a_b.mp4", "status": "done"},
            })
        )
        with (
            patch.object(server, "load_tournament_record", return_value=recorder),
            patch.object(server, "pipeline_status", return_value={"tournament": {}}),
        ):
            result = server.tournament_ensure_segment({
                "matchKey": "r0m0|a|b",
                "script": "A versus B. A wins.",
                "order": 0,
                "mode": "weapon",
                "matchup": [{"id": "a"}, {"id": "b"}],
                "aName": "A",
                "bName": "B",
                "winnerName": "A",
                "syntheticArena": False,
                "bracketPre": {
                    "rounds": [[{"id": "r0m0"}]],
                    "fighters": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
                    "complete": False,
                },
                "bracketPost": {
                    "rounds": [[{"id": "r0m0"}]],
                    "fighters": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
                    "complete": True,
                    "champion": {"name": "A"},
                },
                "activeMatch": {"id": "r0m0"},
                "lastWinner": {"name": "A"},
                "lastLoser": {"name": "B"},
                "powerupSpins": {
                    "a": {"resultId": "speed-i", "slices": [{"id": "speed-i"}]},
                    "b": {"resultId": "", "slices": [{"id": ""}]},
                },
            })

        call = recorder.ensure_match_segment_media.call_args.kwargs
        self.assertEqual(call["match_key"], "r0m0|a|b")
        self.assertEqual(call["order_index"], 0)
        self.assertEqual(len(call["matchup"]), 2)
        self.assertFalse(call["synthetic_arena"])
        self.assertEqual(call["bracket_pre"]["rounds"], [[{"id": "r0m0"}]])
        self.assertEqual(call["bracket_post"]["champion"]["name"], "A")
        self.assertEqual(call["powerup_spins"]["a"]["resultId"], "speed-i")
        self.assertEqual(result["composed"], "match-r0m0_a_b.mp4")

    def test_stitch_endpoint_passes_expected_count_and_champion_hold(self) -> None:
        intro = Path("/tmp/intro.mp4")
        outro = Path("/tmp/outro.mp4")
        composer = SimpleNamespace(
            stitch_final=Mock(return_value={
                "created": True,
                "final": "tournament-final.mp4",
            }),
            ensure_intro_clip=Mock(return_value=intro),
            ensure_outro_clip=Mock(return_value=outro),
            fighter_names_from_bracket=Mock(return_value=[]),
            is_skin_tournament=Mock(return_value=False),
            build_intro_title=Mock(return_value="2 Weapon Arena Tournament"),
        )
        with (
            patch.object(server, "load_compose_tournament", return_value=composer),
            patch.object(server, "pipeline_status", return_value={
                "tournament": {"finalReady": True},
            }),
        ):
            result = server.tournament_stitch({
                "expectedCount": 7,
                "championName": "Winner",
                "matchKeys": ["r0m0", "r0m1"],
            })

        composer.ensure_intro_clip.assert_called_once()
        composer.ensure_outro_clip.assert_called_once_with(
            "Winner",
            title="2 Weapon Arena Tournament",
            fighters=None,
            weapon_mode=True,
            base_url=f"http://127.0.0.1:{server.PORT}",
        )
        composer.stitch_final.assert_called_once_with(
            intro_clip=intro,
            champion_clip=outro,
            champion_name="Winner",
            force=False,
            expected_count=7,
            match_keys=["r0m0", "r0m1"],
        )
        self.assertEqual(result["final"], "tournament-final.mp4")
        self.assertTrue(result["pipeline"]["tournament"]["finalReady"])

    def test_preview_endpoint_stitches_partial_video(self) -> None:
        composer = SimpleNamespace(
            stitch_preview=Mock(return_value={
                "created": True,
                "preview": "preview.mp4",
                "url": "/recordings/composed/tournament/preview.mp4",
                "segmentCount": 2,
                "final": False,
            })
        )
        with (
            patch.object(server, "load_compose_tournament", return_value=composer),
            patch.object(server, "pipeline_status", return_value={
                "tournament": {"previewReady": True, "doneSegmentCount": 2},
            }),
        ):
            result = server.tournament_preview({})

        composer.stitch_preview.assert_called_once_with(force=False)
        self.assertEqual(result["preview"], "preview.mp4")
        self.assertEqual(result["segmentCount"], 2)
        self.assertFalse(result["final"])

    def test_long_caption_uses_chapters_not_shorts(self) -> None:
        manifest = {
            "segments": [
                {
                    "status": "done",
                    "duration": 42,
                    "chapterTitle": "Semifinals — Sword vs Dagger",
                    "winnerName": "Sword",
                },
                {
                    "status": "done",
                    "duration": 40,
                    "chapterTitle": "Final — Sword vs Hammer",
                    "winnerName": "Sword",
                },
            ],
            "stitch": {
                "chapters": [
                    {"at": 0, "title": "Semifinals — Sword vs Dagger"},
                    {"at": 42, "title": "Final — Sword vs Hammer"},
                    {"at": 82, "title": "Champion"},
                ],
            },
        }
        self.assertTrue(server.is_tournament_final("tournament-final.mp4"))
        self.assertFalse(server.is_tournament_final("sword-vs-dagger-final.mp4"))
        self.assertEqual(server.build_long_title(manifest), "Sword wins the Ball Arena tournament")
        desc = server.build_long_description(manifest)
        self.assertIn("0:00 Semifinals — Sword vs Dagger", desc)
        self.assertIn("1:22 Champion", desc)
        self.assertNotIn("#Shorts", desc)
        self.assertIn("#tournament", desc)

    def test_long_roster_custom_skins_from_folder(self) -> None:
        weapons = [{"id": "sword", "name": "Sword"}, {"id": "bow", "name": "Bow"}]
        skins = [
            {"id": "thor", "name": "Thor", "file": "Thor.png"},
            {"id": "hulk", "name": "Hulk", "file": "Hulk.png"},
            {"id": "spiderman", "name": "Spiderman", "file": "Spiderman.png"},
        ]
        with (
            patch.object(server, "list_weapon_options", return_value=weapons),
            patch.object(server, "list_skins_in_category", return_value=skins),
        ):
            custom = server.build_long_tournament_roster(
                skin_folder="MCU",
                weapon_ids=["sword", "bow"],
                skin_ids=["spiderman", "thor"],
            )
            self.assertEqual([row["id"] for row in custom], ["spiderman", "thor"])
            whole = server.build_long_tournament_roster(
                skin_folder="MCU",
                weapon_ids=["sword", "bow"],
            )
            self.assertEqual([row["id"] for row in whole], ["thor", "hulk", "spiderman"])
            with self.assertRaisesRegex(ValueError, "at least 2 skins"):
                server.build_long_tournament_roster(
                    skin_folder="MCU",
                    weapon_ids=["sword", "bow"],
                    skin_ids=["thor"],
                )

    def test_long_upload_skips_shorts_validation(self) -> None:
        import workflow_lib.pipeline_ops as ops

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            composed = root / "composed"
            posted = root / "posted"
            composed.mkdir()
            posted.mkdir()
            (composed / "tournament-final.mp4").write_bytes(b"fake-video")
            stages = {"composed": composed, "posted": posted, "raw": root / "raw"}

            def fake_run(cmd, *args, **kwargs):
                tags = cmd[cmd.index("--tags") + 1]
                self.assertNotIn("shorts", tags.lower())
                self.assertIn("tournament", tags)
                return SimpleNamespace(
                    returncode=0,
                    stdout=json.dumps({
                        "videoId": "abc123",
                        "watchUrl": "https://youtu.be/abc123",
                    }),
                    stderr="",
                )

            with (
                patch.object(ops, "STAGES", stages),
                patch.object(ops, "validate_video") as validate,
                patch.object(ops, "convert_video") as convert,
                patch.object(ops, "extract_intro_thumbnail", return_value=None),
                patch.object(ops, "tiktok_configured", return_value=False),
                patch.object(ops, "record_quota_upload"),
                patch.object(ops.subprocess, "run", side_effect=fake_run),
            ):
                result = ops.upload_video("tournament-final.mp4", "Champ wins", "desc")

            validate.assert_not_called()
            convert.assert_not_called()
            self.assertEqual(result["videoId"], "abc123")
            self.assertEqual(result["postedFile"], "tournament-final.mp4")
            self.assertFalse((composed / "tournament-final.mp4").exists())
            self.assertTrue((posted / "tournament-final.mp4").exists())

    def test_short_upload_still_validates(self) -> None:
        import workflow_lib.pipeline_ops as ops

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            composed = root / "composed"
            posted = root / "posted"
            composed.mkdir()
            posted.mkdir()
            (composed / "sword-vs-dagger-final.mp4").write_bytes(b"fake-video")
            stages = {"composed": composed, "posted": posted, "raw": root / "raw"}

            def fake_run(cmd, *args, **kwargs):
                return SimpleNamespace(
                    returncode=0,
                    stdout=json.dumps({"videoId": "short1"}),
                    stderr="",
                )

            with (
                patch.object(ops, "STAGES", stages),
                patch.object(ops, "validate_video", return_value={"ok": True}) as validate,
                patch.object(ops, "convert_video") as convert,
                patch.object(ops, "extract_intro_thumbnail", return_value=None),
                patch.object(ops, "tiktok_configured", return_value=False),
                patch.object(ops, "record_quota_upload"),
                patch.object(ops.subprocess, "run", side_effect=fake_run),
            ):
                ops.upload_video("sword-vs-dagger-final.mp4", "Sword vs Dagger", "desc")

            validate.assert_called_once()
            convert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
