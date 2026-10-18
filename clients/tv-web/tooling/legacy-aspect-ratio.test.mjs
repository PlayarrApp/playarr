import assert from "node:assert/strict";
import test from "node:test";
import { applyAspectRatios, parseRatio } from "./legacy-aspect-ratio.mjs";
import { addLegacyTvCssFallbacks } from "./legacy-tv-css.mjs";

test("parses ratios and ignores auto", () => {
  assert.equal(parseRatio("16 / 9"), 16 / 9);
  assert.equal(parseRatio(" 1 "), 1);
  assert.equal(parseRatio("auto 4 / 3"), 4 / 3);
  assert.equal(parseRatio("auto"), undefined);
  assert.equal(parseRatio(""), undefined);
  assert.equal(parseRatio("0 / 3"), undefined);
});

test("the build keeps each ratio as --lc-ar unless the rule sets its own height", () => {
  const css = addLegacyTvCssFallbacks(".dot { width: 8px; aspect-ratio: 1; } .box { height: 4px; aspect-ratio: 2; } .art { aspect-ratio: var(--r); }", undefined, { chromium85: true });
  assert.match(css, /\.dot \{ width: 8px; aspect-ratio: 1;\s*--lc-ar: 1; \}/);
  assert.doesNotMatch(css.slice(css.indexOf(".box"), css.indexOf(".art")), /--lc-ar/);
  assert.match(css, /--lc-ar: var\(--r\)/);
});

function fakeElement({ width, height, ratio }) {
  return { offsetWidth: width, offsetHeight: height, ratio, style: {}, attrs: new Set(), setAttribute(name) { this.attrs.add(name); }, removeAttribute(name) { this.attrs.delete(name); } };
}

test("a clipping box gets exactly width / ratio, even when its content is taller", () => {
  const clipped = fakeElement({ width: 160, height: 98, ratio: "16 / 9" });
  clipped.overflowY = "hidden";
  const doc = { querySelectorAll: (selector) => (selector === "[data-lc-ar]" ? [] : [clipped]) };
  const win = { getComputedStyle: (el) => ({ getPropertyValue: () => el.ratio, overflowY: el.overflowY }) };
  assert.equal(applyAspectRatios(doc, [".x"], win), 1);
  assert.equal(clipped.style.height, "90px");
});

test("a box shorter than width / ratio gets a min-height, a taller one is left alone, and a stale one is cleared", () => {
  const short = fakeElement({ width: 160, height: 10, ratio: "16 / 9" });
  const tall = fakeElement({ width: 160, height: 200, ratio: "16 / 9" });
  const auto = fakeElement({ width: 160, height: 10, ratio: "auto" });
  const stale = fakeElement({ width: 100, height: 100, ratio: "1" });
  stale.style.minHeight = "300px"; stale.attrs.add("data-lc-ar");
  const doc = {
    querySelectorAll: (selector) => (selector === "[data-lc-ar]" ? [stale] : [short, tall, auto, stale]),
  };
  const win = { getComputedStyle: (el) => ({ getPropertyValue: () => el.ratio, overflowY: el.overflowY ?? "visible" }) };
  const count = applyAspectRatios(doc, [".x"], win);
  assert.equal(count, 1);
  assert.equal(short.style.minHeight, "90px");
  assert.ok(short.attrs.has("data-lc-ar"));
  assert.equal(tall.style.minHeight, undefined);
  assert.equal(auto.style.minHeight, undefined);
  assert.equal(stale.style.minHeight, "");
});
