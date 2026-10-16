import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findDriftedCopies } from "./ref-copies.mjs";

const manifest = { screens: ["home"], groups: { tv: { dirs: ["a", "b", "c"] }, solo: { dirs: ["d"] } } };
const put = (root, dir, theme, bytes) => {
  mkdirSync(join(root, dir, "web", theme), { recursive: true });
  writeFileSync(join(root, dir, "web", theme, "home.png"), bytes);
};

test("reports only the dir and theme whose copy differs from the group's first dir", () => {
  const root = mkdtempSync(join(process.env.PLAYARR_PARITY_TEST_OUT ?? tmpdir(), "refcopies-"));
  for (const d of ["a", "b", "c", "d"]) for (const t of ["", "light"]) put(root, d, t, "same");
  put(root, "c", "light", "other");
  assert.deepEqual(findDriftedCopies(root, manifest), [{ group: "tv", dir: "c", theme: "light", screen: "home" }]);
});

test("a missing copy counts as drift, a missing first dir is skipped", () => {
  const root = mkdtempSync(join(process.env.PLAYARR_PARITY_TEST_OUT ?? tmpdir(), "refcopies-"));
  put(root, "a", "", "same"); put(root, "b", "", "same");
  assert.deepEqual(findDriftedCopies(root, manifest), [{ group: "tv", dir: "c", theme: "dark", screen: "home" }]);
});
