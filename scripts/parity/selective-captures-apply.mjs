#!/usr/bin/env node
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeSelectedCaptures } from "./selective-captures.mjs";

function within(root, relative) {
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`capture path escapes its folder: ${relative}`);
  return path;
}

function readCaptureBytes(root, manifest) {
  return new Map(manifest.captures.map((capture) => [capture.path, readFileSync(within(root, capture.path))]));
}

export function applySelectedCaptures({ previousDir, incomingDir, selectedIds, allIds, themes, apply = false, reviewReceiptPath, installRename = renameSync }) {
  const previousRoot = resolve(previousDir), incomingRoot = resolve(incomingDir);
  const previousManifestPath = joinPath(previousRoot, "captures.json"), incomingManifestPath = joinPath(incomingRoot, "captures.json");
  const previousBytes = readFileSync(previousManifestPath), incomingBytes = readFileSync(incomingManifestPath);
  const previous = JSON.parse(previousBytes), incoming = JSON.parse(incomingBytes);
  let receipt = null;
  if (apply) {
    if (!reviewReceiptPath) throw new Error("--apply requires --review-receipt from update.mjs --review-selective");
    receipt = JSON.parse(readFileSync(reviewReceiptPath, "utf8"));
    const ids = [...selectedIds].sort();
    if (receipt.previousManifestSha256 !== createHash("sha256").update(previousBytes).digest("hex") || receipt.incomingManifestSha256 !== createHash("sha256").update(incomingBytes).digest("hex")) throw new Error("review receipt does not match these previous and incoming manifests");
    if (JSON.stringify(receipt.selected) !== JSON.stringify(ids)) throw new Error("review receipt selected IDs do not match this merge");
    if (!Array.isArray(receipt.changes) || receipt.changes.some((change) => change.dropped) && !(typeof receipt.regressionReason === "string" && receipt.regressionReason.trim())) throw new Error("review receipt has an unacknowledged parity regression");
  }
  const result = mergeSelectedCaptures({ previous, incoming, selectedIds, allIds, themes,
    previousFiles: readCaptureBytes(previousRoot, previous), incomingFiles: readCaptureBytes(incomingRoot, incoming), dryRun: !apply, regressionReason: receipt?.regressionReason });
  if (apply) {
    const nonce = randomUUID();
    const staged = [];
    const installed = [];
    const manifestTarget = joinPath(previousRoot, "captures.json");
    const manifestStage = `${manifestTarget}.${nonce}.stage`;
    const manifestBackup = `${manifestTarget}.${nonce}.backup`;
    try {
      for (const [relative, bytes] of result.files) {
        const target = within(previousRoot, relative);
        const info = lstatSync(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`capture target must be a regular file: ${relative}`);
        mkdirSync(dirname(target), { recursive: true });
        const stage = `${target}.${nonce}.stage`;
        const backup = `${target}.${nonce}.backup`;
        writeFileSync(stage, bytes);
        writeFileSync(backup, readFileSync(target), { mode: info.mode & 0o777 });
        chmodSync(backup, info.mode & 0o777);
        utimesSync(backup, info.atime, info.mtime);
        staged.push({ stage, backup, target });
      }
      writeFileSync(manifestStage, `${JSON.stringify(result.manifest, null, 2)}\n`);
      const manifestInfo = lstatSync(manifestTarget);
      if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error("capture manifest target must be a regular file");
      writeFileSync(manifestBackup, previousBytes, { mode: manifestInfo.mode & 0o777 });
      chmodSync(manifestBackup, manifestInfo.mode & 0o777);
      utimesSync(manifestBackup, manifestInfo.atime, manifestInfo.mtime);
      for (const file of staged) {
        installRename(file.stage, file.target);
        installed.push(file);
      }
      // Publish the manifest last. Until then, a partial file replacement cannot be trusted by the wall.
      installRename(manifestStage, manifestTarget);
    } catch (error) {
      const rollbackErrors = [];
      const recoveryBackups = new Set();
      for (const file of installed.reverse()) {
        try { renameSync(file.backup, file.target); } catch (rollbackError) { rollbackErrors.push(rollbackError); recoveryBackups.add(file.backup); }
      }
      for (const file of staged) {
        try { unlinkSync(file.stage); } catch {}
        if (!recoveryBackups.has(file.backup)) try { unlinkSync(file.backup); } catch {}
      }
      try { unlinkSync(manifestStage); } catch {}
      try { unlinkSync(manifestBackup); } catch {}
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `selective capture install failed and rollback was incomplete; candidate requires recovery from ${[...recoveryBackups].join(", ")}`);
      throw error;
    }
    for (const file of staged) { try { unlinkSync(file.backup); } catch {} }
    try { unlinkSync(manifestBackup); } catch {}
  }
  return { ...result, files: undefined };
}

const joinPath = (root, name) => resolve(root, name);
function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") { values.apply = true; continue; }
    if (!["--previous", "--incoming", "--selected", "--all", "--themes", "--review-receipt"].includes(arg)) throw new Error(`unknown argument: ${arg}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${arg} requires a value`);
    values[arg.slice(2)] = argv[++i];
  }
  for (const key of ["previous", "incoming", "selected", "all", "themes"]) if (!values[key]) throw new Error(`missing --${key}`);
  return { previousDir: values.previous, incomingDir: values.incoming, selectedIds: values.selected.split(","), allIds: values.all.split(","), themes: values.themes.split(","), apply: Boolean(values.apply), reviewReceiptPath: values["review-receipt"] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = applySelectedCaptures(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ dryRun: result.dryRun, plan: result.plan, manifest: result.manifest }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`selective capture merge: ${error.message}\n`);
    process.exitCode = 1;
  }
}
