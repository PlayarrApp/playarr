import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from screen_selection import parse_phone_screens, parse_tv_screens, player_is_skipped


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


class PhoneScreenSelectionTests(unittest.TestCase):
    def test_all_preserves_legacy_phone_walk(self):
        self.assertIsNone(parse_phone_screens("all"))

    def test_selected_phone_screens_preserve_order_and_exclude_player_routes(self):
        selected = parse_phone_screens("series-detail,film-detail")
        self.assertEqual(selected, ["series-detail", "film-detail"])
        self.assertTrue(player_is_skipped(selected, False))
        for value in ("player-controls", "actions", "series-detail,series-detail", "home,,movies", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_phone_screens(value)


if __name__ == "__main__":
    unittest.main()
