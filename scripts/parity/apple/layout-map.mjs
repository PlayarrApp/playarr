// Maps the app's raw layout tree (TVParityLayout.swift) to the layout JSON of docs/parity/LAYOUT.md. Translate only: units,
// coordinate origin, role names and the dedup of an accessibility entry the app also reported itself. Every measured value (box,
// colour, font size and weight, text, radius) is the app's own and is never adjusted towards the web.
//   node scripts/parity/apple/layout-map.mjs <raw.json> <screen> <theme> > layout.json
import { readFileSync } from "node:fs";

const round = (v) => Math.round(v * 100) / 100;

export function mapRaw(doc, screen, theme) {
  const styled = doc.raw.filter((e) => e.source !== "ax");
  const plain = doc.raw.filter((e) => e.source === "ax" && !styled.some((s) => s.text === e.text && Math.abs(s.rect.x - e.rect.x) < 3 && Math.abs(s.rect.y - e.rect.y) < 12));
  const elements = [...styled, ...plain].map((e) => {
    const single = e.fontSize != null && e.text && !e.lines && e.width != null && e.width <= e.rect.w + 0.5;
    // the text run's measured width; a wrapped heading spans first ascent to last descent of its lines, from the font's own metrics
    let rect = { x: e.rect.x, y: e.rect.y, w: single ? e.width : e.rect.w, h: e.rect.h };
    if (e.lines?.length && e.content != null) {
      rect = { x: e.rect.x, y: e.rect.y + e.pitch / 2 - e.content / 2, w: e.width, h: e.pitch * (e.lines.length - 1) + e.content };
    }
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
  return { screen, theme, viewport: doc.viewport, clockPinned: doc.clockPinned, elements };
}

if (process.argv[1]?.endsWith("layout-map.mjs") && process.argv[2]) {
  const [, , file, screen, theme] = process.argv;
  process.stdout.write(JSON.stringify(mapRaw(JSON.parse(readFileSync(file, "utf8")), screen, theme)));
}
