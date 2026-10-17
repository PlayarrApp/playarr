import assert from "node:assert/strict";
import test from "node:test";
import { waitForFreshHeartbeat } from "./vidaa-guard-wait.mjs";

const stale = { status: 1, stdout: "abort: identity heartbeat is stale", stderr: "" };
const ok = { status: 0, stdout: "device-test account guard passed", stderr: "" };

test("a stale heartbeat is retried until it is fresh", () => {
  const results = [stale, stale, ok];
  let sleeps = 0;
  waitForFreshHeartbeat(() => results.shift(), { sleep: () => { sleeps += 1; } });
  assert.equal(sleeps, 2);
});

test("an identity that is unavailable right after a reload is retried", () => {
  const results = [{ status: 1, stdout: "abort: authenticated device-test account identity unavailable" }, ok];
  let sleeps = 0;
  waitForFreshHeartbeat(() => results.shift(), { sleep: () => { sleeps += 1; } });
  assert.equal(sleeps, 1);
});

test("an account rejection fails at once", () => {
  let calls = 0;
  assert.throws(() => waitForFreshHeartbeat(() => { calls += 1; return { status: 1, stdout: "abort: the signed-in account changed since this frame" }; },
    { sleep: () => assert.fail("must not wait") }), /account changed/);
  assert.equal(calls, 1);
});

test("a heartbeat that never comes back times out", () => {
  let t = 0;
  assert.throws(() => waitForFreshHeartbeat(() => stale, { timeoutMs: 5000, now: () => t, sleep: () => { t += 2000; } }), /stale/);
});
