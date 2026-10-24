import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inspectRun, publishRun, removeDownloadedImages } from "./ios/publish.mjs";

const sha = "a".repeat(40);
const capturedAt = "2026-10-07T12:00:00Z";
const layout = { viewport: { w: 393, h: 852, dpr: 3 }, clockPinned: true, elements: [{ text: "Sample", role: "text", rect: { x: 20, y: 40, w: 60, h: 20 } }] };
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); };
function fixture() {
  assert.ok(process.env.PLAYARR_PARITY_TEST_OUT, "PLAYARR_PARITY_TEST_OUT must name task-scoped scratch space");
  const root = mkdtempSync(join(process.env.PLAYARR_PARITY_TEST_OUT, "ios-publication-"));
  const work = join(root, "run"), legendRoot = join(root, "legend"), device = "iphone";
  for (const theme of ["dark", "light"]) {
    write(join(work, theme, "build.json"), { sha, captured_at: capturedAt });
    write(join(work, theme, theme, "home.png"), "new screenshot");
    write(join(work, theme, "layout", theme, "home.json"), layout);
    for (const screen of ["home", "movies"]) write(join(legendRoot, "ios-phone/web/layout", theme, `${screen}.json`), layout);
  }
  return { work, legendRoot, device, sha, screens: ["home", "movies"], branch: "parity-test", pr: 123, run: 456 };
}

test("partial publication preserves original timestamps and cannot retain stale active pairs", () => {
  const args = fixture(), candidate = join(args.legendRoot, "ios-phone/dev");
  write(join(candidate, "movies.png"), "old screenshot");
  write(join(candidate, "layout/dark/movies.json"), { previous: true });
  write(join(candidate, "build.json"), { sha: "b".repeat(40) });
  const manifest = inspectRun(args);
  assert.equal(manifest.themes.dark.rows[0].score.score, 100);
  assert.deepEqual(manifest.themes.dark.rows[1], { screen: "movies", png: false, layout: false });
  publishRun({ ...args, manifest });
  assert.equal(existsSync(join(candidate, "movies.png")), false);
  assert.equal(existsSync(join(candidate, "layout/dark/movies.json")), false);
  assert.equal(JSON.parse(readFileSync(join(args.work, "previous-json/layout/dark/movies.json"))).previous, true);
  const build = JSON.parse(readFileSync(join(candidate, "build.json")));
  assert.equal(build.captured_at, capturedAt);
  assert.equal(build.pr, args.pr);
  removeDownloadedImages(join(args.work, "dark"));
  assert.equal(existsSync(join(args.work, "dark/dark/home.png")), false);
  assert.equal(existsSync(join(args.work, "dark/layout/dark/home.json")), true);
  assert.equal(existsSync(join(candidate, "home.png")), true);
});

test("wrong provenance or native viewport prevents publication", () => {
  const args = fixture();
  write(join(args.work, "light/build.json"), { sha: "b".repeat(40), captured_at: capturedAt });
  assert.throws(() => inspectRun(args), /provenance/);
  write(join(args.work, "light/build.json"), { sha, captured_at: capturedAt });
  write(join(args.work, "light/layout/light/home.json"), { ...layout, viewport: { w: 852, h: 393, dpr: 3 } });
  assert.throws(() => inspectRun(args), /viewport/);
});

test("a changed artifact cannot erase the current candidate", () => {
  const args = fixture(), candidate = join(args.legendRoot, "ios-phone/dev");
  write(join(candidate, "home.png"), "current screenshot");
  const manifest = inspectRun(args);
  write(join(args.work, "light/light/home.png"), "changed screenshot");
  assert.throws(() => publishRun({ ...args, manifest }), /changed after inspection/);
  assert.equal(readFileSync(join(candidate, "home.png"), "utf8"), "current screenshot");
});
