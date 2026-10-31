#!/usr/bin/env node
// Where the mismatching pixels are: clusters.mjs <ref.png> <cand.png> [bandPx=100]. Prints mismatch counts per horizontal band
// and per 100 px column band, plus the share on rows/columns (so geometry shifts show as thin lines, glyph noise as blobs).
import { readFileSync } from "node:fs";
import pngjs from "pngjs";
import { diffInto } from "../exact-pixels.mjs";
const { PNG } = pngjs;
const [a, b] = process.argv.slice(2, 4).map((f) => PNG.sync.read(readFileSync(f)));
const band = +(process.argv[4] ?? 100);
const out = new PNG({ width: a.width, height: a.height });
const bad = diffInto(a.data, b.data, out.data, a.width, a.height);
const rows = new Array(Math.ceil(a.height / band)).fill(0), cols = new Array(Math.ceil(a.width / band)).fill(0);
for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) { const o = (y * a.width + x) * 4; if (out.data[o] === 255 && out.data[o + 1] === 0) { rows[Math.floor(y / band)]++; cols[Math.floor(x / band)]++; } }
console.log("total", bad, ((100 * bad) / (a.width * a.height)).toFixed(2) + "%");
console.log("rows", rows.map((n, i) => `${i * band}:${n}`).join(" "));
console.log("cols", cols.map((n, i) => `${i * band}:${n}`).join(" "));
