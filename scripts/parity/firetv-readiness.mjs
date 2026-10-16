/** Compare two independently captured display frames. ImageMagick returns exit 1 for a non-zero difference. */
export async function framesMatch(compare, before, after) {
  try {
    await compare(before, after);
    return true;
  } catch (error) {
    if (error?.code !== 1 || error?.killed || error?.signal) return false;
    const metric = String(error?.stderr ?? "").trim().split(/\s+/)[0];
    if (!/^\d+$/.test(metric)) return false;
    const difference = Number(metric);
    return Number.isFinite(difference) && difference <= 4;
  }
}

/** Return a different frame path for every adjacent display sample. */
export function frameNameAt(index, prefix = "frame") {
  if (!Number.isSafeInteger(index) || index < 0 || !/^[a-z0-9-]+$/i.test(prefix)) throw new Error("invalid frame sample");
  return `${prefix}-${index % 2 ? "b" : "a"}.png`;
}

/** Return only a configured account key label after the caller verifies the identity itself. */
export function selectDeviceTestAccount(identity, secrets, selector) {
  const candidates = {
    "device-test": secrets?.PLAYARR_DEVICE_TEST_USERNAME,
    "device-test-dpad": secrets?.PLAYARR_DEVICE_TEST_DPAD_USERNAME,
  };
  if (selector && !Object.hasOwn(candidates, selector)) throw new Error("unknown device-test account selector");
  if (selector && !candidates[selector]) throw new Error("selected device-test account is not configured");
  const selected = Object.entries(candidates).find(([, username]) => username && identity?.username === username)?.[0] ?? null;
  if (!selected) throw new Error("current identity does not match a configured device-test account");
  if (selector && selected !== selector) throw new Error("current identity does not match the selected device-test account");
  return selected;
}

/** Capture alternating files and return only after two distinct samples match. */
export async function waitForStableFrames({ capture, compare, sleep, now = Date.now, maxMs = 8000, intervalMs = 400, prefix = "frame" }) {
  const deadline = now() + maxMs;
  let sample = 0;
  let before = await capture(frameNameAt(sample, prefix));
  sample += 1;
  while (now() < deadline) {
    await sleep(intervalMs);
    const after = await capture(frameNameAt(sample, prefix));
    sample += 1;
    if (await framesMatch(compare, before, after)) return {before, after};
    before = after;
  }
  throw new Error("display did not settle before the capture timeout");
}
