import test from "node:test";
import assert from "node:assert/strict";
import { captureKey, missingCaptures, runScreenWithRetry, selectTargets } from "./capture-refs-contract.mjs";

const fast = { sleep: async () => {}, attempts: 3 };

test("a screen that fails every attempt is returned for recording, not thrown", async () => {
  let calls = 0; const logs = [];
  const r = await runScreenWithRetry(async () => { calls += 1; throw new Error("device-test account identity request failed"); }, { ...fast, log: (m) => logs.push(m) });
  assert.equal(r.ok, false); assert.equal(calls, 3);
  assert.match(logs.at(-1), /^FAIL \(3\)/);
});

test("a screen that succeeds after retries is ok", async () => {
  let calls = 0;
  assert.deepEqual(await runScreenWithRetry(async () => { if (++calls < 3) throw new Error("slow"); }, fast), { ok: true });
});

test("an account-guard rejection aborts instead of being skipped", async () => {
  await assert.rejects(runScreenWithRetry(async () => { throw new Error("device-test account guard rejected the current session"); }, fast), /guard rejected/);
});

test("publishing needs every group, theme and screen", () => {
  const have = new Set([captureKey("tv", "dark", "home"), captureKey("tv", "light", "home"), captureKey("tv", "dark", "search")]);
  assert.deepEqual(missingCaptures(["tv"], ["home", "search"], (g, t, s) => have.has(captureKey(g, t, s))), ["tv/light/search"]);
  assert.deepEqual(missingCaptures(["tv"], ["home"], (g, t, s) => have.has(captureKey(g, t, s))), []);
});

test("--only and --failed select exact targets and reject bad input", () => {
  assert.equal(selectTargets({}), null);
  assert.deepEqual([...selectTargets({ only: "tv/dark/home,iphone/light/series" })], ["tv/dark/home", "iphone/light/series"]);
  assert.deepEqual([...selectTargets({ failed: true, failedList: ["tv/dark/calendar-week"] })], ["tv/dark/calendar-week"]);
  assert.throws(() => selectTargets({ failed: true, failedList: [] }), /nothing to recapture/);
  assert.throws(() => selectTargets({ only: "tv/home" }), /bad target/);
});
