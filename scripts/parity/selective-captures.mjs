import { createHash } from "node:crypto";

const PROVENANCE_FIELDS = ["suite", "build", "clock", "state"];

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function suiteVersion(value, label) {
  if ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim())) return value;
  throw new Error(`${label} must be a non-empty string or finite number`);
}

function isoTimestamp(value, label) {
  nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a parseable ISO timestamp`);
  }
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  values.forEach((value, index) => nonEmptyString(value, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate values`);
}

function validateProvenance(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} provenance must be an object`);
  suiteVersion(value.suite, `${label} provenance.suite`);
  for (const field of PROVENANCE_FIELDS.slice(1)) nonEmptyString(value[field], `${label} provenance.${field}`);
}

function validateManifest(manifest, label) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${label} manifest must be an object`);
  suiteVersion(manifest.suite, `${label} suite`);
  isoTimestamp(manifest.checked_at, `${label} checked_at`);
  validateProvenance(manifest.provenance, label);
  if (manifest.suite !== manifest.provenance.suite) throw new Error(`${label} suite does not match its provenance suite`);
  if (!Array.isArray(manifest.captures)) throw new Error(`${label} captures must be an array`);
}

function validateRelativePath(path, label) {
  nonEmptyString(path, label);
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) throw new Error(`${label} must be a safe relative POSIX path`);
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`${label} must be a safe relative POSIX path`);
  return path;
}

function filesMap(files, label) {
  if (files instanceof Map) return files;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error(`${label} files must be a Map or path-to-bytes object`);
  return new Map(Object.entries(files));
}

function bytesAt(files, path, label) {
  const bytes = files.get(path);
  if (!(bytes instanceof Uint8Array)) throw new Error(`${label} files are missing bytes for ${path}`);
  return bytes;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function captureKey(capture) {
  return JSON.stringify([capture.id, capture.theme]);
}

function validateCaptures(manifest, fileMap, label, ids, themes) {
  const expected = new Set(ids.flatMap((id) => themes.map((theme) => JSON.stringify([id, theme]))));
  const seen = new Set();
  const paths = new Set();
  for (let index = 0; index < manifest.captures.length; index += 1) {
    const capture = manifest.captures[index];
    const at = `${label} captures[${index}]`;
    if (!capture || typeof capture !== "object" || Array.isArray(capture)) throw new Error(`${at} must be an object`);
    nonEmptyString(capture.id, `${at}.id`);
    nonEmptyString(capture.theme, `${at}.theme`);
    if (!ids.includes(capture.id)) throw new Error(`${at} has unknown screen ID ${capture.id}`);
    if (!themes.includes(capture.theme)) throw new Error(`${at} has unknown theme ${capture.theme}`);
    const key = captureKey(capture);
    if (seen.has(key)) throw new Error(`${label} captures contain duplicate screen/theme coverage for ${capture.id}/${capture.theme}`);
    seen.add(key);
    validateRelativePath(capture.path, `${at}.path`);
    if (paths.has(capture.path)) throw new Error(`${label} captures contain duplicate path ${capture.path}`);
    paths.add(capture.path);
    if (typeof capture.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(capture.sha256)) throw new Error(`${at}.sha256 must be a 64-character hexadecimal digest`);
    nonEmptyString(capture.build, `${at}.build`);
    if (capture.build !== manifest.provenance.build) throw new Error(`${at}.build does not match ${label} provenance build`);
    isoTimestamp(capture.checked_at, `${at}.checked_at`);
    const actualHash = sha256(bytesAt(fileMap, capture.path, label));
    if (actualHash.toLowerCase() !== capture.sha256.toLowerCase()) throw new Error(`${label} SHA-256 mismatch for ${capture.path}`);
  }
  const missing = [...expected].filter((key) => !seen.has(key)).map((key) => JSON.parse(key).join("/"));
  const extra = [...seen].filter((key) => !expected.has(key)).map((key) => JSON.parse(key).join("/"));
  if (missing.length || extra.length) {
    throw new Error(`${label} captures must cover the requested screens and themes exactly (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
  }
  return paths;
}

/**
 * Build a reviewable, pure merge plan for selected screen captures. This function
 * verifies all supplied bytes but never writes files to disk.
 */
export function mergeSelectedCaptures({ previous, incoming, selectedIds, allIds, themes, previousFiles, incomingFiles, dryRun = false, regressionReason }) {
  validateManifest(previous, "previous");
  validateManifest(incoming, "incoming");
  uniqueStrings(allIds, "allIds");
  uniqueStrings(selectedIds, "selectedIds");
  uniqueStrings(themes, "themes");
  if (!selectedIds.length) throw new Error("selectedIds must not be empty");
  const all = new Set(allIds);
  const unknown = selectedIds.filter((id) => !all.has(id));
  if (unknown.length) throw new Error(`selectedIds contains unknown screen ID(s): ${unknown.join(", ")}`);
  for (const field of PROVENANCE_FIELDS) {
    if (previous.provenance[field] !== incoming.provenance[field]) {
      throw new Error(`provenance mismatch for ${field}: previous and incoming values must match`);
    }
  }
  if (incoming.buildInfo && previous.buildInfo) {
    for (const field of ["branch", "sha", "pr"]) {
      if (incoming.buildInfo[field] !== undefined && incoming.buildInfo[field] !== previous.buildInfo[field]) {
        throw new Error(`incoming buildInfo.${field} conflicts with the previous capture folder`);
      }
    }
  }

  const oldFiles = filesMap(previousFiles, "previous");
  const newFiles = filesMap(incomingFiles, "incoming");
  const oldPaths = validateCaptures(previous, oldFiles, "previous", allIds, themes);
  const newPaths = validateCaptures(incoming, newFiles, "incoming", selectedIds, themes);
  const previousByKey = new Map(previous.captures.map((capture) => [captureKey(capture), capture]));
  const incomingByKey = new Map(incoming.captures.map((capture) => [captureKey(capture), capture]));
  const selected = new Set(selectedIds);
  const captures = [];
  const plan = [];
  const files = new Map();
  const resultPaths = new Set();

  for (const id of allIds) {
    for (const theme of themes) {
      const key = JSON.stringify([id, theme]);
      const oldCapture = previousByKey.get(key);
      const replacement = selected.has(id) ? incomingByKey.get(key) : undefined;
      const capture = replacement ? { ...replacement, path: oldCapture.path } : oldCapture;
      if (!capture) throw new Error(`no capture found for ${id}/${theme}`);
      if (resultPaths.has(capture.path)) throw new Error(`merged captures contain duplicate path ${capture.path}`);
      resultPaths.add(capture.path);
      captures.push(capture);
      plan.push({
        id,
        theme,
        path: capture.path,
        action: replacement ? "replace" : "keep",
        previousSha256: oldCapture.sha256,
        nextSha256: capture.sha256,
      });
      if (!dryRun && replacement) files.set(capture.path, bytesAt(newFiles, replacement.path, "incoming"));
    }
  }

  // Inputs were verified above. Ensure no manifest path is silently dropped from its source set.
  for (const path of oldPaths) if (!oldFiles.has(path)) throw new Error(`previous files are missing bytes for ${path}`);
  for (const path of newPaths) if (!newFiles.has(path)) throw new Error(`incoming files are missing bytes for ${path}`);

  return {
    manifest: { ...previous, checked_at: incoming.checked_at, provenance: { ...incoming.provenance }, captures, selective: true,
      ...(typeof regressionReason === "string" && regressionReason.trim() ? { regressionReason: regressionReason.trim() } : {}) },
    files: dryRun ? undefined : files,
    plan,
    dryRun: Boolean(dryRun),
  };
}
