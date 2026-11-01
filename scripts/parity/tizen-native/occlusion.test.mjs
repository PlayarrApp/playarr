import test from "node:test";
import assert from "node:assert/strict";
import { changedInside, diffMask, planBatches, restoredDrift } from "./occlusion.mjs";

const image = (w, h, fill = 10) => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(fill) });
const paint = (img, x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * img.width + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; } };

test("candidates that touch never share a batch, the same view always may", () => {
  const cands = [[0, 0, 10, 10, 0, 1], [11, 0, 10, 10, 0, 2], [100, 0, 10, 10, 0, 3], [0, 0, 5, 5, 0, 1]];
  const batches = planBatches(cands);
  assert.deepEqual(batches, [[0, 2, 3], [1]]);
});

test("a candidate is kept only when its own box changes by a visible amount", () => {
  const base = image(40, 20); const hidden = image(40, 20);
  paint(hidden, 2, 2, 8, 8, 200);
  const noise = new Uint8Array(40 * 20);
  assert.equal(changedInside([0, 0, 10, 10], base, hidden, noise), true);
  assert.equal(changedInside([20, 0, 10, 10], base, hidden, noise), false);
  paint(hidden, 20, 0, 30, 10, 14); // 4 levels: invisible
  assert.equal(changedInside([20, 0, 10, 10], base, hidden, noise), false);
});

test("pixels that differ between two unchanged grabs are ignored", () => {
  const a = image(10, 10); const b = image(10, 10); paint(b, 0, 0, 10, 10, 200);
  const noise = diffMask(a, b);
  assert.equal(changedInside([0, 0, 10, 10], a, b, noise), false);
  assert.equal(restoredDrift(a, b, noise), 0);
  assert.equal(restoredDrift(a, b, new Uint8Array(100)), 100);
});
