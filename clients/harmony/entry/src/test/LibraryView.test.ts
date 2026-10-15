// entry/src/test/LibraryView.test.ts: core/LibraryView.ts against web lib/libraryView.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { COVER_CARD_HEIGHT, COVER_CARD_WIDTH, COVER_COLUMNS, COVER_GAP_X, libraryViewLabel, libraryViews, normaliseLibraryView } from "../main/ets/core/LibraryView";

test("views offered, in web's order", () => {
  assert.deepEqual(libraryViews("movie"), ["list", "screen", "cover"]);
  assert.deepEqual(libraryViews("artist"), ["list", "screen", "cover"]);
});

test("a saved view is kept when offered, else the default", () => {
  assert.equal(normaliseLibraryView("cover", "movie"), "cover");
  assert.equal(normaliseLibraryView("cover-flow", "movie"), "screen");
  assert.equal(normaliseLibraryView("nonsense", "series"), "screen");
  assert.equal(normaliseLibraryView("", "artist"), "screen");
  assert.equal(libraryViewLabel("list"), "List");
});

test("the cover wall fits the 1042 wide panel at 2:3", () => {
  const width = COVER_COLUMNS * COVER_CARD_WIDTH + (COVER_COLUMNS - 1) * COVER_GAP_X;
  assert.ok(width <= 1042 && width >= 1030, String(width));
  assert.ok(Math.abs(COVER_CARD_HEIGHT / COVER_CARD_WIDTH - 1.5) < 0.01);
});
