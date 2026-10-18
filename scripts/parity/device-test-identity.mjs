const approvedUsernameKeys = ["PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME"];

export function hasApprovedDeviceTestIdentity(environment, launchUsername) {
  if (typeof launchUsername !== "string" || launchUsername.length === 0) return false;
  return approvedUsernameKeys.some((key) => environment[key] === launchUsername);
}
