"""Source guard for the shared page anatomy (docs/design/page-layout.md sections 2 and 7.2, row 13.806).

Mirrors the Fire TV pageLayoutGuard (13.807): every page draws its header pieces (round Back button, title spec, action tile)
through the shared helpers in Pages.brs and nowhere else. UNMIGRATED lists places that still hand-roll a piece; it only
shrinks: remove an entry when the place adopts the helper (the test then fails if the entry is stale).
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

COMPONENTS = Path(__file__).resolve().parents[1] / "components"
SOURCES = {p.name: p.read_text(encoding="utf-8") for p in COMPONENTS.glob("*.brs")}

# (file, rule) pairs allowed to break a rule. Empty today: do not add to it.
UNMIGRATED: list[tuple[str, str]] = []

# Pages that draw the shared header: the function that must call the Back helper.
HEADER_CALLERS = {
    "Pages.brs": "m.pageHead, backX",  # Pages shell (Watchlist, Requests, Calendar, Settings, Clients ...)
    "MainScene.brs": "holder, 153.6",  # Library, Search and Detail chrome
}
# Pages with no header (spec section 2, rule 1): Home, player, profile picker, pairing and status screens.
EXEMPT = ("homeGroup", "playbackGroup", "profilesGroup", "pairingGroup", "statusGroup")


def helper_body(src: str, name: str) -> str:
    m = re.search(rf"^(?:sub|function) {name}\(.*?^end (?:sub|function)", src, re.S | re.M)
    assert m, f"{name} is missing"
    return m.group(0)


def outside_helpers(helpers: dict[str, str]) -> dict[str, str]:
    """Every source with the shared helper bodies removed."""
    out = {}
    for name, src in SOURCES.items():
        for body in helpers.get(name, []):
            src = src.replace(body, "")
        out[name] = src
    return out


class PageAnatomyGuard(unittest.TestCase):
    def setUp(self) -> None:
        pages = SOURCES["Pages.brs"]
        self.helpers = {"Pages.brs": [helper_body(pages, n) for n in ("pgBackButton", "PageTitleSpec", "pgShellTile")]}
        self.rest = outside_helpers(self.helpers)

    def offenders(self, pattern: str, rule: str) -> list[str]:
        allowed = {f for f, r in UNMIGRATED if r == rule}
        return sorted(f for f, src in self.rest.items() if re.search(pattern, src) and f not in allowed)

    def test_back_button_is_drawn_only_by_the_shared_helper(self) -> None:
        # The calendar's Previous arrow reuses the glyph on a 1629 px control, not the Back button.
        self.assertEqual(self.offenders(r'56\.3, 50, 50, 25, "surface", 179', "back"), [])
        stray = [f for f, s in self.rest.items() if re.search(r'"arrow-left\.png"', re.sub(r"^.*1646\.5.*$", "", s, flags=re.M))]
        self.assertEqual(sorted(set(stray) - {f for f, r in UNMIGRATED if r == "back"}), [])

    def test_header_title_spec_comes_from_the_shared_helper(self) -> None:
        self.assertEqual(self.offenders(r"tracking: -1\.512", "title"), [])

    def test_action_tile_comes_from_the_shared_helper(self) -> None:
        self.assertEqual(self.offenders(r'pgIcon\([^\n]*"tile-', "tile"), [])
        # Callers go through pgTile / pgShellTile.
        self.assertIn('pgShellTile(holder, tx, ty, "Filters", "tile-filters.png")', SOURCES["Pages.brs"])

    def test_every_header_page_calls_the_back_helper(self) -> None:
        for fname, needle in HEADER_CALLERS.items():
            self.assertIn(f"pgBackButton({needle}", SOURCES[fname], fname)
        calls = len(re.findall(r"pgBackButton\(", "".join(SOURCES.values()))) - 1  # minus the definition
        self.assertEqual(calls, 4, "pageBegin, browseChromeInit, searchChromeInit, detailChromeInit")

    def test_unmigrated_entries_are_not_stale(self) -> None:
        # An entry must still match its rule's pattern, otherwise delete it (the list only shrinks).
        patterns = {"back": r'56\.3, 50, 50, 25, "surface", 179', "title": r"tracking: -1\.512", "tile": r'pgIcon\([^\n]*"tile-'}
        for fname, rule in UNMIGRATED:
            self.assertRegex(self.rest[fname], patterns[rule], f"{fname} no longer breaks {rule}: remove it")


if __name__ == "__main__":
    unittest.main()
