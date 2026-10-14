#!/usr/bin/env node
// Phone bottom clearance (rows 1.10043, 1.10044): on every page the last item scrolls clear of the floating
// bottom bar by one page gutter, and Home carries no extra padding of its own.
//   node scripts/nav-mobile-bottom-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 300, series: 40, artists: 30, playlists: 1, watchlist: 12, folders: true });

const measure = (page) =>
  page.evaluate(async () => {
    const nav = document.querySelector(".app-nav").getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-gap")) || 16;
    // Every scroller on the page scrolls to its end (the page, and a library grid when it scrolls itself).
    const scrollers = [document.querySelector(".app-main"), ...document.querySelectorAll(".app-main *")].filter((el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
    // Keep scrolling until every page has loaded and the extent has settled (a long library takes many pages).
    let prevHeight = -1;
    let settled = 0;
    for (let i = 0; i < 80 && settled < 6; i++) {
      for (const el of scrollers) el.scrollTop = el.scrollHeight;
      await new Promise((r) => setTimeout(r, 250));
      const height = scrollers.reduce((sum, el) => sum + el.scrollHeight, 0);
      settled = height === prevHeight ? settled + 1 : 0;
      prevHeight = height;
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
    // The grid's published row height sizes the spacer under the unmounted rows: it must be the real row pitch (a 120px floor once left ~2000px of blank scroll under phone list rows).
    const grid = document.querySelector(".tv-title-grid");
    const cards = [...document.querySelectorAll(".tv-title-card")];
    const cols = Math.max(1, getComputedStyle(document.querySelector(".tv-title-grid-content") ?? document.body).gridTemplateColumns.split(" ").length);
    const pitch = cards.length > 2 * cols ? cards[2 * cols].getBoundingClientRect().top - cards[cols].getBoundingClientRect().top : null;
    const slack = { published: Number(grid?.dataset.libraryRowHeight ?? 0), pitch };
    return { navTop: nav.top, gutter, last, slack };
  });

for (const theme of ["dark", "light"]) {
  for (const route of (process.env.ROUTES ?? "/settings,/,/movies,/movies?view=list,/series,/music,/watchlist,/requests").split(",")) {
    const { context, page } = await open(route, { width: 390, height: 845, theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(1200);
    const m = await measure(page);
    const gap = m.last ? m.navTop - m.last.bottom : null;
    console.log(`INFO  ${theme} ${route}: gap ${gap} gutter ${m.gutter} last ${JSON.stringify(m.last)}`);
    check(`${theme} ${route}: last item clears the bar by the gutter (gap ${gap?.toFixed(1)})`, gap !== null && gap >= m.gutter - 1, JSON.stringify(m));
    // Owner 2026-10-12: a library page ends one gutter below its last row, no more (a 120px row-pitch floor once left ~2000px of spacer under list rows).
    if (/^\/(movies|series|music)/.test(route)) check(`${theme} ${route}: the published row height is the real row pitch (${m.slack.published} vs ${m.slack.pitch})`, m.slack.pitch !== null && Math.abs(m.slack.published - m.slack.pitch) <= 1.5, JSON.stringify(m.slack));
    if (route === "/" || /^\/(movies|series|music)/.test(route)) check(`${theme} ${route}: last row sits one gutter above the bar (gap ${gap?.toFixed(1)})`, gap !== null && Math.abs(gap - m.gutter) <= 2, JSON.stringify(m));
    await context.close();
  }
}
await finish();
