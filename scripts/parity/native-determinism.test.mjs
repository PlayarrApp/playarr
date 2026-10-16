import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDriver } from "./drivers/android-tv.mjs";
import { runFakeDeterministicAdb } from "./test-drivers/fake-deterministic-adb.mjs";

const scratchRoot = process.env.PLAYARR_PARITY_TEST_OUT;
if (!scratchRoot) throw new Error("PLAYARR_PARITY_TEST_OUT must point to task-scoped .data scratch space");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "native-determinism-"));
let stateSequence = 0;
const adbPath = new URL("./test-drivers/fake-deterministic-adb.mjs", import.meta.url).pathname;
const initialState = () => ({
  window_animation_scale: "1.0",
  transition_animation_scale: "0.75",
  animator_duration_scale: "1.25",
  launches: [],
  logs: [],
});
const driverWith = (state, extraEnv = {}, options = {}) => {
  const statePath = join(scratch, `adb-state-${++stateSequence}.json`);
  writeFileSync(statePath, JSON.stringify(state));
  const driver = createDriver({
    adbBin: adbPath,
    readinessPollMs: 1,
    readinessTimeoutMs: options.readinessTimeoutMs ?? 10_000,
    commandTimeoutMs: 1000,
    commandRunner: async (_command, args, { env }) => ({ stdout: runFakeDeterministicAdb(args, env), stderr: "" }),
    clock: options.clock ?? { sleep: async () => {}, now: (() => { let time = 0; return () => time++; })() },
    env: { ...process.env, PLAYARR_PARITY_FAKE_ADB_STATE: statePath, ...extraEnv },
  });
  return { driver, readState: () => JSON.parse(readFileSync(statePath, "utf8")) };
};

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
