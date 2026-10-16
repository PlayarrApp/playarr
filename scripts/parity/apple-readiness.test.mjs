import test from "node:test";
import assert from "node:assert/strict";
import { appleReadinessResult, appleScreenForRoute, waitForAppleReadiness } from "./apple-readiness.mjs";

const clock = () => {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; } };
};

test("Apple exact filter and actions routes require their own loaded panel state", () => {
  for (const [screen, route] of [["filters", "/movies?panel=filters"], ["actions", "/movies?panel=actions"]]) {
    const snapshot = { route, contentState: "loaded", items: 8, panelContentState: "loaded" };
    assert.equal(appleScreenForRoute(route), screen);
    assert.equal(appleReadinessResult(snapshot, screen), true);
    assert.equal(appleReadinessResult({ ...snapshot, route: "/movies?panel=other" }, screen), false);
  }
  assert.equal(appleReadinessResult({ route: "/movies?panel=filters", contentState: "loaded", items: 8, panelContentState: "loading" }, "filters"), false);
  assert.throws(() => appleReadinessResult({ route: "/movies?panel=filters", contentState: "loaded", items: 8, panelContentState: "failed" }, "filters"), /error state/);
});

test("Apple readiness refuses empty and failed route data", () => {
  assert.throws(() => appleReadinessResult({ route: "/movies", contentState: "empty", items: 0 }, "movies"), /empty route data/);
  assert.throws(() => appleReadinessResult({ route: "/movies", contentState: "failed", items: 0 }, "movies"), /error state/);
});

test("Apple readiness times out on loading data instead of allowing a capture", async () => {
  const timer = clock();
  await assert.rejects(waitForAppleReadiness({
    screen: "movies",
    readState: async () => ({ route: "/movies", contentState: "loading", items: 0 }),
    timeoutMs: 10,
    pollMs: 5,
    clock: timer,
  }), /timed out without loaded route data/);
  assert.equal(timer.now(), 10);
});

test("Apple readiness waits for two identical loaded snapshots", async () => {
  let reads = 0;
  const snapshot = { route: "/movies", contentState: "loaded", items: 8 };
  const result = await waitForAppleReadiness({
    screen: "movies",
    readState: async () => { reads += 1; return snapshot; },
    timeoutMs: 10,
    pollMs: 1,
    clock: clock(),
  });
  assert.equal(result, snapshot);
  assert.equal(reads, 2);
});
