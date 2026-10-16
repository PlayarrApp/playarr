import unittest
import sys
from pathlib import Path
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import json
from screen_selection import (parse_tv_screens, player_is_skipped, phone_core_only_requested,
                              phone_core_manifest_selection, player_fixture_file, player_fixture_selection)


class TvScreenSelectionTests(unittest.TestCase):
    def test_all_preserves_legacy_selection_and_player_default(self):
        selected = parse_tv_screens("all")
        self.assertIsNone(selected)
        self.assertFalse(player_is_skipped(selected, False))

    def test_subset_keeps_requested_order_and_always_skips_player(self):
        selected = parse_tv_screens("home,movies,film-detail,series-detail")
        self.assertEqual(selected, ["home", "movies", "film-detail", "series-detail"])
        self.assertTrue(player_is_skipped(selected, False))

    def test_full_selection_can_skip_player_explicitly(self):
        selected = parse_tv_screens("all")
        self.assertTrue(player_is_skipped(selected, True))

    def test_unknown_duplicate_and_empty_ids_fail_closed(self):
        for value in ("home,player-controls", "home,home", "home,,movies", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_tv_screens(value)


class PhoneCaptureSelectionTests(unittest.TestCase):
    def test_core_only_is_opt_in_and_phone_scoped(self):
        self.assertFalse(phone_core_only_requested("phone", False))
        self.assertTrue(phone_core_only_requested("phone", True))
        with self.assertRaisesRegex(ValueError, "only for phone captures"):
            phone_core_only_requested("tv", True)

    def test_core_manifest_requires_all_15_screens_including_player_chrome_by_default(self):
        suite_path = Path(__file__).resolve().parents[1] / "parity" / "suite.json"
        requested = [screen["id"] for screen in json.loads(suite_path.read_text())["screens"]]
        self.assertEqual(len(requested), 15)
        self.assertIn("player-controls", requested)

        captured_without_player = [screen for screen in requested if screen != "player-controls"]
        selection, missing = phone_core_manifest_selection(requested, captured_without_player)

        self.assertEqual(selection["mode"], "phone-core-only")
        self.assertFalse(selection["skip_player"])
        self.assertEqual(selection["skipped"], [])
        self.assertEqual(selection["requested"], requested)
        self.assertEqual(missing, ["player-controls"])

    def test_core_manifest_records_an_explicit_player_skip_without_weakening_default(self):
        suite_path = Path(__file__).resolve().parents[1] / "parity" / "suite.json"
        requested = [screen["id"] for screen in json.loads(suite_path.read_text())["screens"]]
        captured = [screen for screen in requested if screen != "player-controls"]

        selection, missing = phone_core_manifest_selection(requested, captured, skip_player=True)

        self.assertEqual(len(selection["requested"]), 14)
        self.assertTrue(selection["skip_player"])
        self.assertEqual(selection["skipped"], ["player-controls"])
        self.assertNotIn("player-controls", selection["requested"])
        self.assertEqual(selection["captured"], captured)
        self.assertEqual(missing, [])

    def test_player_chrome_requires_the_configured_playing_fixture(self):
        fixture = {"file": "sample-file", "nowPlaying": True, "expect": {"state": "playing"}}
        self.assertEqual(player_fixture_file({"performance": [fixture]}), "sample-file")
        for suite in (
                {},
                {"performance": [{"file": "sample-file", "nowPlaying": False, "expect": {"state": "playing"}}]},
                {"performance": [{"file": "sample-file", "nowPlaying": True, "expect": {"state": "ready"}}]},
                {"performance": [{"file": "", "nowPlaying": True, "expect": {"state": "playing"}}]},
        ):
            with self.subTest(suite=suite), self.assertRaisesRegex(ValueError, "playing fixture"):
                player_fixture_file(suite)

        configured_suite = json.loads((Path(__file__).resolve().parents[1] / "parity" / "suite.json").read_text())
        self.assertTrue(player_fixture_file(configured_suite))

    def test_player_fixture_override_is_opaque_optional_and_records_only_its_source(self):
        suite = {"performance": [{"file": "sample-file", "nowPlaying": True,
                                  "expect": {"state": "playing"}}]}
        self.assertEqual(player_fixture_selection(suite), ("sample-file", "suite-default"))
        self.assertEqual(player_fixture_selection(suite, ""), ("sample-file", "suite-default"))
        self.assertEqual(player_fixture_selection(suite, None), ("sample-file", "suite-default"))
        override = str(uuid.uuid4())
        selected, source = player_fixture_selection(suite, override)
        self.assertEqual(selected, override)
        self.assertEqual(source, "direct-play-fixture-override")
        for invalid in ("not-an-id",):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "override must be a UUID"):
                    player_fixture_selection(suite, invalid)


if __name__ == "__main__":
    unittest.main()
