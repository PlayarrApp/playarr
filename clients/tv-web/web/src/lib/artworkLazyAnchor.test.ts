import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Chromium 85 (Samsung Tizen 6.5) and older ignore the `inset` shorthand. The lazy-load anchor then has no size, sits
// below its clipped card and never intersects, so the card keeps its title placeholder instead of its artwork.
describe("lazy artwork anchor", () => {
  it("is stretched with longhand offsets, not the inset shorthand", () => {
    const source = readFileSync(new URL("./artwork.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\binset:/);
    expect(source.match(/top: 0, right: 0, bottom: 0, left: 0/g)).toHaveLength(3);
  });
});
