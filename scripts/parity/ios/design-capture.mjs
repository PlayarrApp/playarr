#!/usr/bin/env node
// Design report capture (design-report/SCREENS-ALL.md) of the iOS screens the shared suite does not list, run on the hosted
// macOS runner next to suite-run.mjs: node ios/design-capture.mjs --out <dir> --theme dark|light [--screens a,b]
// Writes <out>/<theme>/<screen>.png straight from the simulator, plus design-<theme>.json with the per-screen result.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDriver } from "../drivers/apple-ios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback = "") => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const out = arg("out"), theme = arg("theme");
if (!out || !["dark", "light"].includes(theme)) throw new Error("usage: design-capture.mjs --out <dir> --theme dark|light [--screens a,b]");
const table = JSON.parse(readFileSync(join(here, "design-screens.json"), "utf8")).captured;
const wanted = arg("screens").split(",").filter(Boolean);
const unknown = wanted.filter((id) => !table[id]);
if (unknown.length) throw new Error(`unknown design screens: ${unknown.join(", ")}`);
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
const fixture = suite.performance?.[0]?.file;
const ids = wanted.length ? wanted : Object.keys(table);

const driver = await createDriver();
await driver.start();
await driver.setTheme(theme);
mkdirSync(join(out, theme), { recursive: true });
const results = {};
for (const id of ids) {
  const entry = table[id];
  const file = join(out, theme, `${id}.png`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await driver.design(file, {
        native: entry.native.replace("{fixture}", fixture),
        extra: entry.play ? ["--playarr-parity-play", fixture] : [],
        player: entry.play === true,
        signedOut: entry.signedOut === true,
      });
      results[id] = { ok: true };
      console.log(`ok ${theme} ${id}`);
      break;
    } catch (error) {
      results[id] = { ok: false, error: String(error.message).split("\n")[0] };
      console.log(`FAIL ${theme} ${id} (attempt ${attempt}): ${results[id].error}`);
    }
  }
}
writeFileSync(join(out, `design-${theme}.json`), `${JSON.stringify(results, null, 2)}\n`);
await driver.stop();
const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([id]) => id);
console.log(`captured ${ids.length - failed.length}, failed ${failed.length}${failed.length ? `: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
