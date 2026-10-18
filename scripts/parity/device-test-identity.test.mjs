import test from "node:test";
import assert from "node:assert/strict";
import { hasApprovedDeviceTestIdentity } from "./device-test-identity.mjs";

test("accepts only a launch username matching a configured Device Test identity", () => {
  assert.equal(hasApprovedDeviceTestIdentity({ PLAYARR_DEVICE_TEST_USERNAME: "test-user" }, "test-user"), true);
  assert.equal(hasApprovedDeviceTestIdentity({ PLAYARR_DEVICE_TEST_DPAD_USERNAME: "dpad-user" }, "dpad-user"), true);
  assert.equal(hasApprovedDeviceTestIdentity({ PLAYARR_DEVICE_TEST_USERNAME: "test-user" }, "other-user"), false);
  assert.equal(hasApprovedDeviceTestIdentity({}, "test-user"), false);
  assert.equal(hasApprovedDeviceTestIdentity({ PLAYARR_DEVICE_TEST_USERNAME: "" }, ""), false);
});
