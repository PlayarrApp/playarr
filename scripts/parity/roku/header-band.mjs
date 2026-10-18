#!/usr/bin/env node
// Header-band diff for Roku against the web (docs/design/page-layout.md section 7.3, row 13.806).
//
//   node roku/header-band.mjs --ref <web-dir> --cand <roku-dir> [--screens a,b] [--max 1] [--fail]
//
// Each dir holds <id>.png (dark) and light/<id>.png (or <dark|light>/<id>.png for the suite runner's output). Compares the band
// x 140..1920, y 0..128 (header bottom + 8 px; the nav rail is left of x 140 and is masked) with the clock/date box and the
// result count and the Calendar range selector (its text is the shown week, which differs) masked, as pixelmatch threshold 0.1. Native against web is judged at the campaign's <= 1 % (rasteriser
// differences), not the web's 0 px. Prints one line per screen and theme.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const BAND = { x: 140, y: 0, w: 1780, h: 128 };
// Clock and date (they differ by wall clock) and the title's count/divider run, which web and native fill with different data.
const MASKS = [{ x: 460, y: 56, w: 200, h: 50 }, { x: 330, y: 56, w: 130, h: 50 }, { x: 1470, y: 50, w: 150, h: 62 }];
const SCREENS = ["movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "settings"];

export function bandMismatch(refPng, candPng) {
  const crop = (png) => {
    const out = new PNG({ width: BAND.w, height: BAND.h });
    PNG.bitblt(png, out, BAND.x, BAND.y, BAND.w, BAND.h, 0, 0);
    for (const m of MASKS) for (let y = m.y; y < Math.min(BAND.h, m.y + m.h); y++) for (let x = Math.max(0, m.x - BAND.x); x < Math.min(BAND.w, m.x + m.w - BAND.x); x++) out.data.fill(0, (y * BAND.w + x) * 4, (y * BAND.w + x) * 4 + 4);
    return out;
  };
  const a = crop(refPng), b = crop(candPng);
  return (100 * pixelmatch(a.data, b.data, null, BAND.w, BAND.h, { threshold: 0.1 })) / (BAND.w * BAND.h);
}

const find = (dir, theme, id) => [theme === "dark" ? join(dir, `${id}.png`) : join(dir, "light", `${id}.png`), join(dir, theme, `${id}.png`)].find(existsSync);

if (import.meta.url === `file://${process.argv[1]}`) {
  const ref = resolve(opt("ref", ""));
  const cand = resolve(opt("cand", ""));
  const max = Number(opt("max", "1"));
  const screens = opt("screens", SCREENS.join(",")).split(",");
  let worst = 0, failed = 0;
  for (const theme of ["dark", "light"]) for (const id of screens) {
    const r = find(ref, theme, id), c = find(cand, theme, id);
    if (!r || !c) { console.log(`skip ${theme} ${id}: ${!r ? "no ref" : "no candidate"}`); continue; }
    const pct = bandMismatch(PNG.sync.read(readFileSync(r)), PNG.sync.read(readFileSync(c)));
    worst = Math.max(worst, pct);
    if (pct > max) failed++;
    console.log(`${pct <= max ? "ok  " : "FAIL"} ${theme} ${id}: header band mismatch ${pct.toFixed(3)} %`);
  }
  console.log(`worst ${worst.toFixed(3)} %, ${failed} over ${max} %`);
  if (args.includes("--fail") && failed) process.exit(1);
}
