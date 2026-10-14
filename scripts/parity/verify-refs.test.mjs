import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { verifyDir } from "./verify-refs.mjs";

const png = (file, y) => {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < p.data.length; i += 4) { const v = i === 0 ? 255 - y : y; p.data.set([v, v, v, 255], i); }
  writeFileSync(file, PNG.sync.write(p));
};
const good = { theme: "x", signedOut: false, skeletons: 0, brokenSrc: [], fontsReady: true, dialogs: 0 };

test("verifyDir accepts a clean pair and flags wrong theme, skeletons and titles", () => {
  const dir = mkdtempSync(join(tmpdir(), "refs-"));
  for (const t of ["dark", "light"]) mkdirSync(join(dir, t));
  png(join(dir, "dark", "film-detail.png"), 20); png(join(dir, "light", "film-detail.png"), 240);
  const manifest = { dialogScreens: [], titles: { "film-detail": "A" } };
  const group = { pixels: [4, 4] };
  const facts = (over) => writeFileSync(join(dir, "facts.json"), JSON.stringify({ facts: {
    "dark/film-detail": { ...good, theme: "dark", detailTitle: "A", ...over }, "light/film-detail": { ...good, theme: "light", detailTitle: "A" } } }));
  facts({});
  assert.deepEqual(verifyDir(dir, group, manifest, ["film-detail"]), []);
  facts({ skeletons: 2, detailTitle: "B" });
  assert.equal(verifyDir(dir, group, manifest, ["film-detail"]).length, 2);
  facts({ resumeState: true });
  assert.match(verifyDir(dir, group, manifest, ["film-detail"])[0], /Resume or Ask-again/);
  assert.match(verifyDir(dir, { pixels: [5, 4] }, manifest, ["film-detail"])[0], /expected 5x4/);
});
