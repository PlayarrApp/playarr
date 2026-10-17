import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createDriver } from "./drivers/android-tv.mjs";
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
    // The fake ADB starts a Node subprocess; parallel test workers can delay cold startup beyond one second.
    commandTimeoutMs: 10_000,
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

test("Android refuses capture readiness when route data and artwork idle cannot be verified", async () => {
  const { driver } = driverWith(initialState());
  await driver.home();
  await assert.rejects(driver.waitReady({ screen: "home", phase: "capture" }), /cannot prove route data is loaded/);
});

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
  await assert.rejects(driver.start(), /adb shell dumpsys timed out after 37ms/);
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
