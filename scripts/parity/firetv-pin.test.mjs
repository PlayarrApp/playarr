import test from "node:test";
import assert from "node:assert/strict";
import { createDriver } from "./drivers/firetv.mjs";

test("Fire TV accepts a valid instant for the region its frozen clock renders, and rejects the rest", async () => {
  const driver = await createDriver({});
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" });
  await driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true });
  await assert.rejects(driver.setDeterministicCapture({ disableAnimations: true }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "not a date" }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", timeZone: "Asia/Bangkok" }), /unsupported for Asia\/Bangkok/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", locale: "en-US" }), /unsupported/);
});
