import { describe, expect, it } from "vitest";
import { formatShellClockDate } from "./shellClockDate";

const date = new Date(2026, 9, 13, 12, 0, 0);
const enGbOptions: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "long" };

describe("shell clock date formatting", () => {
  it("formats en-GB as the Web weekday, day, and month on every engine, with no comma", () => {
    expect(formatShellClockDate(date, "en-GB")).toBe("Tue 13 October");
  });

    it("keeps the Intl formatter outside en-GB", () => {
    for (const locale of ["th-TH", "ja-JP"]) {
      expect(formatShellClockDate(date, locale)).toBe(new Intl.DateTimeFormat(locale, enGbOptions).format(date));
    }
  });
});
