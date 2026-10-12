import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expandKeys, focusForCheck, routeMatches, validateSuite } from "./suite-lib.mjs";

const suite = JSON.parse(readFileSync(new URL("./suite.json", import.meta.url), "utf8"));
const legend = ["home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "player-controls", "actions"];

test("suite.json is valid and matches the legend screens", () => assert.deepEqual(validateSuite(suite, legend), []));
test("validator rejects a bad suite", () => {
  const s = structuredClone(suite);
  s.screens[1].keys = ["sideways"];
  s.dpad[0].from = "nowhere";
  s.performance.pop();
  assert.equal(validateSuite(s, legend).length, 3);
});
test("expandKeys repeats and long presses", () => {
  assert.deepEqual(expandKeys(["down*2", "select:long"]), [{ key: "down", long: false }, { key: "down", long: false }, { key: "select", long: true }]);
});
test("routeMatches", () => {
  assert.ok(routeMatches("/movies/:id", "/movies/abc"));
  assert.ok(!routeMatches("/movies/:id", "/movies"));
  assert.ok(routeMatches("/calendar?view=week", "/calendar?view=week&x=1"));
  assert.ok(!routeMatches("/calendar?view=week", "/calendar?view=month"));
});

test("focus-order checks keep play/pause role semantics while toggle checks keep state", () => {
  assert.equal(focusForCheck("Pause", "player-left-edge").label, "play-pause");
  assert.equal(focusForCheck("Play", "player-left-edge").label, "play-pause");
  assert.equal(focusForCheck("Pause", "player-ok-toggle").label, "pause");
  assert.equal(focusForCheck("Play", "player-ok-toggle").label, "play");
});

test("long-press-actions matches the committed web Play glyph to the native Play label", () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  if (testRoot) mkdirSync(testRoot, { recursive: true });
  const out = mkdtempSync(join(testRoot || tmpdir(), "playarr-parity-actions-"));
  const driver = new URL("./test-drivers/long-press-actions.mjs", import.meta.url).pathname;
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  try {
    const expected = new URL("./expected.web.json", import.meta.url).pathname;
    const result = spawnSync(process.execPath, [runner, "--driver", driver, "--out", out, "--only", "dpad", "--checks", "long-press-actions", "--via", "route", "--expected", expected], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const scored = JSON.parse(readFileSync(join(out, "dpad.json"), "utf8"));
    assert.equal(scored.results.find((check) => check.id === "long-press-actions").expected, "▶play");
    assert.equal(scored.results.find((check) => check.id === "long-press-actions").actual, "play");
    assert.equal(scored.results.find((check) => check.id === "long-press-actions").pass, true);
    const webExpected = JSON.parse(readFileSync(new URL("./expected.web.json", import.meta.url), "utf8"));
    assert.equal(focusForCheck(webExpected.dpad["long-press-actions"], "long-press-actions").label, "play");
    assert.equal(focusForCheck("play-pause", "long-press-actions").label, "play");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("player toggle reference records exact web state and rejects an unchanged pause control", () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  if (testRoot) mkdirSync(testRoot, { recursive: true });
  const out = mkdtempSync(join(testRoot || tmpdir(), "playarr-parity-toggle-"));
  const driver = new URL("./test-drivers/player-toggle.mjs", import.meta.url).pathname;
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  const run = (mode, extra = [], marker, routeMarker, forcePlayer = true) => spawnSync(process.execPath, [runner, "--driver", driver, "--out", out, "--only", "dpad", "--checks", "player-ok-toggle", "--via", "route", ...(forcePlayer ? ["--player"] : []), ...extra], {
    encoding: "utf8",
    env: { ...process.env, PARITY_TEST_TOGGLE: mode, ...(marker ? { PARITY_TEST_START_MARKER: marker } : {}), ...(routeMarker ? { PARITY_TEST_ROUTE_MARKER: routeMarker } : {}) },
  });
  try {
    const reference = run("yes", ["--reference"]);
    assert.equal(reference.status, 0, reference.stderr || reference.stdout);
    const expected = JSON.parse(readFileSync(join(out, "expected.json"), "utf8"));
    assert.equal(expected.dpad["player-ok-toggle"], "play");

    const scored = run("no", ["--expected", join(out, "expected.json")]);
    assert.equal(scored.status, 0, scored.stderr || scored.stdout);
    const result = JSON.parse(readFileSync(join(out, "dpad.json"), "utf8"));
    assert.equal(result.results.find((x) => x.id === "player-ok-toggle").pass, false);

    const roleOnly = run("role", ["--expected", join(out, "expected.json")]);
    assert.equal(roleOnly.status, 0, roleOnly.stderr || roleOnly.stdout);
    const roleResult = JSON.parse(readFileSync(join(out, "dpad.json"), "utf8"));
    assert.equal(roleResult.results.find((x) => x.id === "player-ok-toggle").pass, false);

    const marker = join(out, "driver-started");
    const stale = run("no", [], marker);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /web reference has no exact Play\/Pause state/);
    assert.equal(existsSync(marker), false);

    const routed = join(out, "player-routed");
    const skipped = run("no", ["--skip-player"], undefined, routed, false);
    assert.equal(skipped.status, 0, skipped.stderr || skipped.stdout);
    const skippedResult = JSON.parse(readFileSync(join(out, "dpad.json"), "utf8"));
    assert.equal(skippedResult.results.find((x) => x.id === "player-ok-toggle").pass, null);
    assert.equal(existsSync(routed), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("committed web expected.json covers every D-pad check, never null", () => {
  const exp = JSON.parse(readFileSync(new URL("./expected.web.json", import.meta.url), "utf8"));
  for (const d of suite.dpad) assert.ok(exp.dpad[d.id], `${d.id} has an expected value`);
  for (const d of suite.dpad.filter((x) => x.compare === "position")) assert.ok(exp.dpad[d.id].position, `${d.id} has a position`);
});
