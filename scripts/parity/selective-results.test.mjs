import test from "node:test";
import assert from "node:assert/strict";
import { mergeSelectedResults } from "./selective-results.mjs";

const provenance = { suite: 1, build: "build-a", clock: "fixed-time", state: "state-hash", stable: true, referenceSha256: "a".repeat(64) };
const oldTime = "2026-10-15T10:00:00.000Z";
const newTime = "2026-10-16T10:00:00.000Z";
const prior = () => ({
  suite: provenance.suite,
  checked_at: oldTime,
  provenance: { ...provenance },
  results: [
    { id: "alpha", pass: true, checked_at: oldTime, detail: "keep" },
    { id: "beta", pass: false, checked_at: oldTime },
    { id: "gamma", pass: null, checked_at: oldTime, state: "skipped" },
  ],
});
const run = (overrides = {}) => mergeSelectedResults({
  previous: prior(),
  results: [{ id: "beta", pass: true, detail: "refreshed" }],
  selectedIds: ["beta"],
  allIds: ["alpha", "beta", "gamma"],
  stamp: { suite: provenance.suite, checked_at: newTime },
  provenance: { ...provenance },
  ...overrides,
});

test("merges selected results in allIds order and preserves untouched values and timestamps", () => {
  const merged = run();
  assert.equal(merged.checked_at, newTime);
  assert.deepEqual(merged.results.map(({ id }) => id), ["alpha", "beta", "gamma"]);
  assert.deepEqual(merged.results[0], prior().results[0]);
  assert.deepEqual(merged.results[1], { id: "beta", pass: true, detail: "refreshed", checked_at: newTime });
  assert.deepEqual(merged.results[2], prior().results[2]);
});

test("allows a pass-count regression only with a non-empty acknowledgement", () => {
  const results = [{ id: "alpha", pass: false }];
  assert.throws(() => run({ results, selectedIds: ["alpha"] }), /regressionReason/);
  const merged = run({ results, selectedIds: ["alpha"], regressionReason: "Known temporary failure" });
  assert.equal(merged.results[0].pass, false);
});

test("excludes pass:null results when checking the pass count", () => {
  const previous = prior();
  previous.results[0].pass = null;
  const merged = run({ previous, results: [{ id: "beta", pass: true }], selectedIds: ["beta"] });
  assert.equal(merged.results[1].pass, true);
});

test("rejects empty, duplicate, and unknown selections", () => {
  assert.throws(() => run({ selectedIds: [] }), /must not be empty/);
  assert.throws(() => run({ selectedIds: ["beta", "beta"] }), /duplicate/);
  assert.throws(() => run({ selectedIds: ["missing"] }), /unknown ID/);
});

test("rejects duplicate suite IDs and selected results that do not exactly cover the selection", () => {
  assert.throws(() => run({ allIds: ["alpha", "alpha"] }), /allIds contains duplicate/);
  assert.throws(() => run({ results: [], selectedIds: ["beta"] }), /cover selectedIds exactly/);
  assert.throws(() => run({ results: [{ id: "beta", pass: true }, { id: "beta", pass: false }] }), /duplicate IDs/);
  assert.throws(() => run({ results: [{ id: "alpha", pass: true }] }), /cover selectedIds exactly/);
});

test("rejects prior result sets that are missing, unknown, or duplicated", () => {
  const missing = prior();
  missing.results.pop();
  assert.throws(() => run({ previous: missing }), /cover allIds exactly/);
  const unknown = prior();
  unknown.results[0].id = "outside";
  assert.throws(() => run({ previous: unknown }), /cover allIds exactly/);
  const duplicate = prior();
  duplicate.results[1].id = "alpha";
  assert.throws(() => run({ previous: duplicate }), /duplicate IDs/);
});

test("requires matching complete provenance and suite identity", () => {
  assert.throws(() => run({ provenance: { ...provenance, build: "build-b" } }), /provenance mismatch for build/);
  assert.throws(() => run({ provenance: { ...provenance, stable: false } }), /provenance mismatch for stable/);
  assert.throws(() => run({ provenance: { ...provenance, referenceSha256: "b".repeat(64) } }), /provenance mismatch for referenceSha256/);
  assert.throws(() => run({ provenance: { ...provenance, stable: "true" } }), /provenance.stable must be a boolean/);
  assert.throws(() => run({ provenance: { suite: "suite-v1", build: "build-a", clock: "fixed-time" } }), /provenance.state/);
  const previous = prior();
  previous.suite = "suite-v0";
  assert.throws(() => run({ previous }), /suite mismatch/);
});

test("requires prior provenance and a valid incoming timestamp", () => {
  const previous = prior();
  delete previous.provenance;
  assert.throws(() => run({ previous }), /previous provenance/);
  assert.throws(() => run({ stamp: { checked_at: "not-a-date" } }), /parseable ISO timestamp/);
  assert.throws(() => run({ previous: { ...prior(), checked_at: "not-a-date" } }), /previous checked_at/);
});

test("persists regression acknowledgement in audit metadata", () => {
  const merged = run({ results: [{ id: "alpha", pass: false }], selectedIds: ["alpha"], regressionReason: "Expected staging regression" });
  assert.equal(merged.regressionReason, "Expected staging regression");
});
