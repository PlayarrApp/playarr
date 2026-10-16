import test from "node:test";
import assert from "node:assert/strict";
import { verifiedDeviceTestUser } from "./account-identity.mjs";

test("accepts only the expected device-test identity returned by the signed-in app", () => {
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test", "device-test"), true);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test-dpad", "device-test-dpad"), true);
});

test("rejects absent, failed, unexpected, and non-test account responses", () => {
  assert.equal(verifiedDeviceTestUser("", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 401 device-test", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 someone-else", "someone-else"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test-dpad", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test@other", "device-test"), false);
});
