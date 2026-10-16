import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { applySelectedCaptures } from "./selective-captures-apply.mjs";

const scratchRoot = process.env.PLAYARR_PARITY_TEST_OUT || process.env.PLAYARR_PARITY_TEST_SCRATCH;
if (!scratchRoot) throw new Error("PLAYARR_PARITY_TEST_OUT must point to the parity test output directory");

const provenance = { suite: 1, build: "build-a", clock: "fixed-clock", state: "state-hash" };
const oldTime = "2026-10-16T00:00:00.000Z";
const newTime = "2026-10-16T01:00:00.000Z";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function setupCase(label) {
  const root = resolve(scratchRoot, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const previousDir = join(root, "previous");
  const incomingDir = join(root, "incoming");
  mkdirSync(previousDir, { recursive: true });
  mkdirSync(incomingDir, { recursive: true });
  const previousCaptures = [];
  const incomingCaptures = [];
  for (const id of ["home", "library"]) {
    const path = `${id}.png`;
    const bytes = Buffer.from(`old-${id}`);
    writeFileSync(join(previousDir, path), bytes);
    previousCaptures.push({ id, theme: "dark", path, sha256: sha256(bytes), build: provenance.build, checked_at: oldTime });
  }
  const incomingBytes = Buffer.from("new-home");
  writeFileSync(join(incomingDir, "fresh-home.png"), incomingBytes);
  incomingCaptures.push({ id: "home", theme: "dark", path: "fresh-home.png", sha256: sha256(incomingBytes), build: provenance.build, checked_at: newTime });
  const previous = { suite: 1, checked_at: oldTime, provenance, buildInfo: { branch: "main", sha: "abc", pr: null }, captures: previousCaptures };
  const incoming = { suite: 1, checked_at: newTime, provenance, captures: incomingCaptures };
  writeFileSync(join(previousDir, "captures.json"), `${JSON.stringify(previous, null, 2)}\n`);
  writeFileSync(join(incomingDir, "captures.json"), `${JSON.stringify(incoming, null, 2)}\n`);
  const untouchedPath = join(previousDir, "library.png");
  const fixedTime = new Date("2020-01-02T03:04:05.000Z");
  utimesSync(untouchedPath, fixedTime, fixedTime);
  return { previousDir, incomingDir, untouchedPath, selectedPath: join(previousDir, "home.png"), previousManifestPath: join(previousDir, "captures.json") };
}

test("filesystem dry run leaves captures and manifest untouched", () => {
  const current = setupCase("dry-run");
  const before = [current.selectedPath, current.untouchedPath, current.previousManifestPath].map((path) => ({
    bytes: readFileSync(path), mtime: statSync(path).mtimeMs,
  }));
  const result = applySelectedCaptures({ ...current, selectedIds: ["home"], allIds: ["home", "library"], themes: ["dark"] });
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.plan.map((entry) => entry.action), ["replace", "keep"]);
  for (const [index, path] of [current.selectedPath, current.untouchedPath, current.previousManifestPath].entries()) {
    assert.deepEqual(readFileSync(path), before[index].bytes);
    assert.ok(Math.abs(statSync(path).mtimeMs - before[index].mtime) < 1, `${path} mtime should be restored within filesystem timestamp precision`);
  }
});

test("filesystem apply replaces selected bytes while preserving untouched bytes and mtime", () => {
  const current = setupCase("apply");
  const untouchedBytes = readFileSync(current.untouchedPath);
  const untouchedMtime = statSync(current.untouchedPath).mtimeMs;
  const selectedMtime = statSync(current.selectedPath).mtimeMs;
  const result = applySelectedCaptures({ ...current, selectedIds: ["home"], allIds: ["home", "library"], themes: ["dark"], apply: true,
    reviewReceiptPath: writeReceipt(current) });
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.plan.map((entry) => entry.action), ["replace", "keep"]);
  assert.equal(readFileSync(current.selectedPath, "utf8"), "new-home");
  assert.ok(statSync(current.selectedPath).mtimeMs >= selectedMtime);
  assert.deepEqual(readFileSync(current.untouchedPath), untouchedBytes);
  assert.equal(statSync(current.untouchedPath).mtimeMs, untouchedMtime);
  const manifest = JSON.parse(readFileSync(current.previousManifestPath, "utf8"));
  assert.equal(manifest.captures[0].checked_at, newTime);
  assert.equal(manifest.captures[1].checked_at, oldTime);
  assert.deepEqual(manifest.buildInfo, { branch: "main", sha: "abc", pr: null });
  assert.deepEqual(readdirSync(current.previousDir).filter((name) => name.endsWith(".backup")), []);
});

test("mid-install rename failure restores the old selected files and manifest", () => {
  const current = setupCase("rollback");
  const incomingManifestPath = join(current.incomingDir, "captures.json");
  const incoming = JSON.parse(readFileSync(incomingManifestPath, "utf8"));
  const libraryBytes = Buffer.from("new-library");
  writeFileSync(join(current.incomingDir, "fresh-library.png"), libraryBytes);
  incoming.captures.push({ id: "library", theme: "dark", path: "fresh-library.png", sha256: sha256(libraryBytes), build: provenance.build, checked_at: newTime });
  writeFileSync(incomingManifestPath, `${JSON.stringify(incoming, null, 2)}\n`);

  const selectedPaths = [current.selectedPath, join(current.previousDir, "library.png")];
  const trackedPaths = [...selectedPaths, current.previousManifestPath];
  const before = trackedPaths.map((path) => ({ bytes: readFileSync(path), mtime: statSync(path).mtimeMs }));
  const originalRename = (source, target) => {
    if (source.endsWith(".stage") && ++originalRename.installs === 2) throw new Error("injected rename failure");
    return requireRename(source, target);
  };
  originalRename.installs = 0;
  assert.throws(() => applySelectedCaptures({ ...current, selectedIds: ["home", "library"], allIds: ["home", "library"], themes: ["dark"], apply: true,
    reviewReceiptPath: writeReceipt(current, ["home", "library"]), installRename: originalRename }), /injected rename failure/);
  for (const [index, path] of trackedPaths.entries()) {
    assert.deepEqual(readFileSync(path), before[index].bytes);
    assert.ok(Math.abs(statSync(path).mtimeMs - before[index].mtime) < 1, `${path} mtime should be restored within filesystem timestamp precision`);
  }
});

import { renameSync as requireRename } from "node:fs";

function writeReceipt(current, selected = ["home"]) {
  const previous = readFileSync(current.previousManifestPath);
  const incoming = readFileSync(join(current.incomingDir, "captures.json"));
  const receipt = {
    previousManifestSha256: sha256(previous),
    incomingManifestSha256: sha256(incoming),
    selected: [...selected].sort(),
    changes: [{ dropped: false }],
  };
  const receiptPath = join(current.previousDir, "review-receipt.json");
  writeFileSync(receiptPath, JSON.stringify(receipt));
  return receiptPath;
}
