// entry/src/test/RailPrefs.test.ts: core/RailPrefs.ts against web lib/homeRailPrefs.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { moveRail, toggleRail, toPreferencesRequest } from "../main/ets/core/RailPrefs";

const rails = [
  { id: "a", title: "A", hidden: false },
  { id: "b", title: "B", hidden: true },
  { id: "c", title: "C", hidden: false },
];

test("moves a rail and stops at the ends", () => {
  assert.deepEqual(moveRail(rails, "b", -1).map((r) => r.id), ["b", "a", "c"]);
  assert.equal(moveRail(rails, "a", -1), rails);
  assert.equal(moveRail(rails, "c", 1), rails);
});

test("toggling flips only that rail", () => {
  assert.deepEqual(toggleRail(rails, "a").map((r) => r.hidden), [true, true, false]);
});

test("the request carries the order and the hidden set", () => {
  assert.deepEqual(toPreferencesRequest(rails), { order: ["a", "b", "c"], hidden: ["b"] });
});
