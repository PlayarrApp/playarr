import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertCaptureManifestTargetAvailable, buildShaFromIdentity, createCaptureManifest, sameCaptureBuildIdentity } from "./capture-manifest.mjs";
import { assertBuildIdentityStable, selectedLiveScreens, shouldStampReferenceBuild } from "./capture-refs-contract.mjs";
import { mergeSelectedCaptures } from "./selective-captures.mjs";

const sha = "a".repeat(40);
const builtAt = "2026-10-16T00:00:00.000Z";
const checkedAt = "2026-10-16T01:00:00.000Z";

test("capture manifest records selected screen/theme hashes with the web SHA", () => {
  const bytes = Buffer.from("deterministic png bytes");
  const manifest = createCaptureManifest({ suite: 4, buildIdentity: `${sha}@${builtAt}`, clock: builtAt, state: "state-hash", checkedAt,
    captures: [{ id: "home", theme: "dark", path: "dark/home.png", bytes, capturedAt: checkedAt }] });
  assert.deepEqual(manifest, {
    suite: 4,
    checked_at: checkedAt,
    provenance: { suite: 4, build: sha, clock: builtAt, state: "state-hash", readiness: "strict" },
    captures: [{ id: "home", theme: "dark", path: "dark/home.png", sha256: createHash("sha256").update(bytes).digest("hex"), build: sha, checked_at: checkedAt }],
  });
});

test("capture manifest rejects unverified builds, unsafe paths, and duplicate coverage", () => {
  assert.equal(buildShaFromIdentity(`${sha}@${builtAt}`), sha);
  assert.equal(buildShaFromIdentity({ package: "example.app", sha256: sha }), sha);
  assert.equal(sameCaptureBuildIdentity({ sha256: sha }, { sha256: sha }), true);
  assert.throws(() => buildShaFromIdentity("unknown-build"), /verified capture build identity/);
  const base = { id: "home", theme: "dark", path: "dark/home.png", bytes: Buffer.from("png"), capturedAt: checkedAt };
  const create = (captures) => createCaptureManifest({ suite: 4, buildIdentity: `${sha}@${builtAt}`, clock: builtAt, state: "state", captures, checkedAt });
  assert.throws(() => create([{ ...base, path: "../home.png" }]), /safe POSIX-relative/);
  assert.throws(() => create([base, base]), /duplicate coverage/);
});

test("reference build stamp is withheld when a group retains out-of-band live screens", () => {
  assert.equal(shouldStampReferenceBuild({ partial: false, liveScreens: [] }), true);
  assert.equal(shouldStampReferenceBuild({ partial: false, liveScreens: ["player-controls"] }), false);
  assert.equal(shouldStampReferenceBuild({ partial: true, liveScreens: [] }), false);
});

test("stable captures require a fresh manifest directory", () => {
  assert.doesNotThrow(() => assertCaptureManifestTargetAvailable(true, false));
  assert.throws(() => assertCaptureManifestTargetAvailable(true, true), /choose a fresh output directory/);
  assert.throws(() => assertCaptureManifestTargetAvailable(false, true), /full capture output already has captures.json/);
});

test("reference capture rejects requested live screens and detects build changes", () => {
  const groups = { tv: { liveScreens: ["player-controls"] }, phone: {} };
  assert.deepEqual(selectedLiveScreens(["home", "player-controls"], ["phone"], groups), []);
  assert.deepEqual(selectedLiveScreens(["home", "player-controls"], ["tv"], groups), ["player-controls"]);
  assert.doesNotThrow(() => assertBuildIdentityStable(`${sha}@${builtAt}`, `${sha}@${builtAt}`, "deployed web"));
  assert.throws(() => assertBuildIdentityStable(`${sha}@${builtAt}`, `${"b".repeat(40)}@${builtAt}`, "deployed web"), /build identity changed during capture/);
});

test("producer manifest is accepted by the receipt-gated selective merge contract", () => {
  const oldBytes = Buffer.from("previous home"), untouchedBytes = Buffer.from("previous library"), incomingBytes = Buffer.from("incoming home");
  const previous = {
    suite: 4,
    checked_at: checkedAt,
    provenance: { suite: 4, build: sha, clock: builtAt, state: "state-hash", readiness: "strict" },
    captures: [
      { id: "home", theme: "dark", path: "dark/home.png", sha256: createHash("sha256").update(oldBytes).digest("hex"), build: sha, checked_at: checkedAt },
      { id: "library", theme: "dark", path: "dark/library.png", sha256: createHash("sha256").update(untouchedBytes).digest("hex"), build: sha, checked_at: checkedAt },
    ],
  };
  const incoming = createCaptureManifest({ suite: 4, buildIdentity: `${sha}@${builtAt}`, clock: builtAt, state: "state-hash", checkedAt,
    captures: [{ id: "home", theme: "dark", path: "dark/home.png", bytes: incomingBytes, capturedAt: checkedAt }] });
  const merged = mergeSelectedCaptures({ previous, incoming, selectedIds: ["home"], allIds: ["home", "library"], themes: ["dark"],
    previousFiles: new Map([["dark/home.png", oldBytes], ["dark/library.png", untouchedBytes]]), incomingFiles: new Map([["dark/home.png", incomingBytes]]) });
  assert.deepEqual(merged.plan.map(({ id, action }) => [id, action]), [["home", "replace"], ["library", "keep"]]);
  assert.equal(merged.manifest.captures[0].sha256, createHash("sha256").update(incomingBytes).digest("hex"));
  assert.deepEqual(merged.files.get("dark/home.png"), incomingBytes);
});
