import { describe, expect, it } from "vitest";
import { formatDetailDate } from "./detailDate";

describe("detail date formatting", () => {
  it("formats en-GB as day, short month, year on every engine", () => {
    expect(formatDetailDate(new Date("2026-09-17T00:00:00Z"), "en-GB")).toBe("17 Sept 2026");
    expect(formatDetailDate(new Date("2026-01-05T23:30:00Z"), "en-GB")).toBe("5 Jan 2026");
  });

  it("keeps the Intl formatter outside en-GB", () => {
    const date = new Date("2026-09-17T00:00:00Z");
    expect(formatDetailDate(date, "th-TH")).toBe(
      new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
    );
  });
});
