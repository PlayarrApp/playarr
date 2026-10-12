import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expandKeys, focusForCheck, routeMatches, validateSuite } from "./suite-lib.mjs";
import { hasFreshScreenFocus, isActivePlayerResponse, isLaunchErrorBody, routeForState as rokuRouteForState, themePixelMatches, validateRunArgs as validateRokuRunArgs } from "./drivers/roku.mjs";

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

test("Roku suite driver requires explicit non-player screen and D-pad allowlists", () => {
  assert.equal(validateRokuRunArgs([
    "--only", "screens,dpad", "--via", "route", "--screens", "home,movies",
    "--checks", "home-right,movies-grid-down",
  ]), true);
  assert.throws(() => validateRokuRunArgs(["--only", "screens,dpad"]), /explicit non-player --screens/);
  assert.throws(() => validateRokuRunArgs([
    "--only", "screens", "--screens", "home,player-controls",
  ]), /refuses unsupported screen/);
  assert.throws(() => validateRokuRunArgs([
    "--only", "screens", "--via", "route", "--screens", "calendar-month",
  ]), /refuses unsupported screen/);
  assert.throws(() => validateRokuRunArgs([
    "--only", "dpad", "--checks", "home-right,player-right",
  ]), /refuses unsupported D-pad check/);
  assert.throws(() => validateRokuRunArgs(["--only", "downloads"]), /downloads and performance are unsupported/);
});

test("Roku profile launch accepts only a fresh profile screen and its subsequent focus event", () => {
  const state = { screen: "profiles", screenSeq: 8, focus: "Device Test", focusSeq: 13, focusScreenSeq: 8 };
  assert.equal(hasFreshScreenFocus(state, "profiles", "Device Test", 7, 12), true);
  assert.equal(hasFreshScreenFocus({ ...state, screenSeq: 7, focusScreenSeq: 7 }, "profiles", "Device Test", 7, 12), false);
  assert.equal(hasFreshScreenFocus({ ...state, focusSeq: 12 }, "profiles", "Device Test", 7, 12), false);
  assert.equal(hasFreshScreenFocus({ ...state, focusScreenSeq: 7 }, "profiles", "Device Test", 7, 12), false);
  assert.equal(hasFreshScreenFocus({ ...state, focus: "Clients" }, "profiles", "Device Test", 7, 12), false);
});

test("Roku theme verification distinguishes measured light and dark background pixels", () => {
  assert.equal(themePixelMatches({ r: 26, g: 24, b: 27 }, "dark"), true);
  assert.equal(themePixelMatches({ r: 251, g: 250, b: 248 }, "light"), true);
  assert.equal(themePixelMatches({ r: 251, g: 250, b: 248 }, "dark"), false);
  assert.equal(themePixelMatches({ r: 26, g: 24, b: 27 }, "light"), false);
  assert.equal(themePixelMatches(null, "dark"), false);
});

test("Roku does not report a calendar view it cannot observe", () => {
  assert.equal(rokuRouteForState("page", "calendar", "", ""), null);
});

test("Roku launch response guard detects HTTP-200 ECP error bodies", () => {
  assert.equal(isLaunchErrorBody(""), false);
  assert.equal(isLaunchErrorBody("OK"), false);
  assert.equal(isLaunchErrorBody('<error>App not found</error>'), true);
  assert.equal(isLaunchErrorBody("Unable to launch developer app"), true);
  assert.equal(isLaunchErrorBody('{"error":"not found"}'), true);
});

test("Roku suite driver refuses to interrupt an active media session", () => {
  assert.equal(isActivePlayerResponse('<player state="close" error="false"/>'), false);
  assert.equal(isActivePlayerResponse('<player state="play" error="false"/>'), true);
  assert.equal(isActivePlayerResponse('<player state="pause" error="false"/>'), true);
  assert.equal(isActivePlayerResponse("<query/>"), true);
});

test("focus-order checks keep play/pause role semantics while toggle checks keep state", () => {
  assert.equal(focusForCheck("Pause", "player-left-edge").label, "play-pause");
  assert.equal(focusForCheck("Play", "player-left-edge").label, "play-pause");
  assert.equal(focusForCheck("Pause", "player-ok-toggle").label, "pause");
  assert.equal(focusForCheck("Play", "player-ok-toggle").label, "play");
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
