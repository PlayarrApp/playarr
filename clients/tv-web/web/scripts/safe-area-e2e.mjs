#!/usr/bin/env node
// Safe areas (owner request 2026-10-14): on a phone the chrome sits inside the notch / cutout / home-indicator
// insets while backgrounds may still run edge to edge. Chromium's `Emulation.setSafeAreaInsetsOverride` makes the
// real `env(safe-area-inset-*)` resolve, so this exercises the shipped CSS with no test-only override.
//   node scripts/safe-area-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { boot, opt } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 40, series: 8, artists: 0 });
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });

const scenarios = [
  { name: "iphone-portrait", width: 390, height: 844, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { name: "iphone-landscape", width: 844, height: 390, insets: { top: 0, bottom: 21, left: 59, right: 59 } },
  { name: "punchhole-portrait", width: 412, height: 915, insets: { top: 32, bottom: 0, left: 0, right: 0 } },
];
// Chrome that must (a leading ? marks a selector that exists only on some routes) sit inside the safe rectangle on each route (the first match of each selector).
const routes = [
  { path: "/", name: "home", selectors: [".app-nav", ".app-main h2", "?.tv-alphabet"] },
  { path: "/movies", name: "movies", selectors: [".app-nav", ".page-header h1", "?.page-header button, .page-header a", "?.shell-action-column", "?.tv-alphabet"] },
  { path: "/settings", name: "settings", selectors: [".app-nav", ".page-header h1", "?.page-header button, .page-header a", "?.shell-action-column", "?.tv-alphabet"] },
  { path: "/player/mf-test?title=x", name: "player", player: true, selectors: [".player-close", ".player-minimise", ".player-controls .player-btn"] },
];

for (const sc of scenarios) {
  for (const route of routes) {
    const { context, page } = await open("/", {
      width: sc.width,
      height: sc.height,
      contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    });
    if (route.player) await page.route(/\/api\/v1\/playback\//, () => new Promise(() => {}));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: sc.insets });
    await page.goto(new URL(route.path, page.url()).href);
    await page.waitForTimeout(1800);
    const rects = await page.evaluate((sels) => sels.map((raw) => {
      const s = raw.replace(/^\?/, "");
      const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
      if (!el) return { s, missing: !raw.startsWith("?"), skipped: true };
      const r = el.getBoundingClientRect();
      return { s, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }), route.selectors);
    const { top, bottom, left, right } = sc.insets;
    for (const r of rects) {
      const label = `${sc.name} ${route.name} ${r.s}`;
      if (r.skipped && !r.missing) continue;
      if (r.missing) { check(`${label}: present`, false, "not found"); continue; }
      const ok = r.top >= top - 0.5 && r.bottom <= sc.height - bottom + 0.5 && r.left >= left - 0.5 && r.right <= sc.width - right + 0.5;
      check(`${label}: inside the safe area`, ok, JSON.stringify(r));
    }
    if (shots) await page.screenshot({ path: `${shots}/${sc.name}-${route.name}.png` });
    await context.close();
  }
}
await finish();
