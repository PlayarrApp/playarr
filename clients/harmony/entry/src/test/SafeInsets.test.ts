// entry/src/test/SafeInsets.test.ts: core/SafeInsets.ts with the web spec's test insets (iPhone-like and Android punch-hole).
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { atLeast, mergeAvoidAreas, NO_INSETS } from "../main/ets/core/SafeInsets";

const none = { top: 0, bottom: 0, left: 0, right: 0 };

test("portrait: the cutout, system bar and gesture bar merge to the widest per side, px to vp", () => {
  const i = mergeAvoidAreas([{ ...none, top: 96 }, { ...none, top: 72 }, { ...none, bottom: 63 }], 3);
  assert.deepEqual(i, { top: 32, bottom: 21, left: 0, right: 0 });
});

test("landscape: the cutout sits on a side", () => {
  const i = mergeAvoidAreas([{ ...none, left: 177 }, { ...none, bottom: 63 }], 3);
  assert.equal(i.left, 59);
  assert.equal(i.right, 0);
  assert.equal(i.bottom, 21);
});

test("no areas and a zero density give no insets", () => {
  assert.deepEqual(mergeAvoidAreas([], 3), NO_INSETS);
  assert.deepEqual(mergeAvoidAreas([{ ...none, top: 10 }], 0), { top: 10, bottom: 0, left: 0, right: 0 });
});

test("max(base, inset) as web", () => {
  assert.equal(atLeast(14, 32), 32);
  assert.equal(atLeast(14, 0), 14);
  assert.equal(atLeast(8, 21), 21);
});
