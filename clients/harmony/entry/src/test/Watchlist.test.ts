// entry/src/test/Watchlist.test.ts: core/Watchlist.ts against web lib/discovery.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { explainedReasons, libraryWorkId, primaryActionLabel, sourceChips } from "../main/ets/core/Watchlist";
import type { WatchlistTitle } from "../main/ets/core/Types/Watchlist";

const title = (sources: WatchlistTitle["sources"]): WatchlistTitle => ({ title_key: "k", kind: "movie", title: "T", sources });

test("the library copy opens, a request-only title does not", () => {
  assert.equal(libraryWorkId(title([{ source: "request", label: "R" }, { source: "library", label: "L", work_id: "w1" }])), "w1");
  assert.equal(libraryWorkId(title([{ source: "request", label: "R", work_id: "w2" }])), null);
});

test("source chips are unique, in order", () => {
  assert.deepEqual(sourceChips([{ source: "library", label: "a" }, { source: "peer", label: "b" }, { source: "library", label: "c" }]),
    ["Library", "Peer server"]);
});

test("primary action: resume beats play beats request; disabled never wins", () => {
  assert.equal(primaryActionLabel([{ action: "play", enabled: true }, { action: "resume", enabled: true }]), "Resume");
  assert.equal(primaryActionLabel([{ action: "resume", enabled: false }, { action: "request", enabled: true }]), "Request");
  assert.equal(primaryActionLabel([{ action: "play", enabled: false }]), null);
});

test("explained reasons skip record and enabled actions", () => {
  assert.deepEqual(explainedReasons([
    { action: "record", enabled: false, reason: "dev text" },
    { action: "play", enabled: false, reason: "No file yet" },
    { action: "request", enabled: true, reason: "ignored" },
  ]), ["Play: No file yet"]);
});
