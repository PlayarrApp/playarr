import test from "node:test";
import assert from "node:assert/strict";
import { signedInProfileProbe, verifiedDeviceTestUser } from "./account-identity.mjs";
import { serializeSteps } from "./route-readiness.mjs";

test("accepts only the expected device-test identity returned by the signed-in app", () => {
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test", "device-test"), true);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test-dpad", "device-test-dpad"), true);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 configured-sailfish-test", "configured-sailfish-test"), true);
});

test("rejects absent, failed, unexpected, and non-test account responses", () => {
  assert.equal(verifiedDeviceTestUser("", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 401 device-test", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 someone-else", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 someone-else", undefined), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test-dpad", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 device-test@other", "device-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 configured-sailfish-test-extra", "configured-sailfish-test"), false);
  assert.equal(verifiedDeviceTestUser("PARITY_SIGNED_IN_USER 200 configured-sailfish-test", "configured sailfish test"), false);
});

test("signed-in profile probe serializes as a valid Sailfish step", () => {
  const probe = signedInProfileProbe();
  assert.ok(!probe.includes("|"));
  assert.deepEqual(serializeSteps("light", ["wait", probe]).split("|"), ["js:Api.themeMode='light'", "wait", probe]);
  assert.match(probe, /Array\.isArray\(p\)\?p:\[\]/);
  assert.match(probe, /x\.is_current===true/);
});
