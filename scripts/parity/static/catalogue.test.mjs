import assert from "node:assert/strict";
import { test } from "node:test";
import { CALENDAR, CLOCK, MOVIES, ON_DECK, PINNED, SERIES, uid } from "./catalogue.mjs";

test("catalogue is deterministic and sized for every screen", () => {
  assert.equal(MOVIES.length, 30);
  assert.equal(SERIES.length, 20);
  assert.equal(CLOCK, "2026-10-07T12:00:00Z");
  assert.equal(uid("x"), uid("x"));
  const ids = [...MOVIES.map((m) => m.workId), ...SERIES.map((s) => s.workId), ...MOVIES.map((m) => m.fileId)];
  assert.equal(new Set(ids).size, ids.length);
  const added = [...MOVIES, ...SERIES].map((t) => t.addedAt);
  assert.equal(new Set(added).size, added.length, "every added date is distinct, so Recently Added order is fixed");
  assert.equal(ON_DECK.length, 1, "the canonical deck item only");
});

test("suite.json pinned ids exist in the catalogue", () => {
  assert.equal(MOVIES[0].workId, PINNED["movie:0"].work);
  assert.equal(SERIES[0].workId, PINNED["series:0"].work);
  assert.equal(MOVIES[1].fileId, PINNED["movie:1"].file);
  const ep = SERIES[1].seasons[1].episodes[2];
  assert.equal(ep.fileId, PINNED["series:1"].episodeFile.id);
  assert.ok(CALENDAR.every((e) => e.date.startsWith("2026-")));
});
