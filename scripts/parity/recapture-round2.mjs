#!/usr/bin/env node
// One command for a web-reference recapture window (parity round 2): seed the canonical deck inside capture-refs' isolated state
// transaction, then capture ALL web refs
// (tv, tv without Downloads for Roku, ipad, android-tablet, iphone, android-phone, harmony-phone, sailfish, nura) from the deployed web
// build in one run, and record that build's sha in every refs folder's web/build.json. Stops if the web build lacks origin/main's web client.
//   node recapture-round2.mjs [--dry] [--parity-root <dir>] [--work <dir>] [extra capture-refs.mjs flags]
// --dry only prints the plan (no login, no browser). Env: PARITY_ROOT and PARITY_WORK unless --parity-root / --work are given;
// non-dry runs also require PARITY_CLIENT, PARITY_LOCK_DIR, and PARITY_DECK_MEDIA_FILE_ID.
// Heavy (Chromium): run it as
//   flock <heavy lock> systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M node recapture-round2.mjs
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const need = (n) => process.env[n] || (() => { throw new Error(`${n} is required`); })();
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const has = (n) => args.includes(`--${n}`);
const rest = [...(has("parity-root") ? [] : ["--parity-root", need("PARITY_ROOT")]), ...(has("work") ? [] : ["--work", need("PARITY_WORK")]), ...args];
if (!dry && (!process.env.PARITY_CLIENT || !process.env.PARITY_LOCK_DIR)) throw new Error("PARITY_CLIENT, PARITY_LOCK_DIR are required for an isolated canonical-deck recapture");
if (!dry) {
  process.env.PARITY_SEED_CANONICAL = "1";
  process.env.PARITY_DECK_MEDIA_FILE_ID ??= need("PARITY_DECK_MEDIA_FILE_ID");
}
console.log(`$ node ${join(here, "capture-refs.mjs")} ${rest.join(" ")}`);
execFileSync("node", [join(here, "capture-refs.mjs"), ...rest], { stdio: "inherit", env: process.env });
