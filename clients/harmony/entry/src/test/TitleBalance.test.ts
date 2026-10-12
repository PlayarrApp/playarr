// entry/src/test/TitleBalance.test.ts: core/TitleBalance.ts against titles Chrome's `text-wrap: balance` broke (Android TV notes).
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { balanceTitle } from "../main/ets/core/TitleBalance";

// Widths measured in Chrome (Nunito Sans 560, 69.12 px, 9ch box of 373 px) for the words these titles are made of.
const SPANS: Record<string, number> = {
  "2": 36.5, "2 Fast": 161.71875, "2 Fast 2": 211.34375, "2 Fast 2 Furious": 420.046875, "Fast": 112.09375,
  "Fast 2": 161.71875, "Fast 2 Furious": 370.421875, "2 Furious": 245.203125, "Furious": 195.578125,
  "The": 103.875, "The 5th": 208.234375, "The 5th Wave": 382.890625, "5th": 91.234375, "5th Wave": 265.890625,
  "Wave": 161.53125, "6": 36.5, "6 Underground": 412.578125, "Underground": 362.96875,
};
const measure = (text: string): number => SPANS[text] ?? 9999;

test("a last single word is avoided, as Chrome", () => {
  assert.equal(balanceTitle("2 Fast 2 Furious", measure, 373), "2 Fast\n2 Furious");
});

test("two lines split where the widths are most even", () => {
  assert.equal(balanceTitle("The 5th Wave", measure, 373), "The 5th\nWave");
});

test("a title that fits stays whole", () => {
  assert.equal(balanceTitle("Wave", measure, 373), "Wave");
});

test("a word wider than the box gets a line of its own", () => {
  assert.equal(balanceTitle("6 Underground", measure, 373), "6\nUnderground");
});
