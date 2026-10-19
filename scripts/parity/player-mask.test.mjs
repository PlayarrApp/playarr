import test from "node:test";
import assert from "node:assert/strict";
import { complement } from "./player-mask.mjs";
test("complement leaves the kept boxes unmasked", () => {
  assert.deepEqual(complement([[10, 10, 20, 20]], 100, 50), [[0, 0, 100, 10], [0, 10, 10, 20], [30, 10, 70, 20], [0, 30, 100, 20]]);
  assert.deepEqual(complement([], 4, 4), [[0, 0, 4, 4]]);
});
