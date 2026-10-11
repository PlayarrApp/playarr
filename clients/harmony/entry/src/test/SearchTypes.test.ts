// entry/src/test/SearchTypes.test.ts: core/SearchTypes.ts against web pages/Search.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { searchTypeChoices, workMatchesType } from "../main/ets/core/SearchTypes";

test("choices are All plus the kinds the server has, in web order", () => {
  assert.deepEqual(searchTypeChoices(["artist", "movie", "author"]).map((c) => c.value), ["all", "movie", "artist"]);
  assert.deepEqual(searchTypeChoices([]).map((c) => c.value), ["all"]);
});

test("a type keeps only its kind; All keeps everything", () => {
  assert.equal(workMatchesType("movie", "all"), true);
  assert.equal(workMatchesType("movie", "movie"), true);
  assert.equal(workMatchesType("series", "movie"), false);
});
