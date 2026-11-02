#!/usr/bin/env node
// Pre-rendered gradient layers. The runtime CSS gradients (rail frost) are dithered by every Chromium with its own ordered
// pattern (Chromium 85 on Tizen 6.5 and Chromium 151 on the web differ on ~60% of the pixels of a colour-varying
// gradient), so no CSS form is byte-equal across engines. A decoded PNG has fixed bytes, so the layer is drawn from an image.
//
// Each asset is a one-row RGBA PNG, as wide as the layer box on the 1920 stage, so it draws 1:1 (horizontal gradient: the
// row is repeated down the box; a stretched identical row stays exact). Colour is the frost colour (constant, premultiplied
// interpolation of one colour only changes alpha) and alpha is the stop ramp, so it blends over any art. Everything is
// derived from the CSS tokens in src/styles/global.css and the stop tables below (the same numbers as the CSS), never from
// screenshots. Run `node scripts/generate-gradient-assets.mjs` after changing a token or a stop; the test
// src/lib/gradientAssets.test.ts (`--check`) fails when the committed files are stale.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const css = readFileSync(join(root, "src/styles/global.css"), "utf8");
export const outDir = join(root, "src/assets/gradients");

/** Token map of the first rule block whose selector matches `selector` and which declares --surface-soft. */
function tokens(selector) {
  const re = new RegExp(`(?:^|\\n)${selector}[^{]*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(re)) {
    if (!/--surface-soft:/.test(m[1])) continue;
    const t = {};
    for (const d of m[1].matchAll(/--([a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) t[d[1]] = [0, 2, 4].map((i) => parseInt(d[2].slice(i, i + 2), 16));
    return t;
  }
  throw new Error(`no token block for ${selector}`);
}

// Mirrors `--tv-rail-frost: color-mix(in srgb, var(--surface-soft) P%, var(--surface-strong))` and the stop tables of
// .tv-home-rails / .tv-library-grid-panel / .tv-rail-surface in global.css (light, then the dark override).
const themes = {
  light: { tok: tokens(":root"), soft: 0.48, stops: [[0, 0], [0.12, 0.68], [0.34, 0.88], [0.62, 0.96], [1, 1]] },
  dark: { tok: tokens(':root\\[data-theme="dark"\\]'), soft: 0.44, stops: [[0, 0], [0.12, 0.72], [0.34, 0.9], [0.62, 0.97], [1, 1]] },
};
// Layer box widths in device px on the 1920 stage (the box is snapped to whole pixels when painted).
// 62% = Home rails, library rail surface; 65% = library grid panel. See `railWidths` in the test for the measured boxes.
export const widths = [1190, 1248];

function frost(theme) {
  const { tok, soft } = themes[theme];
  return [0, 1, 2].map((i) => soft * tok["surface-soft"][i] + (1 - soft) * tok["surface-strong"][i]);
}

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Pixel i of the ramp: the stop alpha at the pixel centre (CSS samples a gradient at the centre of each pixel). */
export function railFrostRow(theme, w) {
  const c = frost(theme).map((v) => Math.round(v));
  const { stops } = themes[theme];
  const row = Buffer.alloc(w * 4);
  for (let x = 0; x < w; x++) {
    const t = (x + 0.5) / w;
    let k = 1;
    while (k < stops.length - 1 && t > stops[k][0]) k++;
    const [t0, a0] = stops[k - 1], [t1, a1] = stops[k];
    const a = a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    row.set([c[0], c[1], c[2], Math.round(a * 255)], x * 4);
  }
  return row;
}

// .details-panel::before: `linear-gradient(90deg, transparent 0%, var(--dp-scrim) 22%, var(--dp-scrim) 80%, transparent 100%)` where
// --dp-scrim is --surface at 94%, under `mask-image: linear-gradient(180deg, transparent 0%, #000 10%, #000 90%, transparent 100%)`.
// The box is inset -14% -22% -14% -40% of the 455px panel and its 280.6px preview: 737 x 359 px on the 1920 stage. A CSS mask is
// composited through a premultiplied 8 bit surface that differs per engine (Chromium 85 vs 151 differ by one level), so both
// ramps are baked into one RGBA image (alpha = horizontal ramp * vertical ramp). Other box heights stretch the image.
export const scrimWidth = 737;
export const scrimHeight = 359;
const scrimStops = [[0, 0], [0.22, 0.94], [0.8, 0.94], [1, 0]];
const scrimMask = [[0, 0], [0.1, 1], [0.9, 1], [1, 0]];
function ramp(stops, t) {
  let k = 1;
  while (k < stops.length - 1 && t > stops[k][0]) k++;
  const [t0, a0] = stops[k - 1], [t1, a1] = stops[k];
  return a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
}
export function scrimImage(theme, w, h) {
  const c = themes[theme].tok.surface;
  const img = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = ramp(scrimMask, (y + 0.5) / h);
    for (let x = 0; x < w; x++) img.set([c[0], c[1], c[2], Math.round(ramp(scrimStops, (x + 0.5) / w) * v * 255)], (y * w + x) * 4);
  }
  return img;
}

// .calendar-agenda-fade::after (TV layout): `linear-gradient(to bottom, frost 58%, frost 22% at 45%, transparent)` over
// --page-edge-fade-size (clamp(38px, 5.5vh, 64px) = 59.4px on 1080 rows, painted as 59). One column, stretched across the width.
export const agendaFadeHeight = 59;
const fadeStops = [[0, 0.58], [0.45, 0.22], [1, 0]];
export function agendaFadeColumn(theme, h) {
  const c = frost(theme).map((v) => Math.round(v));
  const col = Buffer.alloc(h * 4);
  for (let y = 0; y < h; y++) {
    const t = (y + 0.5) / h;
    let k = 1;
    while (k < fadeStops.length - 1 && t > fadeStops[k][0]) k++;
    const [t0, a0] = fadeStops[k - 1], [t1, a1] = fadeStops[k];
    col.set([c[0], c[1], c[2], Math.round((a0 + ((a1 - a0) * (t - t0)) / (t1 - t0)) * 255)], y * 4);
  }
  return col;
}

export function buildAssets() {
  const out = new Map();
  for (const theme of Object.keys(themes)) {
    for (const w of widths) out.set(`rail-frost-${theme}-${w}.png`, encodePng(w, 1, railFrostRow(theme, w)));
    out.set(`details-scrim-${theme}-${scrimWidth}x${scrimHeight}.png`, encodePng(scrimWidth, scrimHeight, scrimImage(theme, scrimWidth, scrimHeight)));
    out.set(`agenda-fade-${theme}-${agendaFadeHeight}.png`, encodePng(1, agendaFadeHeight, agendaFadeColumn(theme, agendaFadeHeight)));
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--check") {
  const stale = [...buildAssets()].filter(([name, png]) => !existsSync(join(outDir, name)) || !readFileSync(join(outDir, name)).equals(png));
  for (const [name] of stale) console.log(`stale: ${name}`);
  process.exit(stale.length ? 1 : 0);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, png] of buildAssets()) { writeFileSync(join(outDir, name), png); console.log(name, png.length); }
}
