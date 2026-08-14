#!/usr/bin/env python3
"""Fast tests for tournament manifests, idempotency, and mocked composition."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

FUN_DIR = Path(__file__).resolve().parents[2]
PIPELINE_DIR = FUN_DIR / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

import compose_tournament as ct  # noqa: E402


def fake_media(path: Path, *_args, **_kwargs) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    return path


def fake_concat(_paths: list[Path], output: Path) -> Path:
    return fake_media(output)


def fake_mix(_video: Path, _voiceover: Path, output: Path) -> Path:
    return fake_media(output)


def fake_mix_segment(
    _video: Path,
    *,
    opening_mp3=None,
    outcome_mp3=None,
    outcome_at: float = 0.0,
    out_path: Path | None = None,
    **_kwargs,
) -> Path:
    return fake_media(out_path)


def skip_coroutine(coroutine) -> None:
    coroutine.close()


class TournamentComposeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory(prefix="tour-test-")
        self._paths = ct.snapshot_paths()
        ct.redirect_root(Path(self._tmpdir.name))
        ct.ensure_dirs()

    def tearDown(self) -> None:
        ct.restore_paths(self._paths)
        self._tmpdir.cleanup()

    def build_segment(self, key: str, order: int) -> dict:
        clips = []
        for kind in ("pre", "arena", "post"):
            clip = ct.CLIPS_DIR / f"{key}-{kind}.mp4"
            clip.touch()
            clips.append(clip)
        with (
            patch.object(ct.media, "concat_videos", side_effect=fake_concat),
            patch.object(ct.segment.asyncio, "run", side_effect=skip_coroutine),
            patch.object(ct.media, "mix_segment_narration", side_effect=fake_mix_segment),
            patch.object(ct.media, "make_title_card_clip", side_effect=fake_media),
            patch.object(ct.media, "mix_music_bed", side_effect=lambda path, **_k: path),
            patch.object(ct.media, "media_duration", return_value=3.0),
        ):
            return ct.build_match_segment(
                match_key=key,
                script=f"Narration for {key}",
                pre_bracket=clips[0],
                arena=clips[1],
                post_bracket=clips[2],
                order_index=order,
                a_name="A",
                b_name="B",
                winner_name="A",
            )

    def test_split_match_narration_keeps_outcome_for_end(self) -> None:
        opening, outcome = ct.split_match_narration(
            "Alpha vs. Beta — who will win?\n\nAlpha wins"
        )
        self.assertEqual(opening, "Alpha vs. Beta — who will win?")
        self.assertEqual(outcome, "Alpha wins")

    def test_parse_match_narration_keeps_spin_announces(self) -> None:
        parsed = ct.parse_match_narration(
            "Sword vs. Hammer\n\nSword gets Protection\n\nDagger gets Power\n\nSword wins"
        )
        self.assertEqual(parsed["opening"], "Sword vs. Hammer")
        self.assertEqual(parsed["announces"], ["Sword gets Protection", "Dagger gets Power"])
        self.assertEqual(parsed["outcome"], "Sword wins")

    def test_announce_at_secs_uses_reveal_start(self) -> None:
        times = ct.announce_at_secs(1.2, {
            "a": {"delayMs": 0, "durationMs": 8200},
            "b": {"delayMs": 10680, "durationMs": 8200},
        }, 2)
        self.assertAlmostEqual(times[0], 9.4, places=5)
        self.assertAlmostEqual(times[1], 20.08, places=5)

    def test_replace_outcome_winner_keeps_spin_lines(self) -> None:
        script = ct.replace_outcome_winner(
            "Sword vs. Hammer\n\nSword gets Protection\n\nHammer gets nothing",
            "Hammer with Power",
        )
        self.assertIn("Sword gets Protection", script)
        self.assertTrue(script.endswith("Hammer wins"))

    def test_split_match_narration_strips_powerup_from_winner_line(self) -> None:
        opening, outcome = ct.split_match_narration(
            "Hammer with Speed vs. Hammer with Power — who will win?\n\nHammer with Speed wins"
        )
        self.assertIn("with Speed vs.", opening)
        self.assertEqual(outcome, "Hammer wins")

    def test_segment_manifest_models_three_parts_and_one_overlay(self) -> None:
        result = self.build_segment("r0m0|a|b", 0)
        segment = result["segment"]
        self.assertEqual(
            [part["kind"] for part in segment["parts"]],
            ["title-card", "bracket-pre", "arena", "bracket-post"],
        )
        self.assertEqual(segment["narration"]["scope"], "combined-segment")
        self.assertEqual(segment["narration"]["mix"], "overlay")
        self.assertFalse(segment["narration"]["loop"])

    def test_segment_includes_powerup_spin_part(self) -> None:
        clips = []
        for kind in ("pre", "powerup", "arena", "post"):
            clip = ct.CLIPS_DIR / f"r0m0-{kind}.mp4"
            clip.touch()
            clips.append(clip)
        captured: list[str] = []

        def capture_concat(paths: list[Path], output: Path) -> Path:
            captured.extend(path.name for path in paths)
            return fake_media(output)

        with (
            patch.object(ct.media, "concat_videos", side_effect=capture_concat),
            patch.object(ct.segment.asyncio, "run", side_effect=skip_coroutine),
            patch.object(ct.media, "mix_segment_narration", side_effect=fake_mix_segment),
            patch.object(ct.media, "make_title_card_clip", side_effect=fake_media),
            patch.object(ct.media, "mix_music_bed", side_effect=lambda path, **_k: path),
            patch.object(ct.media, "media_duration", return_value=3.0),
        ):
            result = ct.build_match_segment(
                match_key="r0m0|a|b",
                script="A vs. B\n\nA wins",
                pre_bracket=clips[0],
                arena=clips[2],
                post_bracket=clips[3],
                order_index=0,
                a_name="A",
                b_name="B",
                winner_name="A",
                powerup_clip=clips[1],
            )
        segment = result["segment"]
        self.assertEqual(
            [part["kind"] for part in segment["parts"]],
            ["title-card", "bracket-pre", "powerup-spin", "arena", "bracket-post"],
        )
        self.assertEqual(captured[0].endswith("-title.mp4"), True)
        self.assertEqual(
            captured[1:],
            [clips[0].name, clips[1].name, clips[2].name, clips[3].name],
        )
        self.assertEqual(segment["narration"]["outcomeAtSec"], 10.0)

    def test_segment_identity_is_idempotent(self) -> None:
        first = self.build_segment("r0m0|a|b", 0)
        second = ct.build_match_segment(
            match_key="r0m0|a|b",
            script="ignored on idempotent retry",
            pre_bracket=Path("missing-pre"),
            arena=Path("missing-arena"),
            post_bracket=Path("missing-post"),
            order_index=99,
        )
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["segment"]["file"], second["segment"]["file"])
        self.assertEqual(second["segment"]["order"], 0)

    def test_stitch_manifest_is_deterministically_ordered(self) -> None:
        self.build_segment("r1m0|winner-a|winner-b", 2)
        self.build_segment("r0m1|c|d", 1)
        self.build_segment("r0m0|a|b", 0)
        self.build_segment("stale|old|match", -1)
        champion = ct.CLIPS_DIR / "champion.mp4"
        champion.touch()
        captured = []

        def fake_concat(paths: list[Path], output: Path) -> Path:
            captured.extend(path.name for path in paths)
            return fake_media(output)

        with (
            patch.object(ct.media, "concat_videos", side_effect=fake_concat),
            patch.object(ct.media, "media_duration", return_value=10.0),
        ):
            result = ct.stitch_final(
                champion_clip=champion,
                expected_count=3,
                match_keys=[
                    "r0m0|a|b",
                    "r0m1|c|d",
                    "r1m0|winner-a|winner-b",
                ],
            )

        self.assertEqual(
            [item["order"] for item in result["manifest"]["stitch"]["segments"]],
            [0, 1, 2],
        )
        self.assertEqual(
            captured,
            [
                ct.segment_path_for("r0m0|a|b").name,
                ct.segment_path_for("r0m1|c|d").name,
                ct.segment_path_for("r1m0|winner-a|winner-b").name,
                "champion.mp4",
            ],
        )
        self.assertTrue(ct.status_payload()["finalReady"])
        chapters = result["manifest"]["stitch"]["chapters"]
        self.assertEqual(chapters[0]["at"], 0)
        self.assertEqual(chapters[0]["title"], "Final — A vs B")
        self.assertEqual(chapters[-1]["title"], "Champion")
        self.assertTrue((ct.TOURNAMENT_DIR / "chapters.txt").is_file())

    def test_round_card_and_chapters(self) -> None:
        bracket = {
            "rounds": [
                [
                    {"id": "r0m0", "round": 0, "index": 0, "bye": False},
                    {"id": "r0m1", "round": 0, "index": 1, "bye": False},
                ],
                [{"id": "r1m0", "round": 1, "index": 0, "bye": False}],
            ]
        }
        semi = ct.round_card(bracket, {"id": "r0m1", "round": 0})
        self.assertEqual(semi["heading"], "SEMIFINALS")
        self.assertEqual(semi["detail"], "2 OF 2")
        final = ct.round_card(bracket, {"id": "r1m0", "round": 1})
        self.assertEqual(final["heading"], "FINAL")
        self.assertEqual(final["detail"], "")
        self.assertEqual(
            ct.chapter_title_for(bracket, {"id": "r0m0", "round": 0}, "Sword", "Dagger"),
            "Semifinals — Sword vs Dagger",
        )
        chapters = ct.build_chapters(
            [
                {"status": "done", "duration": 40, "chapterTitle": "Semifinals — Sword vs Dagger"},
                {"status": "done", "duration": 38, "chapterTitle": "Final — Sword vs Hammer"},
            ],
            champion_duration=2.6,
        )
        self.assertEqual(ct.format_timestamp(chapters[0]["at"]), "0:00")
        self.assertEqual(ct.format_timestamp(chapters[1]["at"]), "0:40")
        self.assertEqual(chapters[-1]["title"], "Champion")
        self.assertIn("0:00 Semifinals — Sword vs Dagger", ct.format_chapters_description(chapters))
        with_intro = ct.build_chapters(
            [{"status": "done", "duration": 40, "chapterTitle": "Final — Sword vs Hammer"}],
            intro_duration=5.0,
            champion_name="Sword",
            champion_duration=2.0,
        )
        self.assertEqual(with_intro[0]["title"], "Intro")
        self.assertEqual(with_intro[1]["at"], 5.0)
        self.assertEqual(with_intro[-1]["title"], "Champion — Sword")

    def test_failed_stitch_persists_error_and_keeps_gate_locked(self) -> None:
        self.build_segment("r0m0|a|b", 0)
        with patch.object(ct.media, "concat_videos", side_effect=RuntimeError("mock ffmpeg failure")):
            with self.assertRaisesRegex(RuntimeError, "mock ffmpeg failure"):
                ct.stitch_final(expected_count=1)
        status = ct.status_payload()
        self.assertFalse(status["finalReady"])
        self.assertEqual(status["manifest"]["status"], "error")
        self.assertIn("mock ffmpeg failure", status["manifest"]["error"])

    def test_preview_stitches_done_segments_without_finalizing(self) -> None:
        self.build_segment("r0m1|c|d", 1)
        self.build_segment("r0m0|a|b", 0)
        captured = []

        def fake_concat(paths: list[Path], output: Path) -> Path:
            captured.extend(path.name for path in paths)
            return fake_media(output)

        with (
            patch.object(ct.media, "concat_videos", side_effect=fake_concat),
            patch.object(ct.media, "media_duration", return_value=8.0),
        ):
            first = ct.stitch_preview()
            second = ct.stitch_preview()

        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertFalse(first["final"])
        self.assertEqual(
            captured,
            [ct.segment_path_for("r0m0|a|b").name, ct.segment_path_for("r0m1|c|d").name],
        )
        self.assertEqual(first["segmentCount"], 2)
        self.assertFalse(ct.status_payload()["finalReady"])
        self.assertTrue(ct.status_payload()["previewReady"])

    def test_intro_and_outro_scripts(self) -> None:
        self.assertEqual(ct.join_spoken_names(["Thor"]), "Thor")
        self.assertEqual(ct.join_spoken_names(["Thor", "Hulk"]), "Thor, and Hulk")
        self.assertEqual(
            ct.join_spoken_names(["Thor", "Hulk", "Spiderman"]),
            "Thor, Hulk, and Spiderman",
        )
        self.assertEqual(
            ct.build_intro_script(["Sword", "Bow"], powerup_spin=True),
            "Welcome to the Ball Arena tournament. Sword, and Bow. Powerups are on. Who takes the crown?",
        )
        self.assertEqual(
            ct.build_intro_script(
                ["Spiderman", "Thor"],
                weapon_spin=True,
                powerup_spin=True,
            ),
            "Welcome to the Ball Arena tournament. Spiderman, and Thor. "
            "Each match they spin for a weapon. Powerups are on. Who takes the crown?",
        )
        big = [f"F{i}" for i in range(16)]
        self.assertEqual(
            ct.build_intro_script(big, powerup_spin=True),
            "Welcome to the Ball Arena tournament. 16 competitors enter the arena. "
            "Powerups are on. Who takes the crown?",
        )
        self.assertNotIn("F0", ct.build_intro_script(big))
        self.assertNotIn("F15", ct.build_intro_script(big))
        self.assertEqual(
            ct.build_intro_title(["Thor", "Hulk"], skin_folder="NBA Teams"),
            "NBA Teams Ball Arena Tournament",
        )
        self.assertEqual(
            ct.build_intro_title(["Sword", "Bow", "Hammer", "Staff"], weapon_mode=True),
            "4 Weapon Arena Tournament",
        )
        self.assertEqual(
            ct.build_intro_title(["Thor", "Hulk"], champion_name="Thor", weapon_mode=True),
            "2 Weapon Arena Tournament",
        )
        self.assertEqual(ct.build_outro_script("Spiderman"), "Spiderman has won the tournament.")
        self.assertEqual(
            ct.pick_champion_fighters(
                [{"name": "Thor", "id": "thor"}, {"name": "Hulk", "id": "hulk"}],
                "Hulk",
            ),
            [{"name": "Hulk", "id": "hulk"}],
        )
        self.assertIn(ct.INTRO_CAPTION_PRIMARY, ct.build_bookend_ass(
            [{"text": "hi", "start": 0.0, "end": 0.4}],
        ))
        self.assertNotIn("&H0000FFFF", ct.build_bookend_ass(
            [{"text": "hi", "start": 0.0, "end": 0.4}],
        ))
        self.assertTrue(ct.is_skin_tournament({
            "fighters": [{"id": "thor", "name": "Thor", "skinId": "thor"}],
        }))
        self.assertFalse(ct.is_skin_tournament({
            "fighters": [{"id": "_weapon", "name": "Sword"}],
        }))
        aligned = ct.align_caption_words(
            "Sword, Bow, and Staff.",
            [
                {"text": "Sword", "start": 0.0, "end": 0.2},
                {"text": "Bow", "start": 0.2, "end": 0.4},
                {"text": "and", "start": 0.4, "end": 0.5},
                {"text": "Staff", "start": 0.5, "end": 0.7},
            ],
        )
        self.assertEqual(
            [w["text"] for w in aligned],
            ["Sword,", "Bow,", "and", "Staff."],
        )

    def test_stitch_prepends_intro_clip(self) -> None:
        self.build_segment("r0m0|a|b", 0)
        intro = ct.CLIPS_DIR / "intro.mp4"
        champion = ct.CLIPS_DIR / "champion.mp4"
        intro.touch()
        champion.touch()
        captured = []

        def fake_concat(paths: list[Path], output: Path) -> Path:
            captured.extend(path.name for path in paths)
            return fake_media(output)

        with (
            patch.object(ct.media, "concat_videos", side_effect=fake_concat),
            patch.object(ct.media, "media_duration", return_value=4.0),
        ):
            result = ct.stitch_final(
                intro_clip=intro,
                champion_clip=champion,
                champion_name="A",
                expected_count=1,
                match_keys=["r0m0|a|b"],
            )
        self.assertEqual(
            captured,
            ["intro.mp4", ct.segment_path_for("r0m0|a|b").name, "champion.mp4"],
        )
        self.assertEqual(result["manifest"]["stitch"]["chapters"][0]["title"], "Intro")
        self.assertEqual(result["manifest"]["stitch"]["chapters"][-1]["title"], "Champion — A")

    def test_final_ready_requires_success_manifest_and_file(self) -> None:
        ct.save_manifest({
            **ct.empty_manifest(),
            "final": ct.FINAL_NAME,
            "status": "complete",
        })
        self.assertFalse(ct.status_payload()["finalReady"])


if __name__ == "__main__":
    unittest.main()
