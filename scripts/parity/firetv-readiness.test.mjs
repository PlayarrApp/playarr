import test from "node:test";
import assert from "node:assert/strict";
import { frameNameAt, framesMatch, selectDeviceTestAccount, waitForStableFrames } from "./firetv-readiness.mjs";
import { routeMatches } from "./suite-lib.mjs";

test("frame readiness accepts identical and near-identical frames", async () => {
  assert.equal(await framesMatch(async () => undefined, "a", "b"), true);
  assert.equal(await framesMatch(async () => { throw { code: 1, stderr: "4 (0.01%)" }; }, "a", "b"), true);
});

test("frame readiness rejects changed frames and capture errors", async () => {
  assert.equal(await framesMatch(async () => { throw { code: 1, stderr: "17 (0.2%)" }; }, "a", "b"), false);
  assert.equal(await framesMatch(async () => { throw { code: 2, stderr: "0 (0%)" }; }, "a", "b"), false);
  assert.equal(await framesMatch(async () => { throw { code: 1, stderr: "0 (0%)", killed: true }; }, "a", "b"), false);
  assert.equal(await framesMatch(async () => { throw { code: "ETIMEDOUT", stderr: "0 (0%)" }; }, "a", "b"), false);
  assert.equal(await framesMatch(async () => { throw new Error("capture failed"); }, "a", "b"), false);
});

test("settle loop captures distinct alternating files for each comparison", async () => {
  const captured = [];
  const compared = [];
  let clock = 0;
  await waitForStableFrames({
    capture: async (name) => { captured.push(name); return name; },
    compare: async (before, after) => { compared.push([before, after]); throw {stderr: "9 (0.1%)"}; },
    sleep: async () => undefined,
    now: () => clock += 25,
    maxMs: 100,
    intervalMs: 0,
    prefix: "settle",
  }).catch((error) => assert.match(error.message, /did not settle/));
  assert.deepEqual(captured.slice(0, 4), ["settle-a.png", "settle-b.png", "settle-a.png", "settle-b.png"]);
  assert.ok(compared.every(([before, after]) => before !== after));
});

test("actions readiness requires the real panel query", () => {
  assert.equal(routeMatches("/movies?panel=actions", "/movies?panel=actions"), true);
  assert.equal(routeMatches("/movies?panel=actions", "/movies"), false);
  assert.equal(routeMatches("/movies?panel=actions", "/movies?panel=filters"), false);
});

test("account selection reveals only an exact configured label", () => {
  const secrets = {PLAYARR_DEVICE_TEST_USERNAME: "user-a", PLAYARR_DEVICE_TEST_DPAD_USERNAME: "user-b"};
  assert.equal(selectDeviceTestAccount({username: "user-a"}, secrets, "device-test"), "device-test");
  assert.equal(selectDeviceTestAccount({username: "user-b"}, secrets, "device-test-dpad"), "device-test-dpad");
  assert.throws(() => selectDeviceTestAccount({username: "user-b"}, secrets, "device-test"), /does not match/);
  assert.throws(() => selectDeviceTestAccount({username: "user-c"}, secrets), /does not match|unknown/);
});
