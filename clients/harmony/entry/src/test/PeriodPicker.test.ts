// entry/src/test/PeriodPicker.test.ts: core/PeriodPicker.ts against web PeriodPicker.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { MONTH_NAMES, monthOfDay, periodJumpDay, yearChoices, yearOfDay } from "../main/ets/core/PeriodPicker";

test("a jump sets the first of the chosen month, zero padded", () => {
  assert.equal(periodJumpDay(2026, 3), "2026-03-01");
  assert.equal(periodJumpDay(2027, 12), "2027-12-01");
  assert.equal(periodJumpDay(987, 1), "0987-01-01");
});

test("thirty-one years centred on the current one", () => {
  const years = yearChoices(2026);
  assert.equal(years.length, 31);
  assert.equal(years[0], 2011);
  assert.equal(years[15], 2026);
  assert.equal(years[30], 2041);
  assert.equal(yearChoices(2026, 1).length, 3);
});

test("year and month of an anchor day; twelve month names", () => {
  assert.equal(yearOfDay("2026-10-11"), 2026);
  assert.equal(monthOfDay("2026-10-11"), 10);
  assert.equal(MONTH_NAMES.length, 12);
  assert.equal(MONTH_NAMES[9], "October");
});
