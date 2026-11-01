/**
 * Chromium before 105 (the webOS TV 23 Simulator ships 94) truncates a fractional computed line-height to whole
 * pixels in every line box, so a block of N lines is up to N px shorter than the web draws it and everything below
 * sits higher. This restores the web height with `min-block-size`: N lines times the exact line-height.
 * Engines from 105 on lay out fractional line boxes and are left alone.
 */

/**
 * Number of text lines from the client rects of a text run: rects whose tops are within 2 px share a line.
 * @param {Iterable<{ top: number, width: number, height: number }>} rects
 */
export function countLines(rects) {
  /** @type {number[]} */
  const tops = [];
  for (const r of rects) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    if (!tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
  }
  return tops.length;
}

/**
 * True when a one-line box is exactly as tall as the engine's truncated line box, so its height comes from its text and not from a size the web set.
 * @param {number} contentHeight the box's content height in CSS px
 * @param {number} lineHeight the computed (fractional) line height
 */
export function isContentSized(contentHeight, lineHeight) {
  return Math.abs(contentHeight - Math.floor(lineHeight)) < 0.5;
}

/** @param {CSSStyleDeclaration} cs vertical padding and border of an element */
function boxPadding(cs) {
  return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
}

/** @param {string} userAgent */
export function needsLineBoxFix(userAgent) {
  const m = /Chrome\/(\d+)/.exec(userAgent);
  return !!m && Number(m[1]) < 105;
}

/**
 * @param {Window & typeof globalThis} win
 * @param {{ force?: boolean, roundPitch?: boolean }} [options] `roundPitch` also lays the lines of a multi-line text leaf out on the nearest whole pixel
 * pitch instead of the truncated one (the engine keeps whole pixels per line) and takes the surplus back from the block's end margin, so the block keeps
 * the web height. `force` skips the user agent test for engines whose agent carries no Chrome token (Tizen: "85.0.4183.93/6.5 TV Safari")
 */
export function installLineBoxFix(win, options = {}) {
  if (!options.force && !needsLineBoxFix(win.navigator.userAgent)) return;
  const doc = win.document;
  const touched = new Set();
  let scheduled = false;
  const run = () => {
    scheduled = false;
    observer.disconnect();
    for (const el of touched) {
      const style = /** @type {HTMLElement} */ (el).style;
      style.minBlockSize = "";
      style.lineHeight = "";
      style.marginBlockEnd = "";
    }
    touched.clear();
    const jobs = [];
    for (const el of doc.body.querySelectorAll("*")) {
      const cs = win.getComputedStyle(el);
      if (cs.display === "inline" || cs.display === "none" || cs.display === "contents") continue;
      const lh = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lh) || Math.abs(lh - Math.round(lh)) < 0.01) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
      jobs.push({ el, lh, cs });
    }
    const sized = jobs.map(({ el, lh, cs }) => {
      const range = doc.createRange();
      range.selectNodeContents(el);
      let lines = countLines([...range.getClientRects()]);
      const box = cs.boxSizing === "border-box" ? boxPadding(cs) : 0;
      // Single-line ellipsis labels in a box the web sizes itself (the line box overflows it) are left alone. A label that is only as tall as its own
      // truncated line box (a flex item centred in a row, a card's name) is a content-sized box: it gets the web line height like any other text.
      if (lines < 2 && cs.textOverflow === "ellipsis" && !isContentSized(el.getBoundingClientRect().height - boxPadding(cs), lh)) return null;
      // A clamped block shows at most N lines however many the hidden text would wrap to.
      const clamp = parseInt(cs.getPropertyValue("-webkit-line-clamp"), 10);
      if (Number.isFinite(clamp) && clamp > 0) lines = Math.min(lines, clamp);
      // The block's own minimum (a clamp() height on a button) must keep winning over the line-box minimum.
      // The nearest whole pixel pitch (only a leaf: nothing inside inherits the length), the surplus handed back through the end margin.
      const pitch = options.roundPitch && lines > 1 && el.childElementCount === 0 && Math.round(lh) > lh ? Math.round(lh) : 0;
      return { el, pitch, surplus: pitch ? (pitch - lh) * lines : 0, margin: parseFloat(cs.marginBlockEnd) || 0, target: Math.max(lines * lh + box, parseFloat(cs.minBlockSize) || 0) };
    });
    for (const s of sized) {
      if (!s) continue;
      /** @type {HTMLElement} */ (s.el).style.minBlockSize = `${s.target}px`;
      if (s.pitch) {
        /** @type {HTMLElement} */ (s.el).style.lineHeight = `${s.pitch}px`;
        /** @type {HTMLElement} */ (s.el).style.marginBlockEnd = `${s.margin - s.surplus}px`;
      }
      touched.add(s.el);
    }
    observe();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    win.requestAnimationFrame(() => win.setTimeout(run, 0));
  };
  const observer = new win.MutationObserver(schedule);
  const observe = () => observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
  observe();
  win.addEventListener("resize", schedule);
  schedule();
}
