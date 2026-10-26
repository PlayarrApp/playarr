// Maps the app's raw layout tree (TVParityLayout.swift) to the layout JSON of docs/parity/LAYOUT.md. Translate only: units,
// coordinate origin, role names and the dedup of an accessibility entry the app also reported itself. Every measured value (box,
// colour, font size and weight, text, radius) is the app's own and is never adjusted towards the web.
//   node scripts/parity/apple/layout-map.mjs <raw.json> <screen> <theme> > layout.json
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const round = (v) => Math.round(v * 100) / 100;

export function mapRaw(doc, screen, theme) {
  const styled = doc.raw.filter((e) => e.source !== "ax");
  const plain = doc.raw.filter((e) => e.source === "ax" && !styled.some((s) => s.text === e.text && Math.abs(s.rect.x - e.rect.x) < 3 && Math.abs(s.rect.y - e.rect.y) < 12));
  const elements = [...styled, ...plain].map((e) => {
    const single = e.fontSize != null && e.text && !e.lines && e.width != null && e.width <= e.rect.w + 0.5;
    // the text run: its measured width by the font's own ascent plus descent (hhea, from the UIFont drawn), centred in the view's box;
    // a wrapped heading spans first ascent to last descent of its lines
    let rect = { x: e.rect.x, y: e.rect.y, w: e.rect.w, h: e.rect.h };
    if (e.lines?.length && e.content != null) {
      rect = { x: e.rect.x, y: e.rect.y + e.pitch / 2 - e.content / 2, w: e.width, h: e.pitch * (e.lines.length - 1) + e.content };
    } else if (single && e.content != null) {
      rect = { x: e.rect.x, y: e.rect.y + e.rect.h / 2 - e.content / 2, w: e.width, h: e.content };
    } else if (single) rect.w = e.width;
    const out = {
      text: e.text ?? "",
      role: e.role,
      rect: Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, round(v)])),
      color: e.color ?? null,
      background: e.background ?? null,
      fontSize: e.fontSize ?? null,
      fontWeight: e.fontWeight ?? null,
    };
    if (e.radius > 0) out.radius = e.radius;
    if (e.opacity != null && e.opacity !== 1) out.opacity = e.opacity;
    return out;
  });
  return { screen, theme, viewport: doc.viewport, clockPinned: doc.clockPinned, elements: dropCovered(elements) };
}

// Covered content is not visible: an item fully inside a later-drawn dialog (the drawer over the library) is dropped. The
// dialog is the app's own opaque panel; nothing here changes a measured value.
function dropCovered(elements) {
  const dialogs = elements.filter((e) => e.role === "dialog");
  if (!dialogs.length) return elements;
  const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
  const dIndex = (d) => elements.indexOf(d);
  return elements.filter((e, i) => e.role === "dialog" || !dialogs.some((d) => i < dIndex(d) && inside(e.rect, d.rect)));
}

// `background` measured from the capture itself: the commonest pixel colour in a ring just outside a text, icon or image box (just
// inside a filled box), taken only when that ring is one flat colour (>= 90 %). Over a gradient or artwork the app's declared fill
// stays. A measurement of the device render, never a web value.
export function sampleBackgrounds(layout, pngPath) {
  const png = PNG.sync.read(readFileSync(pngPath));
  const k = png.width / layout.viewport.w;
  const at = (x, y) => {
    const px = Math.min(png.width - 1, Math.max(0, Math.round(x * k))), py = Math.min(png.height - 1, Math.max(0, Math.round(y * k)));
    const i = (py * png.width + px) * 4;
    return (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
  };
  for (const e of layout.elements) {
    const { x, y, w, h } = e.rect;
    const inside = ["container", "button", "link", "slider", "dialog", "search", "group"].includes(e.role);
    const m = inside ? 3 : -2;
    const x0 = x + m, x1 = x + w - m, y0 = y + m, y1 = y + h - m;
    if (inside && (x1 <= x0 || y1 <= y0)) continue;
    const counts = new Map();
    const add = (px, py) => { const c = at(px, py); counts.set(c, (counts.get(c) ?? 0) + 1); };
    const step = Math.max(2, Math.min(w, h) / 12);
    for (let px = x0; px <= x1; px += step) { add(px, y0); add(px, y1); }
    for (let py = y0; py <= y1; py += step) { add(x0, py); add(x1, py); }
    let best = null, n = 0, total = 0;
    for (const [c, v] of counts) { total += v; if (v > n) { best = c; n = v; } }
    if (best !== null && n / total >= 0.9) e.background = "#" + best.toString(16).padStart(6, "0");
  }
  return layout;
}

if (process.argv[1]?.endsWith("layout-map.mjs") && process.argv[2]) {
  const [, , file, screen, theme] = process.argv;
  process.stdout.write(JSON.stringify(mapRaw(JSON.parse(readFileSync(file, "utf8")), screen, theme)));
}
