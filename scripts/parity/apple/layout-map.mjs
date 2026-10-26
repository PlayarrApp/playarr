// Maps the app's raw layout tree (TVParityLayout.swift) to the layout JSON of docs/parity/LAYOUT.md. Translate only: units,
// coordinate origin, role names and the dedup of an accessibility entry the app also reported itself. Every measured value (box,
// colour, font size and weight, text, radius) is the app's own and is never adjusted towards the web.
//   node scripts/parity/apple/layout-map.mjs <raw.json> <screen> <theme> > layout.json
import { readFileSync } from "node:fs";

const round = (v) => Math.round(v * 100) / 100;

export function mapRaw(doc, screen, theme) {
  const styled = doc.raw.filter((e) => e.source !== "ax");
  // an accessibility text entry has no style (font, size, weight, colour): where the view reports none it is dropped, not exported bare
  const plain = doc.raw.filter((e) => e.source === "ax" && !((e.role === "text" || e.role === "heading") && e.fontSize == null) && !styled.some((s) => s.text === e.text && Math.abs(s.rect.x - e.rect.x) < 3 && Math.abs(s.rect.y - e.rect.y) < 12));
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

if (process.argv[1]?.endsWith("layout-map.mjs") && process.argv[2]) {
  const [, , file, screen, theme] = process.argv;
  process.stdout.write(JSON.stringify(mapRaw(JSON.parse(readFileSync(file, "utf8")), screen, theme)));
}
