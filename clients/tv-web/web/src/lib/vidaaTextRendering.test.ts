import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

describe("VIDAA text rendering", () => {
  it("uses geometricPrecision on the VIDAA body only, so glyph advances stay fractional like every other engine", () => {
    const rule = /html\[data-platform="tv-vidaa"\] body \{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/text-rendering:\s*geometricPrecision/);
    expect(css.match(/text-rendering:\s*optimizeLegibility/g)).toHaveLength(1);
  });
});
