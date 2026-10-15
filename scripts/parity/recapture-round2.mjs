#!/usr/bin/env node
// One command for a web-reference recapture window (parity round 2): reset the shared Device Test deck, then capture ALL web refs
// (tv, tv without Downloads for Roku, ipad, android-tablet, iphone, android-phone, harmony-phone, sailfish, nura) from the deployed web
// build in one run, and record that build's sha in every refs folder's web/build.json. Stops if the web build lacks origin/main's web client.
//   node recapture-round2.mjs [--dry] [--parity-root <dir>] [--work <dir>] [extra capture-refs.mjs flags]
// --dry only prints the plan (no login, no browser). Env (no defaults): RESET_DECK_SCRIPT = path of reset-deck-canonical.mjs; PARITY_ROOT and PARITY_WORK unless --parity-root / --work are given.
// Heavy (Chromium): run it as
//   flock <heavy lock> systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M node recapture-round2.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const need = (n) => process.env[n] || (() => { throw new Error(`${n} is required`); })();
const reset = need("RESET_DECK_SCRIPT");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const has = (n) => args.includes(`--${n}`);
const rest = [...(has("parity-root") ? [] : ["--parity-root", need("PARITY_ROOT")]), ...(has("work") ? [] : ["--work", need("PARITY_WORK")]), ...args];
if (!existsSync(reset)) throw new Error(`reset script not found: ${reset} (RESET_DECK_SCRIPT)`);
// Self-check: capture-refs zeroes progress on the suite's pinned files, which must not include the title the deck reset keeps on Home (On deck).
const deckFile = readFileSync(reset, "utf8").match(/FILM_FILE = "([^"]+)"/)?.[1];
const suiteText = readFileSync(join(here, "suite.json"), "utf8");
if (!deckFile) throw new Error("FILM_FILE not found in the deck reset script");
if (suiteText.includes(deckFile)) throw new Error(`suite.json pins ${deckFile}: capture-refs would zero the On deck title; run the deck reset after its reset step`);
const run = (file, a) => { console.log(`$ node ${file} ${a.join(" ")}`); execFileSync("node", [file, ...a], { stdio: "inherit" }); };
run(reset, dry ? ["--dry"] : []);
run(join(here, "capture-refs.mjs"), rest);
