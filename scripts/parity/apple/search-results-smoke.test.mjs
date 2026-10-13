import test from "node:test";
import assert from "node:assert/strict";
import { compareSearchEvidence, parseArgs, parseResultCount } from "./search-results-smoke.mjs";

test("argument parsing accepts one bounded query without exposing it", () => {
  assert.deepEqual(parseArgs(["--query", "the" ]), { query: "the" });
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(["--query", "first", "--query", "second"]), null);
  assert.equal(parseArgs(["--query", "\nunsafe"]), null);
  assert.equal(parseArgs(["--query", "x".repeat(81)]), null);
});

test("result readiness requires matching queries and at least two equal ordered results", () => {
  assert.equal(parseResultCount(["Search", "3 results"]), 3);
  assert.equal(parseResultCount(["3 results", "3 results"]), 3);
  assert.equal(parseResultCount(["3 results", "4 results"]), null);
  const ready = compareSearchEvidence({
    webQuery: "the", nativeQuery: " the ", webLabels: ["First", "Second", "Third", "Fourth"],
    webCount: 4, nativeCount: 4, webFirst: "First", webDown: "Fourth",
    nativeFirst: "first", nativeDown: "Fourth",
  });
  assert.deepEqual(ready, { status: "complete", sameQuery: true, countsReady: true, firstMatches: true,
    downMatches: true, webFirstOrdinal: 0, webDownOrdinal: 3, firstOrdinal: 0, downOrdinal: 3 });
  const tooFew = compareSearchEvidence({
    webQuery: "the", nativeQuery: "the", webLabels: ["First"], webCount: 1, nativeCount: 1,
    nativeFirst: "First", nativeDown: null,
  });
  assert.equal(tooFew.status, "not_executed");
  assert.equal(tooFew.countsReady, false);
});

test("same count does not pass when native focus identities differ", () => {
  const result = compareSearchEvidence({
    webQuery: "the", nativeQuery: "the", webLabels: ["First", "Second", "Third", "Fourth"], webCount: 4,
    nativeCount: 4, webFirst: "First", webDown: "Fourth", nativeFirst: "Different", nativeDown: "Fourth",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.firstMatches, false);
  assert.equal(result.downMatches, true);
});

test("a missing or non-distinct observed Down target is not executed", () => {
  const result = compareSearchEvidence({
    webQuery: "the", nativeQuery: "the", webLabels: ["First", "Second"], webCount: 2,
    nativeCount: 2, webFirst: "First", webDown: "First", nativeFirst: "First", nativeDown: "First",
  });
  assert.equal(result.status, "not_executed");
});

test("duplicate Web result labels cannot prove a unique native ordinal", () => {
  const result = compareSearchEvidence({
    webQuery: "the", nativeQuery: "the", webLabels: ["First", "First", "Third", "Fourth"],
    webCount: 4, nativeCount: 4, webFirst: "First", webDown: "Fourth", nativeFirst: "First", nativeDown: "Fourth",
  });
  assert.equal(result.status, "not_executed");
});

test("matching a non-first Web focus does not prove first-result entry", () => {
  const result = compareSearchEvidence({
    webQuery: "the", nativeQuery: "the", webLabels: ["First", "Second", "Third", "Fourth"],
    webCount: 4, nativeCount: 4, webFirst: "Second", webDown: "Fourth", nativeFirst: "Second", nativeDown: "Fourth",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.firstMatches, false);
  assert.equal(result.downMatches, true);
});
