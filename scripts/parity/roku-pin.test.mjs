import test from "node:test";
import assert from "node:assert/strict";
import { applyParityLine, createDriver, createParityState, pinnedClockText } from "./drivers/roku.mjs";

const driverWithEnv = () => {
  process.env.ROKU_DEV_TARGET ??= "127.0.0.1";
  process.env.ROKU_DEV_PASSWORD ??= "unused";
  return createDriver({ args: ["--only", "screens", "--screens", "home"] });
};

test("Roku renders the pinned instant as the app clock does: UTC, en-GB, upper case", () => {
  assert.equal(pinnedClockText("2026-10-07T12:00:00Z"), "12:00 WED 7 OCTOBER");
  assert.equal(pinnedClockText("2026-10-07T00:05:00+07:00"), "17:05 TUE 6 OCTOBER");
});

test("Roku records the clock the app reports on the debug console", () => {
  const state = createParityState();
  applyParityLine(state, "PARITY|clock|12:00 WED 7 OCTOBER");
  assert.equal(state.clock, "12:00 WED 7 OCTOBER");
});

test("Roku accepts a valid instant for the region its frozen clock renders, and rejects the rest", async () => {
  const driver = driverWithEnv();
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" });
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true });
  await assert.rejects(driver.setDeterministicCapture({ disableAnimations: true }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "not a date" }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", timeZone: "Asia/Bangkok" }), /unsupported for Asia\/Bangkok/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", locale: "en-US" }), /unsupported/);
});
