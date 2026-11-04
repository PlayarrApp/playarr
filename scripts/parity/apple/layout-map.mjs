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
  // Visibility is decided in the app, on the rendered screen (each item hidden and the screen rendered again). A tree that was not
  // measured that way, or whose render failed, is not a layout: refuse it rather than publish items that may be hidden.
  if (doc.visibility !== "rendered") throw new Error(`layout for ${screen} (${theme}) has no rendered visibility check (visibility=${doc.visibility ?? "missing"})`);
  const styled = doc.raw.filter((e) => e.source !== "ax");
  // An accessibility entry is kept unless the app also reported the same thing itself (same text, mostly the same area, same kind
  // of element). One that carries no style stays without one (null font and colour): it is a real element, only unmeasured.
  const textual = (role) => role === "text" || role === "heading";
  const same = (s, e) => s.text === e.text && overlaps(s.rect, e.rect) && (s.role === e.role || (textual(s.role) && textual(e.role)));
  const plain = doc.raw.filter((e) => e.source === "ax" && !styled.some((s) => same(s, e)));
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
  return { screen, theme, viewport: doc.viewport, clockPinned: doc.clockPinned, occluded: doc.occluded ?? 0, elements: canonicalOrder(elements) };
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
