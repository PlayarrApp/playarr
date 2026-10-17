import test from "node:test";
import assert from "node:assert/strict";

const load = async (device) => {
  process.env.DEVICE = device;
  const { createDriver } = await import("./drivers/tizen-webos.mjs");
  return createDriver();
};

test("webOS accepts a valid instant before the CDP connection exists, Tizen refuses to pin", async () => {
  const webos = await load("webos");
  await webos.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" });
  await assert.rejects(webos.setDeterministicCapture({ fixedNow: "nope" }), /valid fixedNow/);
  const tizen = await load("tizen");
  await assert.rejects(tizen.setDeterministicCapture({ fixedNow: "2026-10-07T12:00:00Z" }), /unsupported: the driver has no CDP channel/);
});
