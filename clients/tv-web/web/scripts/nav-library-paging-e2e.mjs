#!/usr/bin/env node
// Phone library paging (rows 1.10045, 1.10046, 1.10047): every library pages in to the server total even when the user
// flings; while a page loads there is exactly one extra row of skeleton cards plus the top loading trail and no large
// empty scroll; and a forward navigation to another library starts at the top while Back restores the offset.
//   node scripts/nav-library-paging-e2e.mjs [--no-build] [--dist dir]
import { join } from "node:path";
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";

const TOTALS = { "/movies": 700, "/series": 450, "/music": 330 };
const { check, open, finish } = await boot({ movies: TOTALS["/movies"], series: TOTALS["/series"], artists: TOTALS["/music"] }, { realisticAuth: true });
const grid = (page, fn, arg) => page.evaluate(fn, arg);

for (const theme of ["dark", "light"]) {
  for (const [path, total] of Object.entries(TOTALS)) {
    const { context, page, errors } = await open(path, { width: 390, height: 844, theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForSelector(".tv-title-card", { timeout: 10_000 });
    // Pages answer late, as on a real connection, so a fling outruns each one.
    await context.route((url) => url.pathname === "/api/v1/catalog" && Number(url.searchParams.get("offset")) > 0, async (route) => {
      await new Promise((r) => setTimeout(r, 250));
      await route.continue();
    });
    // A fling: scroll to the very end over and over without waiting for anything.
    const t0 = Date.now();
    let loaded = 0;
    while (Date.now() - t0 < 40_000) {
      loaded = await grid(page, () => {
        const g = document.querySelector(".tv-title-grid");
        g.style.scrollBehavior = "auto";
        g.scrollTop = g.scrollHeight;
        return Number(g.dataset.libraryCount);
      });
      if (loaded >= total) break;
      await page.waitForTimeout(16);
    }
    check(`${theme} ${path}: a fling pages in all ${total} titles (${loaded}, ${Date.now() - t0} ms)`, loaded === total, `loaded ${loaded}`);
    check(`${theme} ${path}: no page errors`, errors.length === 0, errors.join(";"));
    await context.close();
  }

  // First load (rows 1.10031, 1.10032): the skeleton starts below the header and Back, with the trail and no spinner.
  {
    const slow = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 60, series: 8, artists: 0, listDelayMs: 4000 });
    const { context, page } = await open("/movies", { width: 390, height: 844, theme, server: slow });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const m = await page.evaluate(() => {
      const card = document.querySelector(".skeleton-card")?.getBoundingClientRect();
      const header = document.querySelector(".page-header")?.getBoundingClientRect();
      return { cardTop: card?.top ?? null, headerBottom: header?.bottom ?? null, trail: Boolean(document.querySelector(".loading-trail")), spinner: document.querySelectorAll(".tv-mini-loader").length };
    });
    check(`${theme} first load: skeleton starts below the header (${m.cardTop} >= ${m.headerBottom})`, m.cardTop !== null && m.headerBottom !== null && m.cardTop >= m.headerBottom, JSON.stringify(m));
    check(`${theme} first load: top loading trail, no spinner`, m.trail && m.spinner === 0, JSON.stringify(m));
    await context.close();
    slow.close?.();
  }

  // One extra skeleton row, the trail, and no large empty scroll while a page loads.
  {
    const { context, page } = await open("/movies", { width: 390, height: 844, theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForSelector(".tv-title-card", { timeout: 10_000 });
    await context.route((url) => url.pathname === "/api/v1/catalog" && Number(url.searchParams.get("offset")) > 0, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.evaluate(() => { const g = document.querySelector(".tv-title-grid"); g.style.scrollBehavior = "auto"; g.scrollTop = g.scrollHeight; });
    await page.waitForSelector(".tv-title-grid .skeleton-card", { timeout: 5000 });
    const m = await page.evaluate(() => {
      const g = document.querySelector(".tv-title-grid");
      const cs = getComputedStyle(g.querySelector(".tv-title-grid-content"));
      const rowHeight = Number(g.dataset.libraryRowHeight);
      const cols = Number(g.dataset.libraryCols);
      const rows = Math.ceil(Number(g.dataset.libraryCount) / cols);
      return {
        skeletons: g.querySelectorAll(".skeleton-card").length,
        cols,
        trail: Boolean(document.querySelector(".loading-trail")),
        height: g.scrollHeight,
        allowed: (rows + 1) * rowHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2,
        spinner: document.querySelectorAll(".tv-mini-loader").length,
      };
    });
    check(`${theme} loading more: exactly one skeleton row (${m.skeletons} cards, ${m.cols} columns)`, m.skeletons === m.cols, JSON.stringify(m));
    check(`${theme} loading more: the top loading trail shows, no spinner`, m.trail && m.spinner === 0, JSON.stringify(m));
    check(`${theme} loading more: scroll height ${Math.round(m.height)} <= loaded rows + one row (${Math.round(m.allowed)})`, m.height <= m.allowed, JSON.stringify(m));
    await context.close();
  }

  // Scroll position: forward to another library starts at the top, Back restores the offset.
  {
    const { context, page } = await open("/movies", { width: 390, height: 844, theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForSelector(".tv-title-card", { timeout: 10_000 });
    const top = () => page.evaluate(() => document.querySelector(".tv-title-grid")?.scrollTop ?? -1);
    await page.evaluate(() => { const g = document.querySelector(".tv-title-grid"); g.style.scrollBehavior = "auto"; g.scrollTop = 2400; });
    await page.waitForTimeout(500);
    const before = await top();
    await page.click('.app-nav a[href="/series"]');
    await page.waitForFunction(() => location.pathname === "/series");
    await page.waitForSelector(".tv-title-card", { timeout: 10_000 });
    await page.waitForTimeout(900);
    const series = await top();
    check(`${theme} Movies to Series starts at the top (scrollTop ${series})`, series <= 1, `series ${series}`);
    await page.goBack();
    await page.waitForFunction(() => location.pathname === "/movies");
    await page.waitForSelector(".tv-title-card", { timeout: 10_000 });
    await page.waitForTimeout(900);
    const back = await top();
    check(`${theme} Back restores Movies at its offset (${before} -> ${back})`, Math.abs(back - before) <= 2, `before ${before} back ${back}`);
    await context.close();
  }
}
await finish();
