import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Chromium 111 (VIDAA) gives an appearance:none range input a white background box unless it is set explicitly.
it("the player volume range has a transparent background colour so only the drawn bar shows", () => {
  const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");
  const rule = css.match(/\.player-volume-range\s*\{[^}]*\}/)?.[0] ?? "";
  expect(rule).toContain("background-color: transparent");
});
