import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mergeSelectedCaptures } from "./selective-captures.mjs";

test("selective capture documentation uses a valid screens-only fresh-run example", () => {
  const documentation = readFileSync(new URL("../../docs/parity/SELECTIVE-CAPTURES.md", import.meta.url), "utf8");
  const example = documentation.split("```sh\n")[1]?.split("\n```")[0];
  assert.ok(example, "documentation should include a shell example");
  assert.match(example, /--only screens --screens home/);
  assert.doesNotMatch(example, /--checks/);
});

const provenance = { suite: "suite-v1", build: "build-a", clock: "fixed-time", state: "state-hash" };
const oldTime = "2026-10-16T00:00:00.000Z";
const newTime = "2026-10-16T01:00:00.000Z";
const bytes = (text) => Buffer.from(text);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const makeCapture = (id, theme, path, content, overrides = {}) => ({
  id, theme, path, sha256: digest(content), build: provenance.build, checked_at: oldTime, ...overrides,
});
const fixture = () => {
  const previousBytes = new Map();
  const oldCaptures = [];
  for (const id of ["home", "library"]) {
    for (const theme of ["dark", "light"]) {
      const path = `${theme}/${id}.png`;
      const data = bytes(`old-${id}-${theme}`);
      previousBytes.set(path, data);
      oldCaptures.push(makeCapture(id, theme, path, data));
    }
  }
  const incomingBytes = new Map();
  const freshCaptures = [];
  for (const theme of ["dark", "light"]) {
    const path = `candidate/${theme}/home.png`;
    const data = bytes(`new-home-${theme}`);
    incomingBytes.set(path, data);
    freshCaptures.push(makeCapture("home", theme, path, data, { checked_at: newTime, detail: "new metadata" }));
  }
  return {
    previous: { suite: provenance.suite, checked_at: oldTime, provenance: { ...provenance }, buildInfo: { retained: true, branch: "main", sha: "abc", pr: null }, captures: oldCaptures },
    incoming: { suite: provenance.suite, checked_at: newTime, provenance: { ...provenance }, captures: freshCaptures },
    previousFiles: previousBytes,
    incomingFiles: incomingBytes,
    selectedIds: ["home"],
    allIds: ["home", "library"],
    themes: ["dark", "light"],
  };
};

test("replaces only selected captures and preserves other paths, bytes, metadata and timestamps", () => {
  const input = fixture();
  const merged = mergeSelectedCaptures(input);
  assert.deepEqual(merged.manifest.captures.map(({ id, theme }) => `${id}/${theme}`), ["home/dark", "home/light", "library/dark", "library/light"]);
  assert.deepEqual(merged.plan.map(({ action }) => action), ["replace", "replace", "keep", "keep"]);
  assert.equal(merged.manifest.checked_at, newTime);
  assert.deepEqual(merged.manifest.buildInfo, input.previous.buildInfo);
  assert.equal(merged.manifest.captures[0].path, input.previous.captures[0].path);
  assert.equal(merged.manifest.captures[0].checked_at, newTime);
  assert.equal(merged.manifest.captures[0].sha256, input.incoming.captures[0].sha256);
  assert.deepEqual(merged.manifest.captures[2], input.previous.captures[2]);
  assert.equal(merged.files.get("dark/home.png").toString(), "new-home-dark");
  assert.equal(merged.files.has("light/library.png"), false);
  assert.equal(merged.files.size, 2);
  assert.equal(merged.files.has("dark/library.png"), false);
});

test("dry-run returns the full review plan and merged manifest without file bytes", () => {
  const merged = mergeSelectedCaptures({ ...fixture(), dryRun: true });
  assert.equal(merged.dryRun, true);
  assert.equal(merged.files, undefined);
  assert.equal(merged.plan.length, 4);
  assert.equal(merged.plan[0].action, "replace");
  assert.equal(merged.plan[2].action, "keep");
  assert.equal(merged.manifest.captures.length, 4);
});

test("rejects malformed, absolute, traversing and duplicate paths", () => {
  const absolute = fixture();
  absolute.incoming.captures[0].path = "/outside.png";
  assert.throws(() => mergeSelectedCaptures(absolute), /safe relative POSIX path/);
  const traversal = fixture();
  traversal.incoming.captures[0].path = "candidate/../home.png";
  assert.throws(() => mergeSelectedCaptures(traversal), /safe relative POSIX path/);
  const malformed = fixture();
  malformed.incoming.captures[0].path = "candidate\\home.png";
  assert.throws(() => mergeSelectedCaptures(malformed), /safe relative POSIX path/);
  const duplicate = fixture();
  duplicate.previous.captures[1].path = duplicate.previous.captures[0].path;
  assert.throws(() => mergeSelectedCaptures(duplicate), /duplicate path/);
});

test("verifies SHA-256 for every capture against its supplied bytes", () => {
  const mismatch = fixture();
  mismatch.incomingFiles.set(mismatch.incoming.captures[0].path, bytes("tampered"));
  assert.throws(() => mergeSelectedCaptures(mismatch), /SHA-256 mismatch/);
  const missing = fixture();
  missing.previousFiles.delete("dark/home.png");
  assert.throws(() => mergeSelectedCaptures(missing), /missing bytes/);
});

test("requires exact complete prior and selected coverage with no duplicate entries", () => {
  const missingPrior = fixture();
  missingPrior.previous.captures.pop();
  assert.throws(() => mergeSelectedCaptures(missingPrior), /cover the requested screens and themes exactly/);
  const missingIncoming = fixture();
  missingIncoming.incoming.captures.pop();
  assert.throws(() => mergeSelectedCaptures(missingIncoming), /cover the requested screens and themes exactly/);
  const duplicateCoverage = fixture();
  duplicateCoverage.incoming.captures[1] = { ...duplicateCoverage.incoming.captures[0] };
  assert.throws(() => mergeSelectedCaptures(duplicateCoverage), /duplicate screen\/theme coverage/);
});

test("rejects provenance or capture build changes, including an incoming build with prior frames", () => {
  const mismatch = fixture();
  mismatch.incoming.provenance.build = "build-b";
  assert.throws(() => mergeSelectedCaptures(mismatch), /provenance mismatch for build/);
  const priorFrame = fixture();
  priorFrame.incoming.captures[0].build = "build-b";
  assert.throws(() => mergeSelectedCaptures(priorFrame), /does not match incoming provenance build/);
  const provenanceField = fixture();
  provenanceField.incoming.provenance.state = "other-state";
  assert.throws(() => mergeSelectedCaptures(provenanceField), /provenance mismatch for state/);
});

test("accepts finite numeric suite versions and requires parseable ISO timestamps", () => {
  const numeric = fixture();
  numeric.previous.suite = 4;
  numeric.previous.provenance.suite = 4;
  numeric.incoming.suite = 4;
  numeric.incoming.provenance.suite = 4;
  assert.equal(mergeSelectedCaptures(numeric).manifest.suite, 4);
  const badTimestamp = fixture();
  badTimestamp.incoming.checked_at = "candidate-run";
  assert.throws(() => mergeSelectedCaptures(badTimestamp), /parseable ISO timestamp/);
  const badCaptureTimestamp = fixture();
  badCaptureTimestamp.incoming.captures[0].checked_at = "not-a-time";
  assert.throws(() => mergeSelectedCaptures(badCaptureTimestamp), /parseable ISO timestamp/);
});

test("rejects conflicting incoming folder build identity while retaining the old build metadata", () => {
  const conflict = fixture();
  conflict.incoming.buildInfo = { branch: "release", sha: "def", pr: null, captured_at: newTime };
  assert.throws(() => mergeSelectedCaptures(conflict), /conflicts with the previous capture folder/);
  const compatible = fixture();
  compatible.incoming.buildInfo = { branch: "main", sha: "abc", pr: null, captured_at: newTime };
  assert.deepEqual(mergeSelectedCaptures(compatible).manifest.buildInfo, compatible.previous.buildInfo);
});

test("rejects invalid IDs, themes, manifest metadata and unknown incoming frames", () => {
  assert.throws(() => mergeSelectedCaptures({ ...fixture(), selectedIds: [] }), /must not be empty/);
  assert.throws(() => mergeSelectedCaptures({ ...fixture(), allIds: ["home", "home"] }), /allIds contains duplicate/);
  assert.throws(() => mergeSelectedCaptures({ ...fixture(), selectedIds: ["other"] }), /unknown screen ID/);
  const missingBuild = fixture();
  delete missingBuild.incoming.provenance.build;
  assert.throws(() => mergeSelectedCaptures(missingBuild), /incoming provenance.build/);
  const extraIncoming = fixture();
  extraIncoming.incoming.captures[0].id = "library";
  assert.throws(() => mergeSelectedCaptures(extraIncoming), /unknown screen ID/);
});
