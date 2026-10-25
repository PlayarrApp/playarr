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

/**
 * The Tizen TV browser's ICU writes an en-GB full date as "Wednesday 7 October 2026"; the web reference writes
 * "Wednesday, 7 October 2026". Only dateStyle "full" is touched.
 *
 * @param {string} text
 */
export function commaAfterWeekday(text) {
  return text.replace(/^([A-Za-z]+) (\d)/, "$1, $2");
}

/** @param {typeof globalThis} win */
export function installFullDateComma(win) {
  const proto = win.Intl?.DateTimeFormat?.prototype;
  const desc = proto && Object.getOwnPropertyDescriptor(proto, "format");
  if (!proto || !desc?.get) return;
  const getter = desc.get;
  Object.defineProperty(proto, "format", {
    ...desc,
    get() {
      const bound = getter.call(this);
      const full = this.resolvedOptions().dateStyle === "full";
      return full ? (/** @type {any} */ date) => commaAfterWeekday(bound(date)) : bound;
    },
  });
}
