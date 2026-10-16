#!/usr/bin/env node
// Web reference sets are captured once per viewport group and copied to every client dir the group lists
// (web-refs.json). A dir whose copy differs from its group's first dir has drifted: someone recaptured or edited
// it alone (another clock, deck state or text rendering), so that client is scored against a different reference
// than its peers on the same build.
//
//   node ref-copies.mjs <parity root> [--manifest web-refs.json]
//
// Prints one line per drifted file and exits 1 if any exists.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const digest = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null);

/** Files (dark and light) where a group dir differs from the group's first dir, or is missing. */
export function findDriftedCopies(root, manifest) {
  const drifted = [];
  for (const [group, { dirs }] of Object.entries(manifest.groups)) {
    const [first, ...rest] = dirs;
    for (const theme of ["", "light"]) {
      for (const id of manifest.screens) {
        const want = digest(join(root, first, "web", theme, `${id}.png`));
        if (!want) continue;
        for (const dir of rest) {
          if (digest(join(root, dir, "web", theme, `${id}.png`)) !== want) drifted.push({ group, dir, theme: theme || "dark", screen: id });
        }
      }
    }
  }
  return drifted;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [root] = process.argv.slice(2);
  const mi = process.argv.indexOf("--manifest");
  if (!root) { console.error("usage: ref-copies.mjs <parity root> [--manifest web-refs.json]"); process.exit(2); }
  const manifest = JSON.parse(readFileSync(mi >= 0 ? process.argv[mi + 1] : join(here, "web-refs.json"), "utf8"));
  const drifted = findDriftedCopies(root, manifest);
  for (const d of drifted) console.log(`DRIFT ${d.group} ${d.dir} ${d.theme} ${d.screen}`);
  process.exit(drifted.length ? 1 : 0);
}
