// Fills the `background` of a native layout export from the screenshot of the same frame (docs/parity/LAYOUT.md).
// The app writes no colours for what it paints; the colour behind an element is what the screen shows next to its content:
// a control, container or image is read just inside its left edge at mid height, a text run just left of its first glyph
// (just right of its last when it starts at the screen edge). Pure measurement of the capture: no declared or composited guesses.
import { PNG } from "pngjs";

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export function fillBackgrounds(layout, pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const scale = png.width / layout.viewport.w;
  const at = (x, y) => {
    const px = Math.min(png.width - 1, Math.max(0, Math.round(x * scale))), py = Math.min(png.height - 1, Math.max(0, Math.round(y * scale)));
    const i = (py * png.width + px) * 4;
    return hex(png.data[i], png.data[i + 1], png.data[i + 2]);
  };
  for (const e of layout.elements) {
    const { x, y, w, h } = e.rect;
    const cy = y + h / 2;
    if (e.role === "text" || e.role === "heading") e.background = x >= 2 ? at(x - 2, cy) : at(x + w + 2, cy);
    else e.background = at(x + Math.min(3, w / 2), cy);
  }
  return layout;
}

/** The export must be the object the contract describes, in the theme the capture was taken in; anything else is an error, never a file. */
export function checkLayout(layout, theme) {
  if (!layout || !Array.isArray(layout.elements) || !layout.viewport || !(layout.viewport.w > 0) || !(layout.viewport.h > 0)) throw new Error("layout export: not a layout document");
  if (typeof layout.paletteDark !== "boolean" || layout.paletteDark !== (theme === "dark")) throw new Error(`layout export: the app drew the ${layout.paletteDark ? "dark" : "light"} palette, the capture is ${theme}`);
  return layout;
}
