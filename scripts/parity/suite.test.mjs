import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { assertCanonicalHomeProgress, expandKeys, focusForCheck, pinnedCatalogFiles, routeMatches, validateSuite } from "./suite-lib.mjs";
import { resolveCaptureEnvironment } from "./capture-state.mjs";
import { appendCalendarFocusTransition, appendSafeRouteTransition, applyParityLine, calendarCellLeftEdgeAction, calendarFocusTransitionError, calendarReadinessSnapshot, createParityState, hasFreshBrowseFocus, hasFreshCalendarContent, hasFreshCalendarDialogClosure, hasFreshCalendarFocus, hasFreshCalendarView, hasFreshHomeContentFocus, hasFreshProfilesScreen, hasFreshScreenFocus, isActivePlayerResponse, isLaunchErrorBody, parseCalendarContent, parseCalendarDialog, parseCalendarFocus, requestEcp, routeForState as rokuRouteForState, safeRouteSnapshot, sampleBackgroundPixel, spawnSyncBinary, splitDebugFrames, themePixelMatches, validateRunArgs as validateRokuRunArgs } from "./drivers/roku.mjs";
import { artReadiness } from "./roku/art-readiness.mjs";
import { createDriver as createAndroidTvDriver } from "./drivers/android-tv.mjs";

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

test("stable catalog lookup requires explicitly resolved account credentials", async () => {
  assert.deepEqual(await pinnedCatalogFiles(suite, {}), []);
  await assert.rejects(pinnedCatalogFiles(suite, {}, { required: true }), /resolved isolated account credentials/);
  assert.throws(() => resolveCaptureEnvironment("web-capture-10620", {}, {
    PLAYARR_DEVICE_TEST_USERNAME: "shared-user",
    PLAYARR_DEVICE_TEST_PASSWORD: "shared-password",
    PLAYARR_DEVICE_TEST_SERVER_URL: "https://example.com",
  }), /missing client account credentials/);
  const resolved = resolveCaptureEnvironment("web-capture-10620", {}, {
    PLAYARR_PARITY_WEB_CAPTURE_10620_USERNAME: "isolated-user",
    PLAYARR_PARITY_WEB_CAPTURE_10620_PASSWORD: "isolated-password",
    PLAYARR_DEVICE_TEST_SERVER_URL: "https://example.com",
  });
  assert.equal(resolved.PLAYARR_USERNAME, "isolated-user");
  assert.equal(resolved.PLAYARR_SERVER_URL, "https://example.com");
});

test("stable catalog lookup pins available episode files and tolerates episodes without files", async () => {
  const originalFetch = globalThis.fetch;
  const replies = [
    { access_token: "test-token" },
    { media_file_id: "film-file", children: {} },
    { children: { Series: [{ episodes: [{ media_file_id: "episode-file" }, {}, { media_file_id: "another-episode-file" }] }] } },
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => replies.shift() });
  try {
    const files = await pinnedCatalogFiles(suite, {
      PLAYARR_SERVER_URL: "https://example.com",
      PLAYARR_USERNAME: "isolated-user",
      PLAYARR_PASSWORD: "isolated-password",
    }, { required: true });
    assert.deepEqual(files, ["film-file", "episode-file", "another-episode-file"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Home fixture preflight verifies one configured deck row with an approved current identity and performs no writes", async () => {
  const filmFile = "12345678-1234-4234-8234-1234567890ab";
  const calls = [];
  const env = { PLAYARR_SERVER_URL: "https://example.com", PLAYARR_USERNAME: "device-test", PLAYARR_PASSWORD: "secret",
    PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID: filmFile };
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method ?? "GET" });
    if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
    if (path.endsWith("/users/profiles")) return new Response(JSON.stringify([{ username: "device-test", is_current: true }]));
    if (path.endsWith("/playback/progress")) return new Response(JSON.stringify([{ media_file_id: filmFile, state: "part_watched", position_ms: 250, duration_ms: 1000 }]));
    throw new Error("unexpected request");
  };
  const verified = await assertCanonicalHomeProgress(env, fetchImpl);
  assert.deepEqual({ expectedPartWatched: verified.expectedPartWatched, actualPartWatched: verified.actualPartWatched }, { expectedPartWatched: 1, actualPartWatched: 1 });
  assert.match(verified.signature, /^[0-9a-f]{64}$/);
  assert.deepEqual(calls.map(({ path }) => path.split("/").slice(-2).join("/")), ["auth/login", "users/profiles", "playback/progress"]);
  assert.ok(calls.every(({ method }) => method === "GET" || method === "POST"));
});

test("Home fixture preflight rejects extra or missing in-progress rows", async () => {
  const filmFile = "12345678-1234-4234-8234-1234567890ab";
  const extraFile = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const env = { PLAYARR_SERVER_URL: "https://example.com", PLAYARR_USERNAME: "device-test", PLAYARR_PASSWORD: "fixture-pass",
    PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID: filmFile };
  const fetchFor = (rows) => async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
    if (path.endsWith("/users/profiles")) return new Response(JSON.stringify([{ username: "device-test", is_current: true }]));
    if (path.endsWith("/playback/progress")) return new Response(JSON.stringify(rows));
    return new Response(JSON.stringify({ media_file_id: filmFile }));
  };
  await assert.rejects(assertCanonicalHomeProgress(env, fetchFor([
    { media_file_id: filmFile, state: "part_watched", position_ms: 20, duration_ms: 100 }, { media_file_id: extraFile, state: "part_watched", position_ms: 30, duration_ms: 100 },
  ])), /expected 1 canonical part_watched row, found 2/);
  await assert.rejects(assertCanonicalHomeProgress(env, fetchFor([
    { media_file_id: extraFile, state: "part_watched", position_ms: 20, duration_ms: 100 },
  ])), /expected 1 canonical part_watched row, found 1/);
  await assert.rejects(assertCanonicalHomeProgress(env, fetchFor([])), /expected 1 canonical part_watched row, found 0/);
  await assert.rejects(assertCanonicalHomeProgress(env, fetchFor([
    { media_file_id: filmFile, state: "part_watched", position_ms: 20, duration_ms: 100 }, { media_file_id: filmFile, state: "part_watched", position_ms: 20, duration_ms: 100 },
  ])), /progress response schema/);
});

test("Home fixture preflight fails closed on unapproved identity and malformed progress", async () => {
  const filmFile = "12345678-1234-4234-8234-1234567890ab";
  const env = { PLAYARR_SERVER_URL: "https://example.com", PLAYARR_USERNAME: "other-user", PLAYARR_PASSWORD: "fixture-pass",
    PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID: filmFile };
  let calls = 0;
  await assert.rejects(assertCanonicalHomeProgress(env, async () => { calls++; }), /matching a configured Device Test username/);
  assert.equal(calls, 0, "unapproved account is rejected before login");
  const approvedEnv = { ...env, PLAYARR_USERNAME: "device-test" };
  const noCanonicalFile = { ...approvedEnv };
  delete noCanonicalFile.PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID;
  await assert.rejects(assertCanonicalHomeProgress(noCanonicalFile, async () => { calls++; }), /requires PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID/);
  assert.equal(calls, 0, "missing canonical fixture fails before login");
  let progressReadsAfterIdentityFailure = 0;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
    if (path.endsWith("/users/profiles")) return new Response(JSON.stringify([{ username: "different-user", is_current: true }]));
    if (path.endsWith("/playback/progress")) progressReadsAfterIdentityFailure++;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(assertCanonicalHomeProgress(approvedEnv, fetchImpl), /authenticated identity mismatch/);
  assert.equal(progressReadsAfterIdentityFailure, 0, "progress is not read after an identity mismatch");
  const malformedProgress = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
    if (path.endsWith("/users/profiles")) return new Response(JSON.stringify([{ username: "device-test", is_current: true }]));
    if (path.includes("/catalog/")) return new Response(JSON.stringify({ media_file_id: filmFile }));
    return new Response(JSON.stringify([{ media_file_id: filmFile, state: "part_watched", position_ms: "250", duration_ms: 1000 }]));
  };
  await assert.rejects(assertCanonicalHomeProgress(approvedEnv, malformedProgress), /progress response schema/);
  const apiError = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
    if (path.endsWith("/users/profiles")) return new Response(JSON.stringify([{ username: "device-test", is_current: true }]));
    return new Response("unavailable", { status: 503 });
  };
  await assert.rejects(assertCanonicalHomeProgress(approvedEnv, apiError), /progress lookup failed \(503\)/);
});

test("Roku suite driver requires explicit non-player screen and D-pad allowlists", () => {
  assert.equal(validateRokuRunArgs([
    "--only", "screens,dpad", "--via", "route", "--screens", "home,movies",
    "--checks", "home-right,movies-grid-down",
  ]), true);
  assert.equal(validateRokuRunArgs([
    "--only", "screens", "--via", "route", "--screens", "calendar-month,calendar-week,calendar-agenda",
  ]), true);
  assert.throws(() => validateRokuRunArgs(["--only", "screens,dpad"]), /explicit non-player --screens/);
  assert.throws(() => validateRokuRunArgs([
    "--only", "screens", "--screens", "home,player-controls",
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

test("Roku samples a 1x1 pixel from an encoded JPEG after converting to RGB", () => {
  const jpeg = readFileSync(new URL("./fixtures/roku-pixel-probe.jpg", import.meta.url));
  const pixel = sampleBackgroundPixel(jpeg);
  assert.ok(Math.abs(pixel.r - 0x33) <= 12);
  assert.ok(Math.abs(pixel.g - 0x55) <= 12);
  assert.ok(Math.abs(pixel.b - 0x77) <= 12);
});

test("Roku reports only a fresh, observed Calendar view", () => {
  const state = createParityState();
  assert.equal(rokuRouteForState("page", "calendar", "", "", state.calendarView), null);
  const beforeViewSeq = state.calendarViewSeq;
  applyParityLine(state, "PARITY|screen|page");
  applyParityLine(state, "PARITY|page|calendar");
  assert.equal(hasFreshCalendarView(state, "month", beforeViewSeq), false);
  applyParityLine(state, "PARITY|calendarView|month");
  assert.equal(hasFreshCalendarView(state, "month", beforeViewSeq), true);
  assert.equal(rokuRouteForState("page", "calendar", "", "", state.calendarView), "/calendar?view=month");
  const currentViewSeq = state.calendarViewSeq;
  applyParityLine(state, "PARITY|screen|page");
  applyParityLine(state, "PARITY|page|calendar");
  assert.equal(hasFreshCalendarView(state, "month", currentViewSeq), false);
  applyParityLine(state, "PARITY|calendarView|week");
  assert.equal(hasFreshCalendarView(state, "week", currentViewSeq), true);
  assert.equal(rokuRouteForState("page", "calendar", "", "", state.calendarView), "/calendar?view=week");
  assert.equal(rokuRouteForState("page", "calendar", "", "", "agenda"), "/calendar");
});

test("Roku Calendar selection waits for a closed dialog and fresh content-only marker", () => {
  assert.deepEqual(parseCalendarContent("agenda|empty"), { view: "agenda", content: "empty" });
  assert.deepEqual(parseCalendarContent("agenda|entries"), { view: "agenda", content: "entries" });
  assert.deepEqual(parseCalendarContent("week|ready"), { view: "week", content: "ready" });
  assert.equal(parseCalendarContent("agenda|Title of a media item"), null);
  assert.equal(parseCalendarContent("week|entries"), null);
  assert.equal(parseCalendarContent(undefined), null);
  assert.equal(parseCalendarDialog("open"), "open");
  assert.equal(parseCalendarDialog("closed"), "closed");
  assert.equal(parseCalendarDialog("close=true"), null);
  assert.equal(parseCalendarDialog("media title"), null);
  assert.equal(parseCalendarDialog(null), null);

  const state = createParityState();
  applyParityLine(state, "PARITY|screen|page");
  applyParityLine(state, "PARITY|page|calendar");
  const beforeViewSeq = state.calendarViewSeq;
  const beforeContentSeq = state.calendarContentSeq;
  const beforeDialogSeq = state.eventSeq;
  applyParityLine(state, "PARITY|calendarDialog|closed");
  assert.equal(hasFreshCalendarDialogClosure(state, beforeDialogSeq), false);
  applyParityLine(state, "PARITY|calendarView|agenda");
  assert.equal(rokuRouteForState(state.screen, state.page, "", "", state.calendarView), "/calendar");
  assert.equal(hasFreshCalendarView(state, "agenda", beforeViewSeq), true);
  assert.equal(hasFreshCalendarContent(state, "agenda", beforeContentSeq), false);
  assert.equal(hasFreshCalendarDialogClosure(state, beforeDialogSeq), false);

  applyParityLine(state, "PARITY|calendarDialog|open");
  applyParityLine(state, "PARITY|calendarContent|agenda|empty");
  assert.equal(hasFreshCalendarContent(state, "agenda", beforeContentSeq), true);
  assert.equal(hasFreshCalendarDialogClosure(state, beforeDialogSeq), false);
  applyParityLine(state, "PARITY|calendarDialog|open");
  assert.equal(hasFreshCalendarDialogClosure(state, beforeDialogSeq), false);
  applyParityLine(state, "PARITY|calendarDialog|closed");
  assert.equal(hasFreshCalendarDialogClosure(state, beforeDialogSeq), true);
  assert.equal(hasFreshCalendarContent(state, "agenda", beforeContentSeq), true);

  const afterScreen = state.screenSeq;
  applyParityLine(state, "PARITY|screen|home");
  assert.equal(hasFreshCalendarContent(state, "agenda", beforeContentSeq), false);
  assert.equal(hasFreshCalendarDialogClosure(state, beforeDialogSeq), false);
  assert.ok(state.screenSeq > afterScreen);
});

test("Roku Calendar readiness diagnostics identify safe fresh-view, content, and dialog gates", () => {
  const state = createParityState();
  applyParityLine(state, "PARITY|screen|page");
  applyParityLine(state, "PARITY|page|calendar");
  const baseline = {
    viewSeq: state.calendarViewSeq,
    contentSeq: state.calendarContentSeq,
    dialogSeq: state.eventSeq,
  };
  applyParityLine(state, "PARITY|calendarView|week");
  applyParityLine(state, "PARITY|calendarContent|week|ready");
  applyParityLine(state, "PARITY|calendarDialog|open");

  const waiting = calendarReadinessSnapshot(state, "week", baseline);
  assert.equal(waiting.calendarPage, true);
  assert.equal(waiting.view.fresh, true);
  assert.equal(waiting.content.fresh, true);
  assert.deepEqual(waiting.content, {
    expectedView: "week",
    observedView: "week",
    observedState: "ready",
    seq: 4,
    baselineSeq: 0,
    screenSeq: 1,
    afterBaseline: true,
    screenSeqMatches: true,
    fresh: true,
  });
  assert.equal(waiting.dialog.state, "open");
  assert.equal(waiting.dialog.openAfterBaseline, true);
  assert.equal(waiting.dialog.closedAfterOpen, false);
  assert.equal(waiting.dialog.openScreenSeqMatches, true);
  assert.equal(waiting.dialog.freshClosure, false);

  applyParityLine(state, "PARITY|calendarDialog|closed");
  const ready = calendarReadinessSnapshot(state, "week", baseline);
  assert.equal(ready.dialog.state, "closed");
  assert.equal(ready.dialog.openAfterBaseline, true);
  assert.equal(ready.dialog.closedAfterOpen, true);
  assert.equal(ready.dialog.closedScreenSeqMatches, true);
  assert.equal(ready.dialog.freshClosure, true);

  const unsafeState = {
    ...state,
    calendarView: "private title",
    calendarContent: { view: "media name", content: "raw console" },
    calendarDialogState: "dialog title",
  };
  const safe = calendarReadinessSnapshot(unsafeState, "private title", baseline);
  assert.equal(safe.targetView, "");
  assert.equal(safe.view.observed, "");
  assert.equal(safe.content.observedView, "");
  assert.equal(safe.content.observedState, "");
  assert.equal(safe.dialog.state, "");
  assert.doesNotMatch(JSON.stringify(safe), /private title|media name|raw console|dialog title/i);
});

test("Roku Calendar route follows fresh focus as data replaces the initial Back control", () => {
  const state = createParityState();
  const beforeScreenSeq = state.screenSeq;
  const beforeFocusSeq = state.calendarFocusSeq;
  applyParityLine(state, "PARITY|screen|page");
  applyParityLine(state, "PARITY|page|calendar");
  applyParityLine(state, "PARITY|calendarFocus|back|153,56.3,50,50");
  assert.equal(hasFreshCalendarFocus(state, beforeScreenSeq, beforeFocusSeq), true);
  assert.deepEqual(state.calendarFocusRect, { x: 153, y: 56.3, w: 50, h: 50 });
  const back = { action: state.calendarFocus, rect: state.calendarFocusRect };
  applyParityLine(state, "PARITY|calendarFocus|cell|310,200,120,44");
  const firstCell = { action: state.calendarFocus, rect: state.calendarFocusRect };
  assert.equal(calendarFocusTransitionError(firstCell, "up", back), null);
  assert.deepEqual(firstCell.rect, { x: 310, y: 200, w: 120, h: 44 });
  assert.equal(calendarFocusTransitionError(back, "right", firstCell), null);
  applyParityLine(state, "PARITY|calendarFocus|calPrev|1629,56.2,50,50");
  applyParityLine(state, "PARITY|calendarFocus|calView|1000,56.2,100,48");
  const viewSelector = { action: state.calendarFocus, rect: state.calendarFocusRect };
  const rightCell = { action: "cell", rect: { x: 300, y: 200, w: 180, h: 120 } };
  const leftCell = { action: "cell", rect: { x: 100, y: 200, w: 180, h: 120 } };
  const aboveCell = { action: "cell", rect: { x: 300, y: 50, w: 180, h: 120 } };
  const wrongRowCell = { action: "cell", rect: { x: 100, y: 50, w: 180, h: 120 } };
  const unchangedCell = { action: "cell", rect: { x: 300, y: 200, w: 180, h: 120 } };
  const nextCell = { action: "cell", rect: { x: 500, y: 200, w: 180, h: 120 } };
  assert.equal(calendarFocusTransitionError(rightCell, "left", leftCell), null);
  assert.equal(calendarFocusTransitionError(rightCell, "left", wrongRowCell), "calendar-left-did-not-move-to-an-earlier-cell-in-the-same-row");
  assert.equal(calendarFocusTransitionError(rightCell, "up", aboveCell), null);
  assert.equal(calendarFocusTransitionError(rightCell, "up", unchangedCell), "calendar-up-did-not-move-to-an-earlier-row");
  assert.equal(calendarFocusTransitionError(rightCell, "right", nextCell), null);
  assert.equal(calendarFocusTransitionError(rightCell, "right", wrongRowCell), "calendar-right-did-not-move-to-a-later-cell-in-the-same-row");
  assert.equal(calendarFocusTransitionError(rightCell, "right", unchangedCell), "calendar-right-did-not-move-to-a-later-cell-in-the-same-row");
  assert.equal(calendarCellLeftEdgeAction({ action: "cell", rect: { x: 154, y: 200, w: 180, h: 120 } }), "edge");
  assert.equal(calendarCellLeftEdgeAction({ action: "cell", rect: { x: 155, y: 200, w: 180, h: 120 } }), "edge");
  assert.equal(calendarCellLeftEdgeAction({ action: "cell", rect: { x: 392.4, y: 200, w: 180, h: 120 } }), "left");
  assert.equal(calendarCellLeftEdgeAction({ action: "cell", rect: { x: 153, y: 200, w: 180, h: 120 } }), "unknown");
  assert.equal(calendarCellLeftEdgeAction({ action: "back", rect: { x: 153, y: 56, w: 50, h: 50 } }), "unknown");
  assert.equal(calendarCellLeftEdgeAction({ action: "cell", rect: null }), "unknown");
  const wrongHeaderToRight = { action: "calPrev", rect: { x: 1200, y: 50, w: 60, h: 50 } };
  assert.equal(calendarFocusTransitionError(viewSelector, "left", wrongHeaderToRight), "calendar-header-left-did-not-move-left");
  assert.equal(applyParityLine(state, "PARITY|calendarFocus|entry|media title"), false);
});

test("Roku Calendar focus telemetry accepts only safe actions and bounded rectangles", () => {
  assert.deepEqual(parseCalendarFocus("calView|1000,56.2,120,48"), {
    action: "calView", rect: { x: 1000, y: 56.2, w: 120, h: 48 },
  });
  for (const invalid of [
    "entry|media title,56,100,40", "calView|NaN,56,120,48", "calView|99999,56,120,48",
    "unknown|10,20,30,40", "calView|10,20,0,40", "calView|10,20,30,-1",
  ]) assert.equal(parseCalendarFocus(invalid), null);
  const state = createParityState();
  assert.equal(applyParityLine(state, "PARITY|calendarFocus|calView|10,20,0,40"), false);
  assert.equal(state.calendarFocus, "");
});

test("Roku Calendar focus trail is sanitised and bounded", () => {
  const trace = [];
  const focus = (action, x) => ({ action, rect: { x, y: 20, w: 40, h: 40 } });
  for (let index = 0; index < 5; index += 1) {
    appendCalendarFocusTransition(trace, focus("cell", index), "up", focus("calView", index + 1), 3);
  }
  assert.equal(trace.length, 3);
  assert.equal(trace[0].from.rect.x, 2);
  assert.equal(JSON.stringify(trace).includes("private media label"), false);
  appendCalendarFocusTransition(trace, { action: "entry", label: "private media label", rect: focus("cell", 0).rect }, "up", focus("calView", 1), 3);
  assert.equal(trace.length, 3);
  assert.equal(JSON.stringify(trace).includes("private media label"), false);
});

test("Roku controlled route snapshots keep only allowlisted states and numeric focus position", () => {
  const snapshot = safeRouteSnapshot({
    screen: "browse", browse: "movies", drawerSource: "filters",
    focus: { label: "Private movie title", position: { rail: 0, index: 12 } },
  });
  assert.deepEqual(snapshot, { screen: "browse", browse: "movie", position: { rail: 0, index: 12 } });
  assert.equal(JSON.stringify(snapshot).includes("Private movie title"), false);
  assert.deepEqual(safeRouteSnapshot({ screen: "drawer", browse: "movie", drawerSource: "filters", focus: "Private title" }), {
    screen: "drawer", browse: "movie", drawer: "filters",
  });
  assert.equal(safeRouteSnapshot({ screen: "unsupported", browse: "movie", focus: "Private title" }), null);
  assert.deepEqual(safeRouteSnapshot({ screen: "browse", browse: "private media", focus: { position: { rail: -1, index: 1 } } }), {
    screen: "browse",
  });
});

test("Roku controlled route trail is bounded and excludes focus labels", () => {
  const trace = [];
  const from = { screen: "home", focus: { label: "Private home item", position: { rail: 0, index: 0 } } };
  const to = { screen: "browse", browse: "movie", focus: { label: "Private movie title", position: { rail: 0, index: 1 } } };
  for (let index = 0; index < 40; index += 1) appendSafeRouteTransition(trace, from, "down", to, 100);
  assert.equal(trace.length, 32);
  assert.deepEqual(trace[0].from, { screen: "home", position: { rail: 0, index: 0 } });
  assert.deepEqual(trace.at(-1).to, { screen: "browse", browse: "movie", position: { rail: 0, index: 1 } });
  assert.equal(JSON.stringify(trace).includes("Private"), false);
  appendSafeRouteTransition(trace, from, "launch", to);
  assert.equal(trace.length, 32);
});

test("Roku requires fresh Movies grid focus before the Filters route", () => {
  const state = createParityState();
  applyParityLine(state, "PARITY|screen|browse");
  applyParityLine(state, "PARITY|browse|movie");
  assert.equal(hasFreshBrowseFocus(state, "movie", 0, 0), false);
  applyParityLine(state, "PARITY|focus|first card");
  assert.equal(hasFreshBrowseFocus(state, "movie", 0, 0), true);
  assert.equal(hasFreshBrowseFocus(state, "series", 0, 0), false);
});

test("Roku Series route marks a fresh art-readiness boundary", () => {
  const state = createParityState();
  applyParityLine(state, "PARITY|browse|series");
  assert.equal(state.artMarkers.series, state.eventSeq);
  assert.equal(state.artMarkers.movies, 0);
});

test("Roku launch response guard detects HTTP-200 ECP error bodies", () => {
  assert.equal(isLaunchErrorBody(""), false);
  assert.equal(isLaunchErrorBody("OK"), false);
  assert.equal(isLaunchErrorBody('<error>App not found</error>'), true);
  assert.equal(isLaunchErrorBody("Unable to launch developer app"), true);
  assert.equal(isLaunchErrorBody('{"error":"not found"}'), true);
});

test("Roku debug stream keeps partial frames bounded and rejects oversized frames", () => {
  assert.deepEqual(splitDebugFrames("PARITY|screen|home", "\npartial"), {
    frames: ["PARITY|screen|home"], remainder: "partial", overflow: false,
  });
  assert.deepEqual(splitDebugFrames("", "x".repeat(16 * 1024 + 1)), {
    frames: [], remainder: "", overflow: true,
  });
  assert.deepEqual(splitDebugFrames("", `${"x".repeat(16 * 1024 + 1)}\n`), {
    frames: [], remainder: "", overflow: true,
  });
});

test("Roku PARITY ingest records fresh screen and focus from CRLF events", () => {
  const state = createParityState();
  assert.equal(applyParityLine(state, "PARITY|screen|profiles\r"), true);
  assert.equal(applyParityLine(state, "PARITY|focus|Device Test\r"), true);
  assert.equal(applyParityLine(state, "unrelated console output\r"), false);
  assert.equal(state.screen, "profiles");
  assert.equal(state.screenSeq, 1);
  assert.equal(state.focus, "Device Test");
  assert.equal(state.focusSeq, 1);
  assert.equal(state.focusScreenSeq, state.screenSeq);
  assert.equal(hasFreshScreenFocus(state, "profiles", "Device Test", 0, 0), true);
});

test("Roku artwork readiness gates a fresh current population with explicit empty slots", () => {
  const state = createParityState();
  applyParityLine(state, "PARITY|screen|home");
  const marker = state.artMarkers.home;
  applyParityLine(state, "PARITY|art|slot|1|home|home-r0-c0|1|881.6|464|327|184|0");
  applyParityLine(state, "PARITY|art|status|1|home|home-r0-c0|ready|0");
  applyParityLine(state, "PARITY|art|slot|1|home|home-r0-c1|0|1233.6|464|327|184|0");
  applyParityLine(state, "PARITY|art|status|1|home|home-r0-c1|empty|0");
  applyParityLine(state, "PARITY|art|begin|1|home|1|2");
  applyParityLine(state, "PARITY|art|finish|1|home");
  const generation = state.artState.generations.get("home:1");
  assert.deepEqual(artReadiness(generation, { scope: "home", afterSeq: marker }), { ready: true, reason: "ready" });
  assert.equal(artReadiness(generation, { scope: "home", afterSeq: generation.beginSeq }).reason, "no-fresh-generation");
});

test("Roku Movies readiness does not treat a recoverable retry as terminal failure", () => {
  const state = createParityState();
  applyParityLine(state, "PARITY|browse|movie");
  const marker = state.artMarkers.movies;
  applyParityLine(state, "PARITY|art|slot|3|movies|movies-r0-c0|1|783.4|162|327.2|184.4|0");
  applyParityLine(state, "PARITY|art|status|3|movies|movies-r0-c0|pending|0");
  applyParityLine(state, "PARITY|art|begin|3|movies|1|1");
  applyParityLine(state, "PARITY|art|finish|3|movies");
  const generation = state.artState.generations.get("movies:3");
  assert.equal(artReadiness(generation, { scope: "movies", afterSeq: marker }).reason, "art-pending");
  applyParityLine(state, "PARITY|art|status|3|movies|movies-r0-c0|ready|0");
  assert.deepEqual(artReadiness(generation, { scope: "movies", afterSeq: marker }), { ready: true, reason: "ready" });
});

test("Roku waits through transient pairing until a fresh Profiles screen arrives", () => {
  assert.equal(hasFreshProfilesScreen({ screen: "pairing", screenSeq: 4 }, 3), false);
  assert.equal(hasFreshProfilesScreen({ screen: "profiles", screenSeq: 5 }, 3), true);
  assert.equal(hasFreshProfilesScreen({ screen: "profiles", screenSeq: 3 }, 3), false);
});

test("Roku waits for fresh positioned Home content focus, not the Home shell or nav focus", () => {
  const state = {
    ...createParityState(),
    screen: "home",
    screenSeq: 6,
    focus: { label: "Item", position: { rail: 0, index: 0 } },
    focusSeq: 14,
    focusScreenSeq: 6,
  };
  assert.equal(hasFreshHomeContentFocus(state, 5, 13), true);
  assert.equal(hasFreshHomeContentFocus({ ...state, focus: "Home" }, 5, 13), false);
  assert.equal(hasFreshHomeContentFocus({ ...state, focusScreenSeq: 5 }, 5, 13), false);
  assert.equal(hasFreshHomeContentFocus({ ...state, focusSeq: 13 }, 5, 13), false);
  assert.equal(hasFreshHomeContentFocus({ ...state, focus: { label: "Item", position: { rail: -1, index: 0 } } }, 5, 13), false);
});

test("Roku ECP requests close the connection and never retry ambiguous transport failures", async () => {
  let calls = 0;
  let requestOptions;
  const response = await requestEcp("http://example.invalid:8060/launch/dev", "POST", async (_url, options) => {
    calls += 1;
    requestOptions = options;
    return { ok: true };
  });
  assert.equal(response.ok, true);
  assert.equal(calls, 1);
  assert.equal(requestOptions.headers.connection, "close");

  await assert.rejects(
    requestEcp("http://example.invalid:8060/launch/dev", "POST", async () => {
      calls += 1;
      throw new Error("UND_ERR_SOCKET private transport details");
    }),
    { message: "Roku ECP transport failed; no automatic retry was attempted and the device outcome may be unknown" },
  );
  assert.equal(calls, 2);
});

test("Roku binary subprocess helper accepts string stdin and returns Buffer stdout", () => {
  const result = spawnSyncBinary(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
    input: "curl-config",
    timeout: 5000,
    maxBuffer: 4096,
    stdio: ["pipe", "pipe", "ignore"],
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.ok(Buffer.isBuffer(result.stdout));
  assert.equal(result.stdout.toString("utf8"), "curl-config");
});

test("Roku suite driver refuses to interrupt an active media session", () => {
  assert.equal(isActivePlayerResponse('<player state="close" error="false"/>'), false);
  assert.equal(isActivePlayerResponse('<player state="play" error="false"/>'), true);
  assert.equal(isActivePlayerResponse('<player state="pause" error="false"/>'), true);
  assert.equal(isActivePlayerResponse("<query/>"), true);
});

test("Android TV driver bounds a hung uiautomator command", async () => {
  const fakeAdb = new URL("./test-drivers/fake-adb.mjs", import.meta.url).pathname;
  const hangVariable = "PLAYARR_PARITY_FAKE_ADB_HANG";
  const previous = process.env[hangVariable];
  process.env[hangVariable] = "uiautomator";
  try {
    const driver = createAndroidTvDriver({ adbBin: fakeAdb, commandTimeoutMs: 300 });
    await assert.rejects(driver.screenshot("/dev/null"), /adb shell uiautomator timed out after 300ms/);
  } finally {
    if (previous === undefined) delete process.env[hangVariable];
    else process.env[hangVariable] = previous;
  }
});

test("Android TV driver bounds a hung screencap after a ready UI tree", async () => {
  const fakeAdb = new URL("./test-drivers/fake-adb.mjs", import.meta.url).pathname;
  const hangVariable = "PLAYARR_PARITY_FAKE_ADB_HANG";
  const displayVariable = "PARITY_XDISPLAY";
  const previousHang = process.env[hangVariable], previousDisplay = process.env[displayVariable];
  process.env[hangVariable] = "screencap";
  delete process.env[displayVariable];
  try {
    const driver = createAndroidTvDriver({ adbBin: fakeAdb, commandTimeoutMs: 300 });
    await assert.rejects(driver.screenshot("/dev/null"), /adb exec-out screencap timed out after 300ms/);
  } finally {
    if (previousHang === undefined) delete process.env[hangVariable];
    else process.env[hangVariable] = previousHang;
    if (previousDisplay === undefined) delete process.env[displayVariable];
    else process.env[displayVariable] = previousDisplay;
  }
});

test("Android TV driver fails when screen focus never becomes ready", async () => {
  const fakeAdb = new URL("./test-drivers/fake-adb.mjs", import.meta.url).pathname;
  let fake = 0; // fake clock: sleeping advances time instantly, so the deadline logic is deterministic
  const clock = { now: () => fake, sleep: async (ms) => { fake += ms; } };
  const driver = createAndroidTvDriver({ adbBin: fakeAdb, commandTimeoutMs: 5000, readinessTimeoutMs: 600, readinessPollMs: 25, clock });
  const noFocusVariable = "PLAYARR_PARITY_FAKE_ADB_NO_FOCUS";
  const previous = process.env[noFocusVariable];
  process.env[noFocusVariable] = "1";
  try {
    await assert.rejects(driver.home(), /screen readiness timed out after 600ms/);
  } finally {
    if (previous === undefined) delete process.env[noFocusVariable];
    else process.env[noFocusVariable] = previous;
  }
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
    assert.equal(scored.status, 1, scored.stderr || scored.stdout);
    assert.match(scored.stdout, /failed D-pad checks 1: player-ok-toggle/);
    const result = JSON.parse(readFileSync(join(out, "dpad.json"), "utf8"));
    assert.equal(result.results.find((x) => x.id === "player-ok-toggle").pass, false);

    const roleOnly = run("role", ["--expected", join(out, "expected.json")]);
    assert.equal(roleOnly.status, 1, roleOnly.stderr || roleOnly.stdout);
    assert.match(roleOnly.stdout, /failed D-pad checks 1: player-ok-toggle/);
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

test("non-stable suite capture skips stable-only driver methods and writes screens and D-pad results", () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  assert.ok(testRoot, "PLAYARR_PARITY_TEST_OUT must be set by test:suite");
  const base = join(testRoot, `suite-nonstable-${process.pid}-${Date.now()}`);
  const driver = join(base, "driver.mjs");
  const out = join(base, "out");
  mkdirSync(base, { recursive: true });
  writeFileSync(driver, `import { writeFileSync } from "node:fs";
export async function createDriver() {
  let route = "/";
  return {
    async home() { route = "/"; },
    async route(path) { route = path.replace(":id", "fixture"); },
    async location() { return route; },
    async setTheme() {},
    async key() {},
    async focused() { return { label: "fixture", position: { rail: 0, index: 0 } }; },
    async screenshot(file) { writeFileSync(file, Buffer.from("fixture image")); },
    async waitReady() { throw new Error("unexpected waitReady"); },
    async setDeterministicCapture() { throw new Error("unexpected stable setup"); },
    async captureBuildIdentity() { throw new Error("unexpected build identity read"); },
  };
}\n`);
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  const expected = new URL("./expected.web.json", import.meta.url).pathname;
  const env = { ...process.env };
  for (const name of ["PARITY_STABLE", "PARITY_CLIENT", "PARITY_ACCOUNT", "PARITY_PLAYBACK_PHASE_FILE", "PLAYARR_PLAYBACK_PHASE_FILE", "PARITY_FIXED_NOW"]) delete env[name];
  const result = spawnSync(process.execPath, [runner, "--driver", driver, "--out", out, "--only", "screens,dpad", "--screens", "home", "--checks", "home-right", "--expected", expected], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(out, "dark", "home.png")));
  assert.ok(existsSync(join(out, "dpad.json")));
  const scored = JSON.parse(readFileSync(join(out, "dpad.json"), "utf8"));
  assert.equal(scored.provenance.stable, false);
  assert.equal(scored.provenance.clock, "unpinned");
  assert.match(scored.provenance.referenceSha256, /^[a-f0-9]{64}$/);
});

test("screens-only runner never invokes download cleanup, even when cleanup throws", () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  assert.ok(testRoot, "PLAYARR_PARITY_TEST_OUT must be set by test:suite");
  const base = join(testRoot, `suite-screens-cleanup-${process.pid}-${Date.now()}`);
  const driver = join(base, "driver.mjs");
  const preload = join(base, "fetch.mjs");
  const home = join(base, "home");
  const out = join(base, "out");
  const marker = join(base, "cleanup-called");
  const networkMarker = join(base, "catalog-requested");
  mkdirSync(base, { recursive: true });
  mkdirSync(home, { recursive: true });
  const secrets = "PLAYARR_PARITY_FIXTURE=unchanged\n";
  writeFileSync(join(home, ".secrets"), secrets);
  writeFileSync(driver, `import { writeFileSync } from "node:fs";
export async function createDriver() { let route = "/"; return {
  async home() { route = "/"; }, async route(path) { route = path.replace(":id", "fixture"); },
  async location() { return route; }, async setTheme() {}, async screenshot(file) { writeFileSync(file, "fixture"); },
  async cleanupDownloads() { writeFileSync(${JSON.stringify(marker)}, "called"); throw new Error("cleanup failure"); },
}; }
`);
  writeFileSync(preload, `import { writeFileSync } from "node:fs";
globalThis.fetch = async () => { writeFileSync(${JSON.stringify(networkMarker)}, "called"); throw new Error("unexpected legacy catalog request"); };
`);
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  const env = { ...process.env };
  for (const name of ["PARITY_STABLE", "PARITY_CLIENT", "PARITY_ACCOUNT", "PLAYARR_PLAYBACK_PHASE_FILE"]) delete env[name];
  const result = spawnSync(process.execPath, ["--import", preload, runner, "--driver", driver, "--out", out, "--only", "screens", "--screens", "home"], { encoding: "utf8", env: { ...env, HOME: home, PLAYARR_SERVER_URL: "http://localhost", PLAYARR_USERNAME: "fixture-user", PLAYARR_PASSWORD: "fixture-pass" } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(networkMarker), false);
  assert.equal(readFileSync(join(home, ".secrets"), "utf8"), secrets);
  assert.deepEqual(readdirSync(home), [".secrets"]);
});

test("interrupted offline-play drains its download and does not reset or publish results", async () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  assert.ok(testRoot, "PLAYARR_PARITY_TEST_OUT must be set by test:suite");
  const base = join(testRoot, `suite-interrupt-download-${process.pid}-${Date.now()}`);
  const driver = join(base, "driver.mjs");
  const preload = join(base, "fetch.mjs");
  const out = join(base, "out");
  const marker = join(base, "download-started");
  const putCount = join(base, "progress-put-count");
  mkdirSync(base, { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(driver, `import { writeFileSync } from "node:fs";
export async function createDriver() { let finishDownload; const keepAlive = setInterval(() => {}, 1000); return {
  supports: { downloads: true },
  async download() { writeFileSync(${JSON.stringify(marker)}, "started"); console.log("READY"); await new Promise((resolve) => { finishDownload = resolve; }); return { state: "ok", detail: "fixture" }; },
  async stop() { clearInterval(keepAlive); finishDownload?.(); },
}; }
`);
  writeFileSync(preload, `import { writeFileSync, readFileSync } from "node:fs";
const countFile = process.env.PARITY_TEST_PUT_COUNT;
let catalogCount = 0;
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "fixture-token" }));
  if (path.startsWith("/api/v1/catalog/")) { catalogCount++; return catalogCount === 1 ? new Response(JSON.stringify({ media_file_id: "11111111-1111-4111-8111-111111111111" })) : new Response(JSON.stringify({ children: { Series: [{ episodes: [{ media_file_id: "22222222-2222-4222-8222-222222222222" }] }] } })); }
  if (path.includes("/media/") && path.endsWith("/metadata")) return new Response(JSON.stringify({ duration_ms: 1000 }));
  if (path.endsWith("/progress") && options.method === "PUT") { const n = Number(readFileSync(countFile, "utf8")) + 1; writeFileSync(countFile, String(n)); return new Response("{}"); }
  if (path.endsWith("/playback/progress")) return new Response("[]");
  return new Response("{}");
};
`);
  writeFileSync(putCount, "0");
  writeFileSync(join(out, "downloads.json"), "preserve-download-results");
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  const env = { ...process.env, PLAYARR_SERVER_URL: "http://localhost", PLAYARR_USERNAME: "fixture-user", PLAYARR_PASSWORD: "fixture-pass", PARITY_TEST_PUT_COUNT: putCount };
  for (const name of ["PARITY_STABLE", "PARITY_CLIENT", "PARITY_ACCOUNT", "PLAYARR_PLAYBACK_PHASE_FILE"]) delete env[name];
  const child = spawn(process.execPath, ["--import", preload, runner, "--driver", driver, "--out", out, "--only", "downloads", "--cases", "offline-play", "--reset-progress"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  const closed = once(child, "close");
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`download did not start; stdout: ${stdout}; stderr: ${stderr}`)), 10_000);
      const onData = (chunk) => { if ((stdout + chunk).includes("READY")) { clearTimeout(timeout); child.stdout.off("data", onData); resolve(); } };
      child.stdout.on("data", onData);
    });
    assert.ok(existsSync(marker));
    const beforeSignal = readFileSync(putCount, "utf8");
    child.kill("SIGINT");
    const [code] = await closed;
    assert.equal(code, 130, `unexpected status; stdout: ${stdout}; stderr: ${stderr}`);
    assert.equal(readFileSync(putCount, "utf8"), beforeSignal, "offline-play reset ran after interruption");
    assert.equal(readFileSync(join(out, "downloads.json"), "utf8"), "preserve-download-results");
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

test("download cleanup errors stay non-fatal after a download starts", () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  assert.ok(testRoot, "PLAYARR_PARITY_TEST_OUT must be set by test:suite");
  const base = join(testRoot, `suite-download-cleanup-error-${process.pid}-${Date.now()}`);
  const driver = join(base, "driver.mjs");
  const out = join(base, "out");
  const marker = join(base, "cleanup-called");
  mkdirSync(base, { recursive: true });
  writeFileSync(driver, `import { writeFileSync } from "node:fs";
export async function createDriver() { return { supports: { downloads: true }, async download() { return { state: "ok" }; }, async cleanupDownloads() { writeFileSync(${JSON.stringify(marker)}, "called"); throw new Error("fixture cleanup failure"); } }; }
`);
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [runner, "--driver", driver, "--out", out, "--only", "downloads", "--cases", "offline-play"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(marker, "utf8"), "called");
  assert.equal(JSON.parse(readFileSync(join(out, "downloads.json"), "utf8")).results[0].state, "ok");
});

test("interrupted performance waits for the in-flight result and preserves performance.json", async () => {
  const testRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  assert.ok(testRoot, "PLAYARR_PARITY_TEST_OUT must be set by test:suite");
  const base = join(testRoot, `suite-interrupt-performance-${process.pid}-${Date.now()}`);
  const driver = join(base, "driver.mjs");
  const out = join(base, "out");
  const marker = join(base, "play-started");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "performance.json"), "preserve-performance-results");
  writeFileSync(driver, `import { writeFileSync } from "node:fs";
export async function createDriver() { let finishPlay; const keepAlive = setInterval(() => {}, 1000); return { async play() { writeFileSync(${JSON.stringify(marker)}, "started"); console.log("READY"); await new Promise((resolve) => { finishPlay = resolve; }); return { state: "ok", advancedSeconds: 30, startSeconds: 0 }; }, async stop() { clearInterval(keepAlive); finishPlay?.(); } }; }
`);
  const runner = new URL("./suite-run.mjs", import.meta.url).pathname;
  const env = { ...process.env };
  for (const name of ["PARITY_STABLE", "PARITY_CLIENT", "PARITY_ACCOUNT", "PLAYARR_PLAYBACK_PHASE_FILE"]) delete env[name];
  const child = spawn(process.execPath, [runner, "--driver", driver, "--out", out, "--only", "performance", "--reference"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  const closed = once(child, "close");
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`play did not start; stdout: ${stdout}; stderr: ${stderr}`)), 10_000);
      const onData = (chunk) => { if ((stdout + chunk).includes("READY")) { clearTimeout(timeout); child.stdout.off("data", onData); resolve(); } };
      child.stdout.on("data", onData);
    });
    assert.ok(existsSync(marker));
    child.kill("SIGINT");
    const [code] = await closed;
    assert.equal(code, 130, `unexpected status; stdout: ${stdout}; stderr: ${stderr}`);
    assert.equal(readFileSync(join(out, "performance.json"), "utf8"), "preserve-performance-results");
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

test("committed web expected.json covers every D-pad check, never null", () => {
  const exp = JSON.parse(readFileSync(new URL("./expected.web.json", import.meta.url), "utf8"));
  for (const d of suite.dpad) assert.ok(exp.dpad[d.id], `${d.id} has an expected value`);
  for (const d of suite.dpad.filter((x) => x.compare === "position")) assert.ok(exp.dpad[d.id].position, `${d.id} has a position`);
});
