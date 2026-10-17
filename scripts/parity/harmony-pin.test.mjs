import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// A stand-in for the preview bridge: /setclock stores the instant and the "app" reports it back through /state.
const calls = [];
let clock = "";
const bridge = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  calls.push(url.pathname + url.search);
  if (url.pathname === "/setclock") clock = url.searchParams.get("now");
  res.end(url.pathname === "/state" ? JSON.stringify({ clock }) : "ok");
});
await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
process.env.HARMONY_CTL = String(bridge.address().port);
const { createDriver } = await import("./drivers/harmony.mjs");
test.after(() => bridge.close());

test("Harmony pins the instant on the bridge and waits for the app to report it", async () => {
  const driver = await createDriver();
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00.000Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" });
  assert.ok(calls.includes("/setclock?now=2026-10-07T12%3A00%3A00Z"));
});

test("Harmony rejects a missing or bad instant and a region its pinned clock cannot render", async () => {
  const driver = await createDriver();
  calls.length = 0;
  await assert.rejects(driver.setDeterministicCapture({ disableAnimations: true }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "not a date" }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", timeZone: "Asia/Bangkok" }), /unsupported for Asia\/Bangkok/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", locale: "en-US" }), /unsupported/);
  assert.deepEqual(calls, []);
});
