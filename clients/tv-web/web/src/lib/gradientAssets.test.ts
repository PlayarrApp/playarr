import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The rail frost is drawn from pre-rendered PNG layers (src/assets/gradients), generated from the CSS tokens by
 * scripts/generate-gradient-assets.mjs. A runtime CSS gradient is dithered differently by every Chromium, so the TV engines
 * and the web reference never match; a decoded PNG is the same bytes everywhere.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("gradient assets", () => {
  it("are up to date with the CSS tokens (run `node scripts/generate-gradient-assets.mjs` after changing one)", () => {
    expect(() => execFileSync("node", [join(web, "scripts/generate-gradient-assets.mjs"), "--check"], { cwd: web, stdio: "pipe" })).not.toThrow();
  });

  it("every referenced gradient PNG exists, and no rail still uses a runtime frost gradient", () => {
    for (const file of ["src/styles/global.css", "src/pages/Calendar.css"]) {
      const css = readFileSync(join(web, file), "utf8");
      for (const m of css.matchAll(/assets\/gradients\/([\w-]+\.png)/g)) expect(existsSync(join(web, "src/assets/gradients", m[1] ?? ""))).toBe(true);
      expect(css).not.toMatch(/color-mix\(in srgb, var\(--tv-rail-frost\) \d+%, transparent\)\s+(12|34|62)%,/);
    }
    expect(readdirSync(join(web, "src/assets/gradients")).every((n) => n.endsWith(".png"))).toBe(true);
  });
});
