import { describe, expect, it } from "vitest";
import { fitWithEllipsis } from "./fitText";

// Each character is 10 px wide, the box 55 px: the measure here is a stand-in for scrollWidth against clientWidth.
const fitsIn = (width: number) => (s: string) => s.length * 10 <= width;

describe("fitWithEllipsis", () => {
  it("keeps a string that fits", () => {
    expect(fitWithEllipsis("short", fitsIn(55))).toBe("short");
  });
  it("keeps the longest prefix that fits with the ellipsis", () => {
    expect(fitWithEllipsis("Hollow Garden 3", fitsIn(55))).toBe("Holl…");
  });
  it("drops trailing white space before the ellipsis", () => {
    expect(fitWithEllipsis("ab cdefgh", fitsIn(30))).toBe("ab…");
  });
  it("falls back to the ellipsis alone in a box that fits nothing else", () => {
    expect(fitWithEllipsis("Server connection", fitsIn(10))).toBe("…");
  });
});
