import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertCaptureState, assertResetProfile, assertScreenshotFile } from "./drivers/apple-ios.mjs";

const ready = {
  signedIn: true,
  identityVerified: true,
  authenticatedUsername: "device-test",
  directPlay: true,
  screenContentReady: true,
  animationsDisabled: true,
  frozenNow: "2026-10-14T12:00:00Z",
};

test("iOS capture gates require verified identity, loaded content and direct-play evidence", () => {
  assert.doesNotThrow(() => assertCaptureState(ready, "Device-Test", { player: true, deterministic: true, fixedNow: "2026-10-14T12:00:00Z" }));
  for (const [key, value] of [["signedIn", false], ["identityVerified", false], ["screenContentReady", false], ["directPlay", false], ["animationsDisabled", false]]) {
    assert.throws(() => assertCaptureState({ ...ready, [key]: value }, "device-test", { player: key === "directPlay", deterministic: key === "animationsDisabled", fixedNow: "2026-10-14T12:00:00Z" }));
  }
  assert.throws(() => assertCaptureState({ ...ready, frozenNow: "2026-10-13T12:00:00Z" }, "device-test", { deterministic: true, fixedNow: "2026-10-14T12:00:00Z" }), /fixed capture clock/);
  assert.throws(() => assertCaptureState({ ...ready, authenticatedUsername: "another-user" }, "device-test"), /DEVICE_TEST_USERNAME/);
  assert.throws(() => assertCaptureState({ ...ready, failure: "identity-mismatch" }, "device-test"), /identity-mismatch/);
  assert.throws(() => assertCaptureState({ ...ready, authenticatedUsername: undefined }, "device-test"), /DEVICE_TEST_USERNAME/);
});

test("progress reset accepts only the exact authenticated current Device Test profile", () => {
  const profiles = [
    { id: "profile-a", username: "device-test", is_current: true },
    { id: "profile-b", username: "other-test", is_current: false },
  ];
  assert.doesNotThrow(() => assertResetProfile(profiles, "PROFILE-A", "Device-Test"));
  assert.throws(() => assertResetProfile(profiles, "profile-b", "device-test"), /reset refused/);
  assert.throws(() => assertResetProfile([{ ...profiles[0] }, { ...profiles[0] }], "profile-a", "device-test"), /reset refused/);
  assert.throws(() => assertResetProfile([{ ...profiles[0], username: "other-test" }], "profile-a", "device-test"), /reset refused/);
  assert.throws(() => assertResetProfile(profiles, undefined, "device-test"), /reset refused/);
  assert.throws(() => assertResetProfile({ profiles }, "profile-a", "device-test"), /invalid data/);
});

test("iOS screenshot guard accepts only existing frames at least 20 KB", () => {
  const scratchRoot = process.env.PLAYARR_PARITY_TEST_OUT;
  assert.ok(scratchRoot, "PLAYARR_PARITY_TEST_OUT must point to task-scoped .data scratch space");
  const scratch = mkdtempSync(join(scratchRoot, "ios-frame-check-"));
  const good = join(scratch, "good.png"), small = join(scratch, "small.png");
  writeFileSync(good, Buffer.alloc(20000));
  writeFileSync(small, Buffer.alloc(19999));
  assert.doesNotThrow(() => assertScreenshotFile(good));
  assert.throws(() => assertScreenshotFile(small), /empty frame/);
  assert.throws(() => assertScreenshotFile(join(scratch, "missing.png")), /empty frame/);
});
