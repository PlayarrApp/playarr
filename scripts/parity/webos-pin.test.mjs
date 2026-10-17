import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { installRegionPin, installVisualDate } from "./drivers/web.mjs";

const load = async (device) => {
  process.env.DEVICE = device;
  const { createDriver } = await import("./drivers/tizen-webos.mjs");
  return createDriver();
};

test("webOS and Tizen accept a valid instant; Tizen renders UTC only", async () => {
  const pin = { fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" };
  await (await load("webos")).setDeterministicCapture(pin);
  await assert.rejects((await load("webos")).setDeterministicCapture({ fixedNow: "nope" }), /valid fixedNow/);
  const tizen = await load("tizen");
  await tizen.setDeterministicCapture(pin);
  await assert.rejects(tizen.setDeterministicCapture({ ...pin, timeZone: "Asia/Bangkok" }), /unsupported for Asia\/Bangkok/);
  await assert.rejects(tizen.setDeterministicCapture({ fixedNow: "nope" }), /valid fixedNow/);
});

test("the page pin script renders the fixed instant in UTC and en-GB although the host zone is Bangkok", () => {
  const source = `(${installVisualDate})("2026-10-07T12:00:00Z");(${installRegionPin})("UTC", "en-GB");window.__parityPinned = true;`;
  const run = `
    const vm = require("node:vm");
    const context = vm.createContext({ Buffer });
    vm.runInContext("var window = globalThis;", context);
    vm.runInContext(Buffer.from(${JSON.stringify(Buffer.from(source).toString("base64"))}, "base64").toString(), context);
    const out = vm.runInContext(\`JSON.stringify({
      pinned: window.__parityPinned,
      hours: new Date().getHours(), offset: new Date().getTimezoneOffset(),
      time: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }),
      date: new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "long" }).format(new Date()),
      explicit: new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", hour: "numeric", hour12: false }).format(new Date()),
    })\`, context);
    console.log(out);`;
  const result = spawnSync(process.execPath, ["-e", run], { encoding: "utf8", env: { ...process.env, TZ: "Asia/Bangkok" } });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.equal(seen.pinned, true);
  assert.equal(seen.hours, 12);
  assert.equal(seen.offset, 0);
  assert.equal(seen.time, "12:00");
  assert.match(seen.date, /^Wed,? 7 October$/);
  assert.equal(seen.explicit, "19", "an explicit zone from the app still wins");
  assert.throws(() => installRegionPin("Asia/Bangkok", "en-GB", {}), /UTC only/);
});

test("netlog.js runs the stored pin script before anything else", () => {
  const netlog = readFileSync(new URL("./tizen-webos/netlog.js", import.meta.url), "utf8");
  assert.ok(netlog.startsWith("(function () {\n  // Parity pin"));
  assert.match(netlog.split("\n").slice(0, 4).join("\n"), /localStorage\.getItem\("__parityPin"\)[^\n]*\(0, eval\)\(pin\)/);
});
