const DEVICE_TEST_USER = /^device-test(?:-dpad)?$/i;

/** Parse the signed-in app's current profile; token presence is not identity proof. */
export function verifiedDeviceTestUser(log, expected) {
  if (!expected || !DEVICE_TEST_USER.test(expected)) return false;
  const match = String(log).match(/PARITY_SIGNED_IN_USER\s+200\s+(\S+)/);
  return Boolean(match && DEVICE_TEST_USER.test(match[1]) && match[1] === expected);
}
