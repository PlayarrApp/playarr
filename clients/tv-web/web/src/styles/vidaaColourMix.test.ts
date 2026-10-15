import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * VIDAA ships Chromium 111. There, `color-mix()` with a `var()` inside it, written straight into `box-shadow`, `text-shadow`
 * or the `border` shorthand, computes to currentColor: every shadow became a full-strength white glow and every group border a
 * white outline. Putting the mix in a custom property and using `var(--tint)` in the shadow or border resolves correctly on
 * that engine and on current ones.
 */
const FORBIDDEN = /(?<![\w-])(box-shadow|text-shadow|border)\s*:\s*[^;{}]*color-mix\([^;{}]*var\(/g;

describe("VIDAA-safe colour mixes", () => {
  const dirs = [new URL("./", import.meta.url), new URL("../pages/", import.meta.url)];
  const files = dirs.flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(".css")).map((name) => new URL(name, dir)));

  it.each(files.map((file) => [file.pathname.split("/").pop(), file] as const))("%s keeps var() mixes out of shadows and borders", (_name, file) => {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const bad = [...css.matchAll(FORBIDDEN)].map((match) => css.slice(0, match.index).split("\n").length);
    expect(bad).toEqual([]);
  });
});
