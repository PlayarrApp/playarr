// entry/src/test/GeneratedChapters.test.ts: core/GeneratedChapters.ts against web's generatedMovieChapters.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { generatedMovieChapters } from "../main/ets/core/GeneratedChapters";

test("a 60 s clip gets one marker at 0:00", () => {
  const chapters = generatedMovieChapters(60000);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].start_ms, 0);
  assert.equal(chapters[0].end_ms, 60000);
});

test("a 100 minute film gets 10-minute markers, a missing runtime none", () => {
  assert.equal(generatedMovieChapters(100 * 60000).length, 10);
  assert.equal(generatedMovieChapters(0).length, 0);
  assert.equal(generatedMovieChapters(600 * 60000).length, 20);
});
