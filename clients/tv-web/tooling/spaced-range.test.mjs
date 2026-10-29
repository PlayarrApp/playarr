import assert from "node:assert/strict";
import test from "node:test";
import { installSpacedRanges, spacedRange } from "./spaced-range.mjs";

test("spacedRange spaces a digit-to-digit en dash only", () => {
  assert.equal(spacedRange("19–25 Oct"), "19 – 25 Oct");
  assert.equal(spacedRange("7 Oct\u2009\u2013\u20095 Nov"), "7 Oct \u2013 5 Nov");
  assert.equal(spacedRange("28 Oct – 3 Nov"), "28 Oct – 3 Nov");
});

test("installSpacedRanges wraps formatRange", () => {
  const win = { Intl: { DateTimeFormat: { prototype: { formatRange: () => "1–2 Oct" } } } };
  installSpacedRanges(win);
  assert.equal(win.Intl.DateTimeFormat.prototype.formatRange(), "1 – 2 Oct");
});

test("commaAfterWeekday adds the comma the web draws", async () => {
  const { commaAfterWeekday } = await import("./spaced-range.mjs");
  assert.equal(commaAfterWeekday("Wednesday 7 October 2026 at 01:00"), "Wednesday, 7 October 2026 at 01:00");
  assert.equal(commaAfterWeekday("Wednesday, 7 October 2026"), "Wednesday, 7 October 2026");
});
