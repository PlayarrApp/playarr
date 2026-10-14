#!/usr/bin/env node
// Every skeleton placeholder has the size and position of the media card that replaces it. Each scenario holds its
// data request, measures the skeleton cards, releases the request, then measures the loaded cards. No timers: both
// states are awaited by selector.
//   node scripts/skeleton-size-e2e.mjs [--dist dir] [--shots dir] [--json file] [--only name]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt("dist", join(root, "dist"));
const SHOTS = opt("shots", "");
const ONLY = opt("only", "");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const VIEWPORTS = [["tv", 1920, 1080], ["laptop", 1440, 900], ["tablet", 1280, 800], ["phone", 390, 844]];
const SKELETON = ".media-card.is-skeleton";
const LOADED = ".tv-title-card, .tv-home-card:not(.is-skeleton), .tv-search-result";
const TOL = 0.75;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// `skipY` lists viewports where the rail sits below the hero copy (phone): its y follows the title and synopsis length,
// which a skeleton cannot know, so only size, gap and x are compared there.
// `hold` picks the data request the page waits on (path and search of the URL).
const SCENARIOS = [
  { name: "home", path: () => "/", hold: (u) => u.pathname === "/api/v1/home/rails" },
  { name: "movies", path: () => "/movies", hold: (u) => u.pathname === "/api/v1/catalog" && u.searchParams.get("kind") === "movie" },
  { name: "series", path: () => "/series", hold: (u) => u.pathname === "/api/v1/catalog" && u.searchParams.get("kind") === "series" },
  { name: "music", path: () => "/music", hold: (u) => u.pathname === "/api/v1/catalog" && u.searchParams.get("kind") === "artist", server: { artists: 24 } },
  { name: "search", path: () => "/search?q=a", hold: (u) => u.pathname === "/api/v1/catalog/search" },
  { name: "movie-detail", path: (ids) => `/movies/${ids.movie}`, hold: (u) => /^\/api\/v1\/catalog\/[^/]+$/.test(u.pathname), loaded: ".tv-episode-card:not(.is-skeleton)", skipY: ["phone"] },
  { name: "series-detail", path: (ids) => `/series/${ids.series}`, hold: (u) => /^\/api\/v1\/catalog\/[^/]+$/.test(u.pathname), loaded: ".tv-episode-card:not(.is-skeleton)", skipY: ["phone"] },
];

const measure = (page, selector) => page.evaluate((sel) => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const all = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
  // The first row only: cards sharing the first card's parent.
  const cards = all.filter((el) => el.parentElement === all[0]?.parentElement);
  const first = cards[0] ? rect(cards[0]) : null;
  const second = cards[1] ? rect(cards[1]) : null;
  // Gap along the row, or down the column when the second card starts a new row.
  const gap = first && second ? (second.y > first.y + 1 ? second.y - (first.y + first.h) : second.x - (first.x + first.w)) : null;
  const art = cards[0]?.querySelector("[class*=art], .skeleton") ?? null;
  return { count: cards.length, first, gap, art: art ? rect(art) : null };
}, selector);

const server = await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 8, castCount: 10, movies: 40, series: 20, artists: 24 });
const base = `http://127.0.0.1:${server.port}`;
const auth = { authorization: "Bearer t" };
const ids = {
  movie: (await (await fetch(`${base}/api/v1/catalog?kind=movie&limit=1`, { headers: auth })).json()).items[0].id,
  series: (await (await fetch(`${base}/api/v1/catalog?kind=series&limit=1`, { headers: auth })).json()).items[0].id,
};
const browser = await launchChromium();
const rows = [];
let failed = 0;

for (const sc of SCENARIOS) {
  if (ONLY && sc.name !== ONLY) continue;
  for (const [vp, width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(({ base, userId }) => {
      localStorage.setItem("playarr:apiBaseUrl", base);
      const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
      localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
    }, { base, userId: USER_ID });
    const page = await context.newPage();
    // Measure layout, not the focus lift, the art zoom or the route entrance: those are transforms and animations.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const css = document.createElement("style");
        css.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}:is(.tv-home-card,.tv-title-card,.tv-episode-card,.tv-search-result,.skeleton-card),:is(.tv-home-card,.tv-title-card,.tv-episode-card,.tv-search-result,.skeleton-card) *{transform:none!important}";
        document.head.append(css);
      });
    });
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route((u) => sc.hold(u), async (route) => { await gate; await route.continue(); });
    await page.goto(`${base}${sc.path(ids)}`);
    let skeleton = null, loaded = null, note = "";
    try {
      await page.waitForSelector(SKELETON, { timeout: 15000 });
      skeleton = await measure(page, SKELETON);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${sc.name}-${vp}-skeleton.png`) });
      release();
      await page.waitForSelector(sc.loaded ?? LOADED, { timeout: 15000 });
      await page.waitForSelector(SKELETON, { state: "detached", timeout: 15000 });
      // Settle the route entrance animation deterministically.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      loaded = await measure(page, sc.loaded ?? LOADED);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${sc.name}-${vp}-loaded.png`) });
    } catch (e) { note = String(e).split("\n")[0]; release(); }
    const d = (a, b) => (a != null && b != null ? +(a - b).toFixed(2) : null);
    const row = { scenario: sc.name, viewport: vp, skeleton, loaded, note };
    row.diff = skeleton && loaded ? { w: d(skeleton.first?.w, loaded.first?.w), h: d(skeleton.first?.h, loaded.first?.h), x: d(skeleton.first?.x, loaded.first?.x), y: d(skeleton.first?.y, loaded.first?.y), gap: d(skeleton.gap, loaded.gap) } : null;
    if (row.diff && sc.skipY?.includes(vp)) row.diff.y = 0;
    const ok = row.diff && Object.values(row.diff).every((v) => v !== null && Math.abs(v) <= TOL);
    if (!ok) failed += 1;
    rows.push(row);
    console.log(`${ok ? "PASS" : "FAIL"}  ${sc.name} @ ${vp} ${width}x${height}${row.diff ? ` diff ${JSON.stringify(row.diff)}` : ` -- ${note}`}`);
    await context.close();
  }
}
if (opt("json", "")) writeFileSync(opt("json", ""), JSON.stringify(rows, null, 2));
await browser.close();
server.close?.();
console.log(`\n${rows.length - failed}/${rows.length} scenarios match`);
process.exit(failed ? 1 : 0);
