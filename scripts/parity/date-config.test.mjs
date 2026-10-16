import test from "node:test";
import assert from "node:assert/strict";
import { validateParityFixedNow as validateWebDate, validateWebTimezone } from "./drivers/web.mjs";
import { validateParityFixedNow as validateAppleDate } from "./drivers/apple-sim.mjs";

for (const [label, validate] of [["web", validateWebDate], ["Apple", validateAppleDate]]) {
  test(`${label} parity clock accepts ISO timestamps and rejects invalid or injectable values`, () => {
    assert.equal(validate("2026-10-07T12:00:00Z"), "2026-10-07T12:00:00Z");
    assert.equal(validate("2026-10-07T12:00:00.123+02:30"), "2026-10-07T12:00:00.123+02:30");
    for (const value of ["tomorrow", "2026-02-30T12:00:00Z", "2026-10-07T12:00:00Z -Injected YES", "2026-10-07"]) {
      assert.throws(() => validate(value), /valid ISO 8601 timestamp/);
    }
  });
}

test("web timezone accepts UTC and IANA zones, rejects malformed zones", () => {
  assert.equal(validateWebTimezone("UTC"), "UTC");
  assert.equal(validateWebTimezone("Asia/Bangkok"), "Asia/Bangkok");
  for (const value of ["", "Mars/Olympus", "UTC -Injected"]) assert.throws(() => validateWebTimezone(value), /valid timezone/);
});
