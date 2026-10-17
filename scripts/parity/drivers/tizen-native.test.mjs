import test from "node:test";
import assert from "node:assert/strict";
import { createDriver } from "./tizen-native.mjs";
import { captureTimezone, captureWallTime } from "../capture-timezone.mjs";
import { readFileSync } from "node:fs";

const trusted = "https://test.example";
const identity = { username: "device-test", isCurrentCount: 1, serverUrl: trusted };
const build = { app: "Playarr.Tizen", version: "0.1.0", sha256: "a".repeat(64), animationMode: "none" };
const accountEnv = { PLAYARR_USERNAME: "device-test", PLAYARR_TEST_SERVER_URL: trusted };
const secrets = { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_TEST_SERVER_URL: trusted };

test("web and Tizen capture clocks follow the suite timezone", () => {
  const suite = JSON.parse(readFileSync(new URL("../screens.json", import.meta.url), "utf8"));
  assert.equal(captureTimezone, suite.determinism.timezone);
  assert.equal(captureWallTime("2026-01-02T03:04:05.000Z"), "2026-01-02T03:04:05.000");
});

function harness(overrides = {}) {
  const calls = [];
  let state = { ready: true, pending: 0, route: "/", focused: null, position: null, theme: "dark", playing: false, positionMs: 0, animationMode: "none" };
  const request = async (method, path) => {
    calls.push([method, path]);
    if (path === "/identity") return overrides.identity ?? identity;
    if (path === "/build") return overrides.build ?? build;
    if (path.startsWith("/capture-clock")) return {};
    if (path === "/state") return overrides.state ?? state;
    return {};
  };
  const driverPromise = createDriver({ request, delay: async () => {}, env: accountEnv, secrets, setupForward: () => {} });
  return { calls, driverPromise };
}

test("Tizen deterministic hooks verify the native session and expose build digest", async () => {
  const { calls, driverPromise } = harness();
  const driver = await driverPromise;
  await driver.setDeterministicCapture({ fixedNow: "2026-01-02T03:04:05.000Z", disableAnimations: true });
  assert.deepEqual(await driver.captureBuildIdentity(), build);
  assert.ok(calls.some(([, path]) => path === "/capture-clock?now=2026-01-02T03%3A04%3A05.000"));
  assert.ok(calls.filter(([, path]) => path === "/identity").length >= 2);
});

test("Tizen account guard rejects a non-device-test active profile", async () => {
  const { driverPromise } = harness({ identity: { ...identity, username: "operator" } });
  const driver = await driverPromise;
  await assert.rejects(driver.captureBuildIdentity(), /device-test account guard rejected/);
});

test("Tizen deterministic readiness fails closed when ready is absent", async () => {
  const { driverPromise } = harness({ state: { pending: 0, route: "/", theme: "dark" } });
  const driver = await driverPromise;
  await assert.rejects(driver.waitReady(), /readiness response is incomplete/);
});

test("Tizen build identity requires a SHA-256 digest", async () => {
  const { driverPromise } = harness({ build: { ...build, sha256: "unknown" } });
  const driver = await driverPromise;
  await assert.rejects(driver.captureBuildIdentity(), /build identity is incomplete/);
});

test("Tizen visual readiness ignores an advancing player clock", async () => {
  let samples = 0;
  const driver = await createDriver({
    env: accountEnv, secrets, setupForward: () => {}, delay: async () => {},
    request: async (_method, path) => {
      if (path === "/identity") return identity;
      if (path === "/state") return { ready: true, pending: 0, route: "/player/test", focused: "pause", position: { rail: 0, index: 1 }, theme: "dark", playing: true, positionMs: ++samples * 1000, animationMode: "none" };
      return {};
    },
  });
  await driver.waitReady();
  assert.equal(samples, 2);
});

test("Tizen player captures require paused playback", async () => {
  const { driverPromise } = harness({ state: { ready: true, pending: 0, route: "/player/test", focused: "pause", position: null, theme: "dark", playing: true, positionMs: 1000, animationMode: "none" } });
  const driver = await driverPromise;
  await assert.rejects(driver.screenshot("ignored.png"), /requires paused playback/);
});

test("Tizen screenshots require stable decoded pixels across separated samples", async () => {
  let captures = 0;
  const driver = await createDriver({
    env: accountEnv, secrets, setupForward: () => {}, delay: async () => {},
    request: async (_method, path) => path === "/identity" ? identity : { ready: true, pending: 0, route: "/", focused: "home", position: null, theme: "dark", playing: false, animationMode: "none" },
    captureScreenshot: () => { captures += 1; }, pixelSignature: () => "same-decoded-pixels",
  });
  await driver.screenshot("ignored.png");
  assert.equal(captures, 2);
  let signature = 0;
  const unstable = await createDriver({
    env: accountEnv, secrets, setupForward: () => {}, delay: async () => {},
    request: async (_method, path) => path === "/identity" ? identity : { ready: true, pending: 0, route: "/", focused: "home", position: null, theme: "dark", playing: false, animationMode: "none" },
    captureScreenshot: () => {}, pixelSignature: () => String(signature++),
  });
  await assert.rejects(unstable.screenshot("ignored.png"), /pixels changed/);
});

test("Tizen screenshot guard rechecks the active account before the final sample", async () => {
  let identityReads = 0;
  const captures = [];
  const driver = await createDriver({
    env: accountEnv, secrets, setupForward: () => {}, delay: async () => {},
    request: async (_method, path) => {
      if (path === "/identity") {
        identityReads += 1;
        return identityReads === 1 ? identity : { ...identity, username: "operator" };
      }
      return { ready: true, pending: 0, route: "/", focused: "home", position: null, theme: "dark", playing: false, animationMode: "none" };
    },
    captureScreenshot: (path) => captures.push(path), pixelSignature: () => "same-decoded-pixels",
  });
  await assert.rejects(driver.screenshot("final.png"), /device-test account guard rejected/);
  assert.equal(identityReads, 2);
  assert.deepEqual(captures, ["final.png.stability.png"]);
});
