/**
 * Older ICU data (Chromium 94, the Tizen TV browser) writes a same-month range as "19–25 Oct"; current Chromium (the web reference) writes "19 – 25 Oct".
 * This restores the spaced en dash when a range has digits on both sides of an unspaced one.
 *
 * @param {string} text
 */
export function spacedRange(text) {
  return text.replace(/(\d)–(\d)/g, "$1 – $2");
}

/** @param {typeof globalThis} win */
export function installSpacedRanges(win) {
  const proto = win.Intl?.DateTimeFormat?.prototype;
  const original = proto?.formatRange;
  if (typeof original !== "function") return;
  proto.formatRange = function formatRange(...args) {
    return spacedRange(original.apply(this, args));
  };
}
