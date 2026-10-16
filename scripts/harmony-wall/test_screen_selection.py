import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from screen_selection import parse_tv_screens, player_is_skipped, selected_library_route


class TvScreenSelectionTests(unittest.TestCase):
    def test_all_preserves_legacy_selection_and_player_default(self):
        selected = parse_tv_screens("all")
        self.assertIsNone(selected)
        self.assertFalse(player_is_skipped(selected, False))

    def test_subset_keeps_requested_order_and_always_skips_player(self):
        selected = parse_tv_screens("home,movies,series,music,film-detail,series-detail")
        self.assertEqual(selected, ["home", "movies", "series", "music", "film-detail", "series-detail"])
        self.assertTrue(player_is_skipped(selected, False))

    def test_series_and_music_library_routes_are_supported(self):
        self.assertEqual(parse_tv_screens("series,music"), ["series", "music"])
        self.assertEqual(selected_library_route("series"), "library:series")
        self.assertEqual(selected_library_route("music"), "library:artist")
        self.assertIsNone(selected_library_route("series-detail"))

    def test_full_selection_can_skip_player_explicitly(self):
        selected = parse_tv_screens("all")
        self.assertTrue(player_is_skipped(selected, True))

    def test_unknown_duplicate_and_empty_ids_fail_closed(self):
        for value in ("home,player-controls", "home,home", "home,,movies", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_tv_screens(value)


if __name__ == "__main__":
    unittest.main()
