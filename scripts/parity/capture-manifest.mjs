import { createHash } from "node:crypto";

export function buildShaFromIdentity(identity) {
  if (typeof identity === "string") {
    const match = /^([0-9a-f]{40,64})@(.+)$/i.exec(identity);
    if (match && Number.isFinite(Date.parse(match[2]))) return match[1];
  }
  // Native drivers can expose a verified installed-artifact digest without a build timestamp.
  const digest = identity && typeof identity === "object" && (identity.sha256 ?? identity.sha);
  if (typeof digest === "string" && /^[0-9a-f]{40,64}$/i.test(digest)) return digest;
  throw new Error("verified capture build identity must be sha@builtAt or an artifact SHA-256");
}

export function sameCaptureBuildIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createCaptureManifest({ suite, buildIdentity, clock, state, readiness = "strict", captures, checkedAt = new Date().toISOString() }) {
  const build = buildShaFromIdentity(buildIdentity);
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("capture manifest checked_at must be an ISO timestamp");
  if (!Array.isArray(captures) || captures.length === 0) throw new Error("capture manifest requires at least one screenshot");
  const seen = new Set();
  const rows = captures.map(({ id, theme, path, bytes, capturedAt, layoutPath, layoutBytes }) => {
    if (typeof id !== "string" || !id || typeof theme !== "string" || !theme) throw new Error("capture manifest rows require screen IDs and themes");
    const key = JSON.stringify([id, theme]);
    if (seen.has(key)) throw new Error(`capture manifest contains duplicate coverage for ${id}/${theme}`);
    seen.add(key);
    if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error("capture manifest paths must be safe POSIX-relative paths");
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error(`capture manifest has no PNG bytes for ${path}`);
    if (!Number.isFinite(Date.parse(capturedAt))) throw new Error(`capture manifest has invalid checked_at for ${path}`);
    const row = { id, theme, path, sha256: createHash("sha256").update(bytes).digest("hex"), build, checked_at: capturedAt };
    // The layout document of the same screen state is bound to the screenshot by its hash (the two are taken one after the other).
    if (layoutBytes !== undefined || layoutPath !== undefined) {
      if (typeof layoutPath !== "string" || !layoutPath || layoutPath.startsWith("/") || layoutPath.includes("\\") || layoutPath.split("/").includes("..")) throw new Error("capture manifest layout paths must be safe POSIX-relative paths");
      if (!Buffer.isBuffer(layoutBytes) || !layoutBytes.length) throw new Error(`capture manifest has no layout bytes for ${layoutPath}`);
      row.layout = { path: layoutPath, sha256: createHash("sha256").update(layoutBytes).digest("hex") };
    }
    return row;
  });
  return {
    suite,
    checked_at: checkedAt,
    provenance: { suite, build, clock, state, readiness },
    captures: rows,
  };
}

export function assertCaptureManifestTargetAvailable(selective, manifestExists) {
  if (manifestExists) {
    const kind = selective ? "selective incoming" : "full capture";
    throw new Error(`${kind} output already has captures.json; choose a fresh output directory to keep prior manifest and PNG hashes intact`);
  }
}
