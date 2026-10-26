// Guards a native layout export before it is written (docs/parity/LAYOUT.md).
/** The export must be the object the contract describes, in the theme the capture was taken in; anything else is an error, never a file. */
export function checkLayout(layout, theme) {
  if (!layout || !Array.isArray(layout.elements) || !layout.viewport || !(layout.viewport.w > 0) || !(layout.viewport.h > 0)) throw new Error("layout export: not a layout document");
  if (typeof layout.paletteDark !== "boolean" || layout.paletteDark !== (theme === "dark")) throw new Error(`layout export: the app drew the ${layout.paletteDark ? "dark" : "light"} palette, the capture is ${theme}`);
  if (typeof layout.occluded !== "number" || layout.clockPinned !== true) throw new Error("layout export: missing the occluded count or the clock was not pinned");
  for (const e of layout.elements) if (!e.rect || [e.rect.x, e.rect.y, e.rect.w, e.rect.h].some((v) => !Number.isFinite(v))) throw new Error("layout export: element without a measured rectangle");
  return layout;
}
