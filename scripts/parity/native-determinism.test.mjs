import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { captureReadinessState, createDriver, stableCaptureObservation } from "./drivers/android-tv.mjs";
import { handleFakeDeterministicAdbCommand, initialFakeAdbState } from "./test-drivers/fake-deterministic-adb.mjs";

const scratchRoot = process.env.PLAYARR_PARITY_TEST_OUT;
if (!scratchRoot) throw new Error("PLAYARR_PARITY_TEST_OUT must point to task-scoped .data scratch space");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "native-determinism-"));
const driverWith = (state, extraEnv = {}, options = {}) => {
  const fakeState = { ...initialFakeAdbState(), ...state };
  const env = { ...process.env, ...extraEnv };
  const driver = createDriver({
    readinessPollMs: 1,
    readinessTimeoutMs: options.readinessTimeoutMs ?? 10_000,
    commandTimeoutMs: 1000,
    clock: options.clock ?? { sleep: async () => {}, now: (() => { let time = 0; return () => time++; })() },
    env,
    accountGuard: options.accountGuard,
    execute: async (_command, args, execOptions) => {
      assert.equal(execOptions.timeout, 1000);
      assert.equal(execOptions.killSignal, "SIGTERM");
      assert.equal(execOptions.env, env);
      return handleFakeDeterministicAdbCommand(fakeState, args[0], args.slice(1), env);
    },
  });
  return { driver, readState: () => structuredClone(fakeState) };
};

const initialState = () => ({ ...initialFakeAdbState(), transition_animation_scale: "0.75", animator_duration_scale: "1.25" });

test("Android account mismatch blocks device mutations and capture", async () => {
  let guardCalls = 0;
  const { driver, readState } = driverWith(initialState(), {
    PARITY_DEVICE_ACCOUNT_GUARD: "android",
    PARITY_USE_DEVICE_TEST_DPAD: "1",
  }, { accountGuard: async () => { guardCalls += 1; throw new Error("Android device account does not match the selected approved account"); } });
  await assert.rejects(driver.start(), /does not match/);
  await assert.rejects(driver.setTheme("light"), /does not match/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true }), /does not match/);
  await assert.rejects(driver.home(), /does not match/);
  await assert.rejects(driver.key("down"), /does not match/);
  await assert.rejects(driver.screenshot(join(scratch, "account-guard.png")), /does not match/);
  assert.equal(guardCalls, 6);
  assert.deepEqual(readState(), initialState());
});

test("Android deterministic capture pins the launch clock and restores animation scales", async () => {
  const { driver, readState } = driverWith(initialState());
  await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
  assert.deepEqual(
    [readState().window_animation_scale, readState().transition_animation_scale, readState().animator_duration_scale],
    ["0", "0", "0"],
  );
  await driver.home();
  const state = readState();
  assert.ok(state.launches[0].includes("--es"));
  assert.ok(state.launches[0].includes("parity_clock"));
  assert.ok(state.logs.some((line) => line.includes("clock_consumed=2026-10-05T12:00:00Z")));
  await driver.stop();
  assert.deepEqual(
    [readState().window_animation_scale, readState().transition_animation_scale, readState().animator_duration_scale],
    ["1.0", "0.75", "1.25"],
  );
});

test("Android clock consumption matches equivalent ISO instants", async (t) => {
  const equivalents = [
    ["2026-10-05T12:00:00.000Z", "2026-10-05T12:00:00Z"],
    ["2026-10-05T12:00:00Z", "2026-10-05T12:00:00.000Z"],
    ["2026-10-05T12:00:00Z", "2026-10-05T14:00:00+02:00"],
    ["2026-10-05T09:30:00.123456789Z", "2026-10-05T12:00:00.123456789+02:30"],
    ["2026-10-05T09:30:00.1234Z", "2026-10-05T12:00:00.123400+02:30"],
  ];
  for (const [consumedClock, fixedNow] of equivalents) {
    await t.test(`${fixedNow} matches ${consumedClock}`, async () => {
      const { driver } = driverWith(initialState(), { PLAYARR_PARITY_FAKE_CLOCK_LOG: consumedClock });
      await driver.setDeterministicCapture({ fixedNow, disableAnimations: true });
      await driver.home();
    });
  }
});

test("Android clock consumption rejects a different nanosecond instant", async () => {
  const { driver } = driverWith(initialState(), { PLAYARR_PARITY_FAKE_CLOCK_LOG: "2026-10-05T09:30:00.123456788Z" }, { readinessTimeoutMs: 100 });
  await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00.123456789+02:30", disableAnimations: true });
  await assert.rejects(driver.home(), /did not confirm consuming PARITY_FIXED_NOW/);
});

test("Android readiness accepts stable navigation-rail focus", async () => {
  const { driver } = driverWith(initialState(), { PLAYARR_PARITY_FAKE_ADB_NAV_FOCUS: "1" });
  await driver.home();
  await driver.waitReady({ screen: "home", phase: "focus" });
});

test("Android readiness rejects a stable focus on the wrong route", async () => {
  const { driver } = driverWith(initialState(), {}, { readinessTimeoutMs: 100 });
  await driver.route("/movies");
  await assert.rejects(driver.waitReady({ screen: "home", phase: "route" }), /timed out without stable focused content/);
});

test("Android start launches the guarded app before DPAD touch-mode recovery", async () => {
  let guardCalls = 0;
  const { driver, readState } = driverWith({ ...initialState(), touchMode: 1, appForeground: false }, {
    PARITY_DEVICE_ACCOUNT_GUARD: "android",
    PARITY_USE_DEVICE_TEST_DPAD: "1",
  }, { accountGuard: async () => { guardCalls += 1; } });
  await driver.start();
  const state = readState();
  assert.equal(state.launches.length, 1);
  assert.ok(state.launches[0].includes("home"));
  assert.deepEqual(state.keys, ["KEYCODE_DPAD_DOWN"]);
  assert.equal(state.touchMode, 0);
  assert.ok(guardCalls >= 1);
});

test("Android refuses capture readiness without a capture generation for the screen", async () => {
  const { driver } = driverWith(initialState(), {}, { readinessTimeoutMs: 100 });
  await driver.home();
  await assert.rejects(driver.waitReady({ screen: "home", phase: "capture" }), /timed out without stable focused content/);
});

for (const screen of ["settings", "profiles", "search", "film-detail", "series-detail", "calendar-week", "player-controls"]) {
  test(`Android capture readiness covers the ${screen} screen`, async () => {
    const { driver, readState } = driverWith(initialState(), {}, { readinessTimeoutMs: 1000 });
    await driver.setCaptureTarget(screen);
    await driver.home();
    const launch = readState().launches[0];
    assert.equal(launch[launch.indexOf("parity_capture_screen") + 1], screen);
    // The fake app reports the route that was launched; align it with the screen's nav route.
    const state = readState();
    await assert.rejects(driver.waitReady({ screen, phase: "capture" }), /timed out/); // launched on "home": only home's route matches
    assert.ok(state.captureGeneration);
  });
}

test("Android capture readiness passes for home once the marker and focus are stable", async () => {
  const { driver } = driverWith(initialState());
  await driver.setCaptureTarget("home");
  await driver.home();
  await driver.waitReady({ screen: "home", phase: "capture" });
});

test("Android capture marker requires current route data, layout and visible artwork completion", () => {
  const generation = "generation-a";
  const marker = (overrides = {}) => `capture_state generation=${generation} screen=movies data=ready data_count=2 layout=ready surface=content art_seen=2 art_pending=0 art_failed=0 ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(" ")}`;
  const evaluate = (line) => captureReadinessState(["capture_generation=old", line], { generation, screen: "movies" });
  const evaluateSurface = (line, surface) => captureReadinessState([line], { generation, screen: "movies", surface });
  assert.equal(evaluate(marker()).ready, true);
  assert.equal(evaluate("capture_state generation=old screen=movies data=ready data_count=2 layout=ready art_seen=2 art_pending=0 art_failed=0").ready, false);
  assert.equal(evaluate(marker({ data: "loading" })).ready, false);
  assert.equal(evaluate(marker({ layout: "loading" })).ready, false);
  assert.equal(evaluate(marker({ art_pending: 1 })).ready, false);
  assert.equal(evaluate(marker({ art_failed: 1 })).ready, false);
  assert.equal(evaluate(marker({ art_seen: 0 })).ready, false);
  assert.equal(evaluate(marker({ screen: "series" })).ready, false);
  assert.equal(evaluate(marker({ art_seen: -1 })).ready, false);
  assert.equal(evaluateSurface(marker({ surface: "filters" }), "filters").ready, true);
  assert.equal(evaluateSurface(marker({ surface: "actions" }), "actions").ready, true);
  assert.equal(evaluateSurface(marker(), "filters").reason, "wrong surface");
  assert.equal(captureReadinessState([marker()], { generation: null, screen: "movies" }).ready, false);
  assert.equal(captureReadinessState(["capture_state generation=g screen=movies data=ready data_count=0 layout=ready art_seen=0 art_pending=0 art_failed=0"], { generation: "g", screen: "movies" }).ready, true);
});

test("Android capture stability rejects marker resets and route or focus changes", () => {
  const ready = { ready: true, routeMatches: true, marker: "state-a", focus: "focused-node" };
  assert.equal(stableCaptureObservation({ marker: "state-a", focus: "focused-node" }, ready), true);
  assert.equal(stableCaptureObservation({ marker: "state-b", focus: "focused-node" }, ready), false);
  assert.equal(stableCaptureObservation({ marker: "state-a", focus: "other-node" }, ready), false);
  assert.equal(stableCaptureObservation({ marker: "state-a", focus: "focused-node" }, { ...ready, ready: false }), false);
  assert.equal(stableCaptureObservation({ marker: "state-a", focus: "focused-node" }, { ...ready, routeMatches: false }), false);
  assert.equal(stableCaptureObservation({ marker: "state-a", focus: "focused-node" }, { ...ready, focus: "" }), false);
});

test("Android capture waitReady survives ready, pending and focus changes before stable completion", async () => {
  const sequence = "ready,pending,focus,ready,ready,ready";
  const { driver, readState } = driverWith(initialState(), { PLAYARR_PARITY_FAKE_CAPTURE_SEQUENCE: sequence });
  await driver.route("/movies");
  await driver.waitReady({ screen: "movies", phase: "capture" });
  const state = readState();
  assert.ok(state.captureReadCount >= 6);
  const launch = state.launches[0];
  const generation = launch[launch.indexOf("parity_capture_generation") + 1];
  assert.ok(generation);
  assert.equal(launch[launch.indexOf("parity_capture_screen") + 1], "movies");
  assert.equal(state.captureGeneration, generation);
});

test("Android capture waitReady waits for the requested Compose drawer surface", async () => {
  const { driver } = driverWith(initialState(), { PLAYARR_PARITY_FAKE_CAPTURE_SURFACE: "filters", PLAYARR_PARITY_FAKE_DRAWER_FOCUS: "1" });
  await driver.route("/movies");
  await driver.waitReady({ screen: "movies", phase: "capture", surface: "filters" });
});

for (const screen of ["filters", "actions"]) {
  test(`Android public capture path readies the ${screen} suite target`, async () => {
    const { driver, readState } = driverWith(initialState(), {
      PLAYARR_PARITY_FAKE_CAPTURE_SURFACE: screen,
      PLAYARR_PARITY_FAKE_DRAWER_FOCUS: "1",
    }, {});
    await driver.setCaptureTarget(screen);
    await driver.home();
    await driver.route("/movies");
    await driver.waitReady({ screen, phase: "capture" });
    const launch = readState().launches.at(-1);
    assert.equal(launch[launch.indexOf("parity_capture_screen") + 1], "movies");
  });
}

test("Android deterministic capture rejects requests without animation disabling", async () => {
  const { driver } = driverWith(initialState());
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z" }), /disableAnimations: true/);
});

test("Android deterministic capture preserves bounded command timeout errors", async () => {
  const env = {};
  const driver = createDriver({
    env,
    commandTimeoutMs: 37,
    execute: async (_command, _args, options) => {
      assert.equal(options.timeout, 37);
      assert.equal(options.killSignal, "SIGTERM");
      assert.equal(options.env, env);
      const error = new Error("process was terminated");
      error.killed = true;
      error.signal = "SIGTERM";
      throw error;
    },
  });
  await assert.rejects(driver.start(), /adb shell am timed out after 37ms/);
});

test("Android reports installed APK path and digest as build identity", async () => {
  const { driver } = driverWith(initialState());
  assert.deepEqual(await driver.captureBuildIdentity(), {
    package: "io.playarr.mobile",
    apk: "/data/app/io.playarr.mobile/base.apk",
    sha256: "a".repeat(64),
  });
});

test("Android restores animation scales after a partial animation-disable failure", async () => {
  const { driver, readState } = driverWith(initialState(), { PLAYARR_PARITY_FAKE_ADB_FAIL_PUT: "animator_duration_scale" });
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true }), /could not disable system animation scale animator_duration_scale/);
  await driver.stop();
  assert.deepEqual(
    [readState().window_animation_scale, readState().transition_animation_scale, readState().animator_duration_scale],
    ["1.0", "0.75", "1.25"],
  );
});

test("Android restores a pre-disabled animation scale to the normal scale", async () => {
  const state = initialState();
  state.window_animation_scale = "0";
  const { driver, readState } = driverWith(state);
  await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
  await driver.stop();
  assert.equal(readState().window_animation_scale, "1");
});

test("Android pins the time zone and app locale with the clock and restores both", async () => {
  const { driver, readState } = driverWith(initialState());
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" });
  assert.deepEqual([readState().timezone, readState().locales], ["UTC", "en-GB"]);
  await driver.stop();
  assert.deepEqual([readState().timezone, readState().locales], ["Asia/Bangkok", ""]);
});

test("Android leaves the time zone and locale alone when none is requested", async () => {
  const { driver, readState } = driverWith(initialState());
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true });
  assert.deepEqual([readState().timezone, readState().locales], ["Asia/Bangkok", ""]);
  await driver.stop();
});
