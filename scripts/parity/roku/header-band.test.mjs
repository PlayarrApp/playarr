import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { bandMismatch } from "./header-band.mjs";

const frame = (paint) => {
  const png = new PNG({ width: 1920, height: 1080 });
  png.data.fill(30);
  paint?.(png);
  return png;
};

test("identical headers do not mismatch and a moved Back button does", () => {
  assert.equal(bandMismatch(frame(), frame()), 0);
  const moved = frame((png) => { for (let y = 56; y < 106; y++) for (let x = 160; x < 210; x++) png.data.fill(255, (y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4); });
  assert.ok(bandMismatch(frame(), moved) > 0.5);
});

test("the clock box and the nav rail are masked", () => {
  const clock = frame((png) => { for (let y = 60; y < 100; y++) for (let x = 470; x < 640; x++) png.data.fill(255, (y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4); });
  const rail = frame((png) => { for (let y = 0; y < 128; y++) for (let x = 40; x < 120; x++) png.data.fill(255, (y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4); });
  assert.equal(bandMismatch(frame(), clock), 0);
  assert.equal(bandMismatch(frame(), rail), 0);
});
