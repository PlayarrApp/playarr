// Replays the exporter mapping on saved raw trees and rescores, with no hosted run:
//   LEGEND_ROOT=<legend root> node scripts/parity/apple/replay.mjs <tvos|macos> [screen ...]
// Reads <dev>/layout-raw/<theme>/<screen>.json, writes <dev>/layout/<theme>/<screen>.json, scores against <ref>/web/layout.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapRaw, sampleBackgrounds } from "./layout-map.mjs";

const root = process.env.LEGEND_ROOT;
const [device, ...only] = process.argv.slice(2);
const dev = { tvos: ["apple", "apple/tvos"], macos: ["macos", "macos/dev"] }[device];
if (!root || !dev) { console.error("usage: LEGEND_ROOT=... replay.mjs <tvos|macos> [screen ...]"); process.exit(2); }
const score = join(dirname(fileURLToPath(import.meta.url)), "..", "layout-score.mjs");
let total = 0, n = 0;
for (const theme of ["dark", "light"]) {
  const rawDir = join(root, dev[1], "layout-raw", theme);
  if (!existsSync(rawDir)) continue;
  mkdirSync(join(root, dev[1], "layout", theme), { recursive: true });
  for (const file of readdirSync(rawDir).filter((f) => f.endsWith(".json")).sort()) {
    const id = file.slice(0, -5);
    if (only.length && !only.includes(id)) continue;
    const out = join(root, dev[1], "layout", theme, file);
    const mapped = mapRaw(JSON.parse(readFileSync(join(rawDir, file), "utf8")), id, theme);
    const png = join(root, dev[1], theme === "light" ? "light" : "", `${id}.png`);
    if (existsSync(png)) sampleBackgrounds(mapped, png);
    writeFileSync(out, JSON.stringify(mapped));
    const ref = join(root, dev[0], "web", "layout", theme, file);
    const line = execFileSync("node", [score, "--ref", ref, "--device", out], { encoding: "utf8" }).split("\n")[0];
    const pct = Number(/layout ([\d.]+)%/.exec(line)?.[1] ?? 0);
    total += pct; n += 1;
    console.log(line.slice(0, 90));
  }
}
if (n) console.log(`mean layout ${(total / n).toFixed(2)}% over ${n} screen captures`);
