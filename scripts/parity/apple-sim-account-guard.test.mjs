import test from "node:test";
import assert from "node:assert/strict";
import { assertParityStateIdentity } from "./drivers/apple-sim.mjs";

const expected = "device-test-user-id";
const launchedAt = 100;

test("Apple parity state accepts the verified account with a fresh post-launch timestamp", () => {
  assert.equal(assertParityStateIdentity({ userID: expected, at: 101 }, expected, launchedAt, 102), true);
});

test("Apple parity state rejects a different signed-in account", () => {
  assert.throws(() => assertParityStateIdentity({ userID: "other-user-id", at: 101 }, expected, launchedAt, 102), /does not match/);
});

test("Apple parity state rejects missing, stale, and pre-launch identity records", () => {
  assert.throws(() => assertParityStateIdentity({}, expected, launchedAt, 102), /not fresh/);
  assert.throws(() => assertParityStateIdentity({ userID: expected, at: 80 }, expected, launchedAt, 102), /not fresh/);
  assert.throws(() => assertParityStateIdentity({ userID: expected, at: 101 }, expected, launchedAt, 122), /not fresh/);
});
