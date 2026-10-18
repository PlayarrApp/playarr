/**
 * Runtime half of the `aspect-ratio` fallback in legacy-tv-css.mjs, for TV engines older than Chromium 88 (Tizen 6.5).
 * The build copies every `aspect-ratio: R` declaration of a style rule to `--lc-ar: R` in the same rule, so the cascade (and var()) resolve
 * per element. An auto-height box then gets height = width / ratio when it clips its overflow (its automatic minimum size is 0), and
 * min-height = width / ratio otherwise (content may make it taller), which is what `aspect-ratio` does. Rules that also set a height
 * are not copied (the browser ignores the ratio there too).
 */
const PROPERTY = "--lc-ar";

/** Ratio as a number from a computed `--lc-ar` value ("16 / 9", "1", "auto 4 / 3"), or undefined for auto or anything unreadable. */
export function parseRatio(value) {
  const text = String(value ?? "").trim().replace(/^auto\s+/i, "");
  if (!text || /^auto$/i.test(text)) return undefined;
  const [width, height = "1"] = text.split("/").map((part) => Number.parseFloat(part));
  return width > 0 && height > 0 ? width / height : undefined;
}

function collectSelectors(styleSheets) {
  const selectors = new Set();
  const visit = (rules) => {
    for (const rule of rules ?? []) {
      if (rule.cssRules) visit(rule.cssRules);
      if (!rule.selectorText || !rule.style?.getPropertyValue(PROPERTY)) continue;
      for (const selector of rule.selectorText.split(",")) {
        const trimmed = selector.trim();
        // A pseudo-element cannot be queried (and is not an element with a height of its own to fix).
        if (trimmed && !trimmed.includes("::") && !/:(?:before|after)\b/.test(trimmed)) selectors.add(trimmed);
      }
    }
  };
  for (const sheet of styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Cross-origin sheets are not readable and never carry the property.
    }
  }
  return [...selectors];
}

/** Applies the fallback to the elements of `documentObject`; reads happen in one pass, writes in another, so it costs two layouts at most. */
export function applyAspectRatios(documentObject, selectors, windowObject = window) {
  const elements = [];
  for (const selector of selectors) {
    try {
      elements.push(...documentObject.querySelectorAll(selector));
    } catch {
      // One selector this engine rejects loses only itself.
    }
  }
  const targets = [...new Set(elements)];
  const touched = documentObject.querySelectorAll("[data-lc-ar]");
  for (const element of touched) {
    element.style.minHeight = "";
    element.style.height = "";
    element.removeAttribute("data-lc-ar");
  }
  const writes = [];
  for (const element of targets) {
    const style = windowObject.getComputedStyle(element);
    const ratio = parseRatio(style.getPropertyValue(PROPERTY));
    if (!ratio || element.offsetWidth === 0) continue;
    const needed = element.offsetWidth / ratio;
    const clips = style.overflowY !== "visible";
    if (clips ? Math.abs(element.offsetHeight - needed) > 0.5 : element.offsetHeight < needed - 0.5) writes.push([element, needed, clips]);
  }
  for (const [element, needed, clips] of writes) {
    element.style[clips ? "height" : "minHeight"] = `${needed}px`;
    element.setAttribute("data-lc-ar", "");
  }
  return writes.length;
}

/** Installs the fallback when the engine lacks aspect-ratio; returns a function that stops it. */
export function installLegacyAspectRatio({ windowObject = window, documentObject = document } = {}) {
  if (windowObject.CSS?.supports?.("aspect-ratio", "1")) return () => {};
  let selectors = null;
  let frame = 0;
  const run = () => {
    frame = 0;
    selectors ??= collectSelectors(documentObject.styleSheets);
    if (selectors.length === 0 && documentObject.styleSheets.length > 0) selectors = null;
    if (selectors) applyAspectRatios(documentObject, selectors, windowObject);
  };
  const schedule = () => {
    if (!frame) frame = windowObject.requestAnimationFrame(run);
  };
  const observer = new windowObject.MutationObserver(schedule);
  const start = () => {
    observer.observe(documentObject.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    schedule();
  };
  if (documentObject.readyState === "loading") documentObject.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  windowObject.addEventListener("resize", schedule);
  windowObject.addEventListener("load", schedule);
  return () => {
    observer.disconnect();
    windowObject.removeEventListener("resize", schedule);
    windowObject.removeEventListener("load", schedule);
    if (frame) windowObject.cancelAnimationFrame(frame);
  };
}
