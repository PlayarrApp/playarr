import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { accountProbeResult, directPlayerProbeResult, expectedLibraryKind, focusCaptureSidecar, hasDirectPlayMediaId, libraryFocusReady, libraryFocusSummary, playerCaptureProbeResult, playerCaptureSummary, themeCaptureAllowed } from "./driver.mjs";

test("Xbox account probe ignores missing, stale, and racing traces", () => {
  const nonce = "fresh-probe";
  assert.equal(accountProbeResult(null, nonce), "pending");
  assert.equal(accountProbeResult({}, nonce), "pending");
  assert.equal(accountProbeResult({ accountProbe: "old-probe", accountMatchesTest: true }, nonce), "pending");
  assert.equal(accountProbeResult({ accountProbe: nonce, accountMatchesTest: false }, nonce), "mismatch");
  assert.equal(accountProbeResult({ accountProbe: nonce, accountMatchesTest: true }, nonce), "match");
});

test("explicit direct-play media ID is required and validated", () => {
  assert.equal(hasDirectPlayMediaId(""), false);
  assert.equal(hasDirectPlayMediaId("invalid"), false);
  assert.equal(hasDirectPlayMediaId("00000000-0000-4000-8000-000000000000"), true);
});

test("Xbox player probe requires a fresh matching request and Direct negotiation", () => {
  const nonce = "8c65df2e-3236-4ff9-8682-98a589a1efda";
  assert.equal(directPlayerProbeResult(null, nonce), "pending");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: "stale", playerFixture: "direct-preflight", screen: "playback", playerMode: "direct" }, nonce), "pending");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "fixture-unavailable" }, nonce), "unavailable");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "fixture-http-401" }, nonce), "fixture-http-401");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "fixture-http-503" }, nonce), "fixture-http-503");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "fixture-transport" }, nonce), "fixture-transport");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "fixture-unexpected-error" }, nonce), "fixture-unexpected-error");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "not-direct" }, nonce), "not-direct");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "direct-preflight", screen: "playback", playerMode: "hls" }, nonce), "not-direct");
  assert.equal(directPlayerProbeResult({ playerFixtureNonce: nonce, playerFixture: "direct-preflight", screen: "playback", playerMode: "direct" }, nonce), "ready");
});

test("player capture gate requires the matching Direct request paused at the canonical position", () => {
  const nonce = "fresh-player-request";
  const ready = { playerFixtureNonce: nonce, playerFixture: "direct-preflight", screen: "playback", playerMode: "direct", play: "paused", pos: 2 };
  assert.equal(playerCaptureProbeResult(null, nonce), "pending");
  assert.equal(playerCaptureProbeResult({ ...ready, playerFixtureNonce: "stale" }, nonce), "pending");
  assert.equal(playerCaptureProbeResult({ ...ready, playerMode: "hls" }, nonce), "pending");
  assert.equal(playerCaptureProbeResult({ ...ready, play: "playing" }, nonce), "pending");
  assert.equal(playerCaptureProbeResult({ ...ready, pos: "not-a-number" }, nonce), "pending");
  assert.equal(playerCaptureProbeResult({ ...ready, pos: "2" }, nonce), "pending");
  assert.equal(playerCaptureProbeResult({ ...ready, pos: 2.24 }, nonce), "ready");
  assert.equal(playerCaptureProbeResult({ ...ready, playerFixture: "seek-timeout" }, nonce), "seek-timeout");
});

test("player capture timeout summary includes only safe state fields", () => {
  const summary = playerCaptureSummary({ screen: "playback", playerFixture: "seek-timeout", playerMode: "direct", play: "paused", pos: 2, mediaFileId: "private-id", account: "private-account" });
  assert.equal(summary, "screen=playback fixture=seek-timeout mode=direct state=paused position=2.0");
  assert.doesNotMatch(summary, /private-id|private-account/);
});

test("player fixture summaries retain safe states and reject unknown details", () => {
  assert.match(playerCaptureSummary({ playerFixture: "direct-preflight" }), /fixture=direct-preflight/);
  assert.match(playerCaptureSummary({ playerFixture: "fixture-http-503" }), /fixture=fixture-http-503/);
  assert.match(playerCaptureSummary({ playerFixture: "private-title-name" }), /fixture=unknown/);
});

test("library capture waits for the expected kind and settled first-grid focus", () => {
  const ready = { screen: "browse", kind: "series", focusArea: "grid", initialFocusPending: false };
  assert.equal(libraryFocusReady(ready, "series"), true);
  assert.equal(libraryFocusReady({ ...ready, kind: "movie" }, "series"), false);
  assert.equal(libraryFocusReady({ ...ready, focusArea: "nav" }, "series"), false);
  assert.equal(libraryFocusReady({ ...ready, initialFocusPending: true }, "series"), false);
  assert.match(libraryFocusSummary({ ...ready, focusArea: "nav", focus: "private title", userId: "private id" }), /focusArea=nav/);
  assert.doesNotMatch(libraryFocusSummary({ ...ready, focus: "private title", userId: "private id" }), /private title|private id/);
  assert.equal(expectedLibraryKind("/movies"), "movie");
  assert.equal(expectedLibraryKind("/series"), "series");
  assert.equal(expectedLibraryKind("/music"), "artist");
  assert.equal(expectedLibraryKind("/search"), undefined);
  assert.equal(expectedLibraryKind("/settings"), undefined);
});

test("focus sidecar contains semantic state only", () => {
  const sidecar = focusCaptureSidecar({ screen: "browse", kind: "series", focusArea: "grid", initialFocusPending: false, focus: "private title", userId: "private id", itemId: "private item" });
  assert.deepEqual(sidecar, { screen: "browse", kind: "series", focusArea: "grid", initialFocusPending: false, initialFocusReady: true });
  assert.doesNotMatch(JSON.stringify(sidecar), /private title|private id|private item/);
});

test("a missed native theme click refuses a dark capture", () => {
  assert.equal(themeCaptureAllowed({ themeChoice: "system", themeIsLight: true }, "dark"), false);
  assert.equal(themeCaptureAllowed({ themeChoice: "dark", themeIsLight: true }, "dark"), false);
});

test("a confirmed native theme choice permits its matching capture", () => {
  assert.equal(themeCaptureAllowed({ themeChoice: "dark", themeIsLight: false }, "dark"), true);
  assert.equal(themeCaptureAllowed({ themeChoice: "light", themeIsLight: true }, "light"), true);
});

test("player-controls fixture is configured as a secret, not a workflow input", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/xbox-wall.yml", import.meta.url), "utf8");
  const driver = readFileSync(new URL("./driver.mjs", import.meta.url), "utf8");
  const suite = JSON.parse(readFileSync(new URL("../screens.json", import.meta.url), "utf8"));
  const player = suite.screens.find((screen) => screen.id === "player-controls");
  assert.equal(player.steps.find((step) => step.type === "pauseAt").seconds, 2);
  assert.match(driver, /parity\.pause", "2"\)/);
  assert.match(driver, /playerCaptureProbeResult\(playerTrace, playerNonce\)/);
  const screenPart = workflow.match(/screens-\*\)([\s\S]*?)\n\s*dpad\)/)?.[1];
  const dpadPart = workflow.match(/\n\s*dpad\)([\s\S]*?)\n\s*playback\)/)?.[1];
  const prelude = workflow.split('case "$PART" in')[0];
  assert.ok(screenPart, "screen workflow case exists");
  assert.ok(dpadPart, "D-pad workflow case exists");
  for (const part of [prelude, screenPart, dpadPart]) {
    assert.doesNotMatch(part, /reset-progress\.mjs/);
    assert.doesNotMatch(part, /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
  }
  assert.doesNotMatch(workflow, /^\s+direct_play_media_id:/m);
  assert.doesNotMatch(workflow, /inputs\.direct_play_media_id/);
  assert.match(workflow, /PLAYARR_DEVICE_TEST_DIRECT_PLAY_MEDIA_ID: \$\{\{ secrets\.PLAYARR_DEVICE_TEST_DIRECT_PLAY_MEDIA_ID \}\}/);
});
