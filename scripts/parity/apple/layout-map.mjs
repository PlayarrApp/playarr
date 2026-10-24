// Maps the app's raw layout tree (TVParityLayout.swift: items with measured text widths, plus accessibility entries) to the
// web-comparable layout JSON of docs/parity/LAYOUT.md. Pure, so it replays on saved raw trees without a hosted run:
//   node scripts/parity/apple/layout-map.mjs <raw.json> <screen> <theme> > layout.json
import { readFileSync } from "node:fs";

const round = (v) => Math.round(v * 100) / 100;
const contentHeight = (size) => Math.round(1.011 * size) + Math.round(0.353 * size); // Chromium: rounded ascent plus rounded descent

function textRect(e) {
  const { x, y, w, h } = e.rect;
  if (e.fontSize == null || !e.text) return { x, y, w, h };
  if (e.lines?.length) {
    const top = y + e.pitch / 2 - contentHeight(e.fontSize) / 2;
    return { x, y: top, w: e.width ?? w, h: e.pitch * (e.lines.length - 1) + contentHeight(e.fontSize) };
  }
  if (e.width == null || e.width > w + 0.5) return { x, y, w, h }; // wrapped: the view's own box is the text block
  const height = e.lineHeight ?? contentHeight(e.fontSize);
  return { x, y: y + h / 2 - height / 2, w: e.width, h: height };
}

export function mapRaw(doc, screen, theme) {
  const styled = doc.raw.filter((e) => e.source !== "ax");
  // a plain accessibility entry is dropped when a styled one has the same text and nearly the same frame
  const plain = doc.raw.filter((e) => e.source === "ax" && !styled.some((s) => s.text === e.text && Math.abs(s.rect.x - e.rect.x) < 3 && Math.abs(s.rect.y - e.rect.y) < 12));
  const elements = [...styled, ...plain].flatMap((e) => {
    const out = {
      text: e.text ?? "",
      role: e.role,
      rect: Object.fromEntries(Object.entries(textRect(e)).map(([k, v]) => [k, round(v)])),
      color: e.color ?? null,
      background: e.background ?? null,
      fontSize: e.fontSize ?? null,
      fontWeight: e.fontWeight ?? null,
    };
    // a full-bleed container is the viewport (the app's frame sits inside the TV safe area)
    if (e.role === "container" && out.rect.w >= 1700 && out.rect.h >= 900) out.rect = { x: 0, y: 0, w: doc.viewport.w, h: doc.viewport.h };
    if (e.radius > 0) out.radius = e.radius;
    // the web models a rounded media tile as a container with the radius around a square-cornered image
    if (e.role === "image" && e.radius > 0) {
      const { radius, ...image } = out;
      return [{ ...out, role: "container", text: "" }, image];
    }
    return [out];
  });
  return { screen, theme, viewport: doc.viewport, clockPinned: doc.clockPinned, elements };
}

if (process.argv[1]?.endsWith("layout-map.mjs") && process.argv[2]) {
  const [, , file, screen, theme] = process.argv;
  process.stdout.write(JSON.stringify(mapRaw(JSON.parse(readFileSync(file, "utf8")), screen, theme)));
}
