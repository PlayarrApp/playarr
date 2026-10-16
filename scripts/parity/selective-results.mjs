const PROVENANCE_FIELDS = ["suite", "build", "clock", "state", "stable", "referenceSha256"];

function validateProvenance(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} provenance must be an object`);
  }
  if (!((typeof value.suite === "number" && Number.isFinite(value.suite))
      || (typeof value.suite === "string" && value.suite.trim()))) {
    throw new Error(`${label} provenance.suite must be a non-empty string or finite number`);
  }
  for (const field of ["build", "clock", "state", "referenceSha256"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`${label} provenance.${field} must be a non-empty string`);
    }
  }
  if (typeof value.stable !== "boolean") throw new Error(`${label} provenance.stable must be a boolean`);
  return value;
}

function validateTimestamp(value, label) {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a parseable ISO timestamp`);
  }
}

function validateUniqueIds(ids, label) {
  if (!Array.isArray(ids)) throw new Error(`${label} must be an array of IDs`);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error(`${label} must contain non-empty string IDs`);
  }
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate IDs`);
}

function validateResultList(results, label, { requireTimestamps = false } = {}) {
  if (!Array.isArray(results)) throw new Error(`${label} results must be an array`);
  const ids = results.map((result) => result?.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error(`${label} results must contain objects with non-empty string IDs`);
  }
  if (new Set(ids).size !== ids.length) throw new Error(`${label} results contain duplicate IDs`);
  if (requireTimestamps) results.forEach((result, index) => validateTimestamp(result.checked_at, `${label} results[${index}].checked_at`));
  return ids;
}

function passedCount(results) {
  return results.reduce((count, result) => count + (result.pass === true ? 1 : 0), 0);
}

export function mergeSelectedResults({ previous, results, selectedIds, allIds, stamp, provenance, regressionReason }) {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    throw new Error("previous result must be an object");
  }
  if (!stamp || typeof stamp !== "object") throw new Error("stamp must be an object");
  validateTimestamp(stamp.checked_at, "stamp.checked_at");
  validateTimestamp(previous.checked_at, "previous checked_at");

  validateUniqueIds(allIds, "allIds");
  validateUniqueIds(selectedIds, "selectedIds");
  if (selectedIds.length === 0) throw new Error("selectedIds must not be empty");
  const knownIds = new Set(allIds);
  const unknownSelected = selectedIds.filter((id) => !knownIds.has(id));
  if (unknownSelected.length) throw new Error(`selectedIds contains unknown ID(s): ${unknownSelected.join(", ")}`);

  const priorIds = validateResultList(previous.results, "previous", { requireTimestamps: true });
  const priorSet = new Set(priorIds);
  const missingPrior = allIds.filter((id) => !priorSet.has(id));
  const unknownPrior = priorIds.filter((id) => !knownIds.has(id));
  if (missingPrior.length || unknownPrior.length) {
    throw new Error(`previous results must cover allIds exactly (missing: ${missingPrior.join(", ") || "none"}; unknown: ${unknownPrior.join(", ") || "none"})`);
  }

  const resultIds = validateResultList(results, "selected");
  const selectedSet = new Set(selectedIds);
  const missingSelected = selectedIds.filter((id) => !resultIds.includes(id));
  const extraResults = resultIds.filter((id) => !selectedSet.has(id));
  if (missingSelected.length || extraResults.length) {
    throw new Error(`selected results must cover selectedIds exactly (missing: ${missingSelected.join(", ") || "none"}; extra: ${extraResults.join(", ") || "none"})`);
  }

  const priorProvenance = validateProvenance(previous.provenance, "previous");
  const suppliedProvenance = validateProvenance(provenance, "supplied");
  for (const field of PROVENANCE_FIELDS) {
    if (priorProvenance[field] !== suppliedProvenance[field]) {
      throw new Error(`provenance mismatch for ${field}: previous and supplied values must match`);
    }
  }
  if (previous.suite !== suppliedProvenance.suite) {
    throw new Error("suite mismatch between previous result and supplied provenance");
  }

  const priorById = new Map(previous.results.map((result) => [result.id, result]));
  const selectedById = new Map(results.map((result) => [result.id, { ...result, checked_at: stamp.checked_at }]));
  const mergedResults = allIds.map((id) => selectedById.get(id) ?? priorById.get(id));
  if (passedCount(mergedResults) < passedCount(previous.results)
      && !(typeof regressionReason === "string" && regressionReason.trim())) {
    throw new Error("merged pass count is lower than previous pass count; provide a non-empty regressionReason to acknowledge the regression");
  }

  const acknowledgedReason = typeof regressionReason === "string" ? regressionReason.trim() : "";
  return {
    ...previous,
    checked_at: stamp.checked_at,
    results: mergedResults,
    ...(acknowledgedReason ? { regressionReason: acknowledgedReason } : {}),
  };
}
