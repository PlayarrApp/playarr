#!/usr/bin/env node
// Score Android phone/tablet captures against the web refs the way the wall legend does (pixelmatch threshold 0.1, anti-aliased
// pixels ignored, parity % = 100 - mismatch %).   score.mjs <ref-dir> <cand-dir> [--json out.json] [--heat <dir>]
// <cand-dir> holds dark/<screen>.png and light/<screen>.png. A size mismatch scores null.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pngjs from "pngjs";
import pixelmatch from "pixelmatch";
const { PNG } = pngjs;
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const [refDir, candDir] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const out = {};
for (const theme of ["dark", "light"]) {
  const r = theme === "dark" ? refDir : join(refDir, "light"), c = join(candDir, theme);
  if (!existsSync(c)) continue;
  for (const f of readdirSync(c).filter((n) => n.endsWith(".png")).sort()) {
    const id = f.slice(0, -4);
    if (!existsSync(join(r, f))) { (out[id] ??= {})[theme] = null; continue; }
    let a, b;
    try { a = PNG.sync.read(readFileSync(join(r, f))); b = PNG.sync.read(readFileSync(join(c, f))); } catch { (out[id] ??= {})[theme] = null; continue; }
    if (a.width !== b.width || a.height !== b.height) { (out[id] ??= {})[theme] = null; continue; }
    const diff = opt("heat") ? new PNG({ width: a.width, height: a.height }) : null;
    const bad = pixelmatch(a.data, b.data, diff?.data ?? null, a.width, a.height, { threshold: 0.1 });
    (out[id] ??= {})[theme] = +(100 - (100 * bad) / (a.width * a.height)).toFixed(3);
    if (diff) { mkdirSync(join(opt("heat"), theme), { recursive: true }); writeFileSync(join(opt("heat"), theme, f), PNG.sync.write(diff)); }
  }
}
const mean = (t) => { const v = Object.values(out).map((s) => s[t]).filter((x) => x != null); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(3) : null; };
const result = { screens: out, dark: mean("dark"), light: mean("light") };
if (opt("json")) writeFileSync(opt("json"), JSON.stringify(result, null, 1) + "\n");
for (const [id, s] of Object.entries(out)) console.log(id.padEnd(18), String(s.dark ?? "-").padStart(8), String(s.light ?? "-").padStart(8));
console.log("mean".padEnd(18), String(result.dark).padStart(8), String(result.light).padStart(8));
