// Maps the app's raw layout tree (TVParityLayout.swift) to the layout JSON of docs/parity/LAYOUT.md. Translate only: units,
// coordinate origin, role names and the dedup of an accessibility entry the app also reported itself. Every measured value (box,
// colour, font size and weight, text, radius) is the app's own and is never adjusted towards the web.
//   node scripts/parity/apple/layout-map.mjs <raw.json> <screen> <theme> > layout.json
import { readFileSync } from "node:fs";

const round = (v) => Math.round(v * 100) / 100;

// An accessibility entry and a styled item are one element when they carry the same text and cover mostly the same area
// (the accessibility frame of a focusable control includes its focus margin).
function overlaps(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 && (w * h) / Math.min(a.w * a.h, b.w * b.h) >= 0.6;
}

export function mapRaw(doc, screen, theme) {
  const styled = doc.raw.filter((e) => e.source !== "ax");
  // an accessibility text entry has no style (font, size, weight, colour): where the view reports none it is dropped, not exported bare
  const plain = doc.raw.filter((e) => e.source === "ax" && !((e.role === "text" || e.role === "heading") && e.fontSize == null) && !styled.some((s) => s.text === e.text && s.role === e.role && overlaps(s.rect, e.rect)));
  const elements = [...styled, ...plain].map((e) => {
    const out = {
      text: e.text ?? "",
      role: e.role,
      rect: Object.fromEntries(Object.entries(e.rect).map(([k, v]) => [k, round(v)])),
      color: e.color ?? null,
      background: e.background ?? null,
      fontSize: e.fontSize ?? null,
      fontWeight: e.fontWeight ?? null,
    };
    if (e.radius > 0) out.radius = e.radius;
    if (e.opacity != null && e.opacity !== 1) out.opacity = e.opacity;
    return out;
  });
  return { screen, theme, viewport: doc.viewport, clockPinned: doc.clockPinned, elements: canonicalOrder(dropCovered(elements)) };
}

// Covered content is not visible: an item fully inside a later-drawn dialog (the drawer over the library) is dropped. The
// dialog is the app's own opaque panel; nothing here changes a measured value.
function dropCovered(elements) {
  const dialogs = elements.filter((e) => e.role === "dialog");
  if (!dialogs.length) return elements;
  // only the part of an item inside the viewport is on screen: an item whose visible part lies wholly under the dialog is covered
  const view = { x: 0, y: 0, w: 1920, h: 1080 };
  const clip = (a) => {
    const x = Math.max(a.x, view.x), y = Math.max(a.y, view.y);
    return { x, y, w: Math.min(a.x + a.w, view.x + view.w) - x, h: Math.min(a.y + a.h, view.y + view.h) - y };
  };
  const inside = (a0, b) => { const a = clip(a0); return a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5; };
  const dIndex = (d) => elements.indexOf(d);
  return elements.filter((e, i) => e.role === "dialog" || !dialogs.some((d) => i < dIndex(d) && inside(e.rect, d.rect)));
}

if (process.argv[1]?.endsWith("layout-map.mjs") && process.argv[2]) {
  const [, , file, screen, theme] = process.argv;
  process.stdout.write(JSON.stringify(mapRaw(JSON.parse(readFileSync(file, "utf8")), screen, theme)));
}

// The app reports items in the order its views appeared, which varies from run to run; the file is written in a fixed
// order (position, role, text) so two identical runs give identical files. Nothing else about an element changes.
function canonicalOrder(elements) {
  const key = (e) => [e.rect.y, e.rect.x, e.role, e.text, e.rect.w, e.rect.h].map((v) => (typeof v === "number" ? v.toFixed(2).padStart(10, "0") : String(v))).join("|");
  return elements.map((e, i) => [key(e), i, e]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])).map((x) => x[2]);
}
