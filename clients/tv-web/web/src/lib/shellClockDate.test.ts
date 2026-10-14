import { describe, expect, it } from "vitest";
import { formatShellClockDate } from "./shellClockDate";

const date = new Date(2026, 9, 13, 12, 0, 0);
const enGbOptions: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "long" };

describe("shell clock date formatting", () => {
  it("formats VIDAA en-GB as the Web weekday, day, and month when combined ICU parts are missing", () => {
    expect(formatShellClockDate(date, "en-GB", true)).toBe("Tue 13 October");
  });

  it("keeps the existing Intl formatter on Web and other platforms", () => {
    expect(formatShellClockDate(date, "en-GB", false)).toBe(new Intl.DateTimeFormat("en-GB", enGbOptions).format(date));
  });

  it("keeps VIDAA's existing Intl locale behaviour outside English", () => {
    for (const locale of ["th-TH", "ja-JP"]) {
      expect(formatShellClockDate(date, locale, true)).toBe(new Intl.DateTimeFormat(locale, enGbOptions).format(date));
    }
  });
});
