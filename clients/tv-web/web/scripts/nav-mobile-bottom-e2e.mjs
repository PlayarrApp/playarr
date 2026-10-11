#!/usr/bin/env node
// Phone bottom clearance (rows 1.10043, 1.10044): on every page the last item scrolls clear of the floating
// bottom bar by one page gutter, and Home carries no extra padding of its own.
//   node scripts/nav-mobile-bottom-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 60, series: 40, artists: 30, playlists: 1, watchlist: 12, folders: true });

const measure = (page) =>
  page.evaluate(async () => {
    const nav = document.querySelector(".app-nav").getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-page-gutter")) || 16;
    // Every scroller on the page scrolls to its end (the page, and a library grid when it scrolls itself).
    const scrollers = [document.querySelector(".app-main"), ...document.querySelectorAll(".app-main *")].filter((el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
    for (let i = 0; i < 6; i++) {
      for (const el of scrollers) el.scrollTop = el.scrollHeight;
      await new Promise((r) => setTimeout(r, 250));
    }
    let last = null;
    for (const el of document.querySelectorAll(".app-main :is(.tv-media-track, .tv-title-card, li, a[href], button, img, h2, h3, p)")) {
      if (el.closest(".tv-key-art, .page-header, .app-nav, [aria-hidden='true']")) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.top >= innerHeight) continue;
      if (!last || r.bottom > last.bottom) last = { bottom: r.bottom, cls: String(el.className).slice(0, 40), tag: el.tagName };
    }
    return { navTop: nav.top, gutter, last };
  });

for (const theme of ["dark", "light"]) {
  for (const route of (process.env.ROUTES ?? "/settings,/,/movies,/series,/music,/watchlist,/requests").split(",")) {
    const { context, page } = await open(route, { width: 390, height: 844, theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(1200);
    const m = await measure(page);
    const gap = m.last ? m.navTop - m.last.bottom : null;
    console.log(`INFO  ${theme} ${route}: gap ${gap} gutter ${m.gutter} last ${JSON.stringify(m.last)}`);
    check(`${theme} ${route}: last item clears the bar by the gutter (gap ${gap?.toFixed(1)})`, gap !== null && gap >= m.gutter - 1, JSON.stringify(m));
    if (route === "/") check(`${theme} home: last rail sits one gutter above the bar (gap ${gap?.toFixed(1)})`, gap !== null && Math.abs(gap - m.gutter) <= 2, JSON.stringify(m));
    await context.close();
  }
}
await finish();
