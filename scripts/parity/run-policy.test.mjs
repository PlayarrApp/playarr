import test from "node:test";
import assert from "node:assert/strict";
import { dpadAttempts, routeAttempts } from "./run-policy.mjs";

test("fail-fast acceptance runs never retry routes or D-pad checks", () => {
  assert.equal(routeAttempts({ failFast: true }), 1);
  assert.equal(dpadAttempts({ failFast: true, reference: true }), 1);
  assert.equal(dpadAttempts({ failFast: true, reference: false }), 1);
});

test("routine and reference runs retain their existing retry budgets", () => {
  assert.equal(routeAttempts({ failFast: false }), 2);
  assert.equal(dpadAttempts({ failFast: false, reference: false }), 3);
  assert.equal(dpadAttempts({ failFast: false, reference: true }), 5);
});
