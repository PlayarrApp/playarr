#!/usr/bin/env node
// Task 17.10625: baseline and regression checks for Home/Library alignment and navigation clearance.
// Usage: node scripts/layout-alignment-e2e.mjs --no-build --dist <built-dir> [--measure-only] [--out <json>]
import { writeFileSync } from "node:fs";
import { boot, opt } from "./e2e-common.mjs";

const from = Number(opt("from", 600));
const to = Number(opt("to", 1100));
const step = Number(opt("step", 40));
const smoke = process.argv.includes("--smoke");
const widths = smoke ? [1280] : [...new Set([600, 720, 760, 761, 800, 820, 900, 960, ...Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step), 1100, 1280, 1920])].sort((a, b) => a - b);
const heights = new Map([[600, 800], [720, 900], [760, 900], [761, 900], [800, 900], [820, 1180], [900, 900], [960, 540], [1100, 900], [1280, 720], [1920, 1080]]);
const { browser, server, base } = await boot({ movies: 24, series: 8, artists: 0 });
const movieId = (await (await fetch(`${base}/api/v1/catalog?kind=movie&limit=1`, { headers: { authorization: "Bearer t" } })).json()).items[0].id;
const out = opt("out", "");
const measureOnly = process.argv.includes("--measure-only");
const routes = [
  ["detail", `/movies/${movieId}`, ".tv-detail-title"],
  ["calendar", "/calendar?view=month&date=2026-10-07", ".calendar-month-scroll"],
  ["settings", "/settings", ".settings-page .settings-option"],
  ["search", "/search?q=a", ".tv-search-result"],
];
const results = [];
const failures = [];
const storage = (view, size) => ({ "playarr-home-view": view, "playarr-artwork-size": size });
const credentials = ({ base: apiBase, prefs = {} }) => ({ base: apiBase, prefs });

async function metrics(page, anchorSelector) {
  // Entry animations (tv-copy-in) move the copy for ~600 ms; measure the resting layout.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  return page.evaluate((selector) => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = (s) => [...document.querySelectorAll(s)].find((el) => {
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && css.display !== "none" && css.visibility !== "hidden";
    });
    const nav = visible(".app-nav");
    const navGroups = [...document.querySelectorAll(".app-nav-group")].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const verticalNav = nav ? getComputedStyle(nav).flexDirection === "column" : false;
    const home = document.querySelector(".tv-home");
    return {
      navPlacement: nav ? (verticalNav ? "left" : "bottom-or-centred") : "missing",
      nav: box(nav),
      navRight: verticalNav && navGroups.length ? Math.max(...navGroups.map((r) => r.right)) : null,
      contentAnchor: box(visible(selector)),
      pageTitle: box(visible(".page-header-title-block h1, .page-header-title-block h2, .tv-detail-title")),
      featureTitle: box(visible(".tv-home-feature h2")),
      railStack: box(document.querySelector(".tv-home-rails")),
      homeHeading: box(visible(".tv-home-rails .tv-media-track-heading")),
      homeCard: box(visible(".tv-home-rails .tv-home-card")),
      homeMode: home?.classList.contains("is-cover-view") ? "cover" : home ? "thumbnail" : null,
      artworkSize: document.documentElement.dataset.artworkSize ?? "medium",
      mobilePageGutter: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-page-gutter")) || 0,
      libraryGrid: box(document.querySelector(".tv-title-grid-content")),
      // The first card's resting layout position: the focused card is lifted and scaled, so read the grid's padding box instead.
      libraryCard: (() => {
        const grid = document.querySelector(".tv-title-grid-content");
        if (!grid || !visible(".tv-title-grid-content .tv-title-card")) return null;
        const r = grid.getBoundingClientRect();
        const css = getComputedStyle(grid);
        const left = r.left + Number.parseFloat(css.paddingLeft);
        const top = r.top + Number.parseFloat(css.paddingTop);
        return { left, top, right: left, bottom: top, width: 0, height: 0 };
      })(),
      libraryHeading: box(document.querySelector(".tv-library-heading")),
      libraryView: document.querySelector(".tv-directory")?.className.match(/\btv-directory-([\w-]+)/)?.[1] ?? null,
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, anchorSelector);
}

async function installSession(context, prefs = {}) {
  await context.addInitScript(({ base: apiBase, prefs: values }) => {
    localStorage.setItem("playarr:apiBaseUrl", apiBase);
    const userId = "00000000-0000-4000-8000-000000000001";
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "layout", apiBaseUrl: apiBase, userId, name: "E2E", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "layout", apiBaseUrl: apiBase, userId }));
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, credentials({ base, prefs }));
}

async function settleHome(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const sample = () => {
      const h = document.querySelector(".tv-home-rails .tv-media-track-heading")?.getBoundingClientRect();
      const c = document.querySelector(".tv-home-rails .tv-home-card")?.getBoundingClientRect();
      return h && c ? [h.left, h.top, c.left, c.top] : null;
    };
    let stable = 0;
    let previous = null;
    for (let frame = 0; frame < 180 && stable < 3; frame += 1) {
      await new Promise(requestAnimationFrame);
      const current = sample();
      stable = current && previous && current.every((value, index) => Math.abs(value - previous[index]) < 0.25) ? stable + 1 : 0;
      previous = current;
    }
    if (stable < 3) throw new Error("Home rail geometry did not settle within the bounded frame window");
  });
}

try {
  for (const width of widths) {
    const height = heights.get(width) ?? 900;
    for (const view of ["cover", "thumbnail"]) for (const size of ["small", "medium", "large"]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      await installSession(context, storage(view, size));
      const page = await context.newPage();
      page.on("pageerror", (error) => failures.push(`${width}x${height} Home ${view}/${size} pageerror: ${error}`));
      await page.goto(`${base}/`);
      await page.waitForSelector(".tv-home-rails .tv-home-card", { timeout: 20000 });
      await settleHome(page);
      const home = await metrics(page, ".tv-home-rails .tv-media-track-heading");
      if (home.homeMode !== view || home.artworkSize !== size) throw new Error(`Home mode mismatch at ${width}x${height}: expected ${view}/${size}, got ${home.homeMode}/${home.artworkSize}`);
      const libraryView = view === "cover" ? "cover" : "screen";
      await page.goto(`${base}/movies?view=${libraryView}`);
      await page.waitForSelector(".tv-title-grid-content .tv-title-card", { timeout: 20000 });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
      const library = await metrics(page, ".tv-title-grid-content .tv-title-card");
      if (library.artworkSize !== size) throw new Error(`Library artwork size mismatch at ${width}x${height}: expected ${size}, got ${library.artworkSize}`);
      if (library.libraryView !== libraryView) throw new Error(`Library view mismatch at ${width}x${height}: expected ${libraryView}, got ${library.libraryView}`);
      const row = { width, height, view, size, home, library };
      results.push(row);
      if (!measureOnly) {
        const deltas = {
          headingLeft: home.homeHeading?.left - library.libraryCard?.left,
          cardLeft: home.homeCard?.left - library.libraryCard?.left,
          headingTop: home.homeHeading?.top - library.libraryCard?.top,
        };
        // Phones (760 px and below) keep their own header band: the vertical match is a TV and tablet rule.
        for (const [key, delta] of Object.entries(deltas)) {
          if (key === "headingTop" && width <= 760) continue;
          if (!Number.isFinite(delta) || Math.abs(delta) > 1) failures.push(`${width}x${height} ${view}/${size} ${key} delta ${delta}`);
        }
        for (const [label, anchor] of [["Home", home.homeHeading], ["Home copy", home.featureTitle], ["Library", library.libraryCard], ["Library copy", library.featureTitle]]) {
          const minLeft = home.navPlacement === "left" ? home.navRight + 12 : home.mobilePageGutter;
          if (!anchor ? !label.endsWith("copy") : anchor.left < minLeft - 1) failures.push(`${width}x${height} ${label} begins at ${anchor?.left}, required gutter ${minLeft}`);
        }
      }
      await context.close();
    }
    for (const [name, route, anchor] of routes) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      await installSession(context);
      const page = await context.newPage();
      page.on("pageerror", (error) => failures.push(`${width}x${height} ${name} pageerror: ${error}`));
      await page.goto(`${base}${route}`);
      await page.locator(anchor).first().waitFor({ state: "visible", timeout: 20000 });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
      const measured = await metrics(page, anchor);
      results.push({ width, height, route: name, metrics: measured });
      if (!measureOnly) {
        const minLeft = measured.navPlacement === "left" ? measured.navRight + 12 : measured.mobilePageGutter;
        if (!measured.contentAnchor || measured.contentAnchor.left < minLeft - 1) failures.push(`${width}x${height} ${name} starts at ${measured.contentAnchor?.left}, nav right ${measured.navRight}`);
        if (measured.pageTitle && measured.pageTitle.left < minLeft - 1) failures.push(`${width}x${height} ${name} title starts at ${measured.pageTitle.left}, required gutter ${minLeft}`);
      }
      await context.close();
    }
  }
} catch (error) {
  failures.push(String(error?.stack ?? error));
} finally {
  if (out) writeFileSync(out, `${JSON.stringify({ results, failures }, null, 2)}\n`);
  await browser.close();
  server.close?.();
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`${failures.length ? "FAIL" : "PASS"}: ${results.length} layout samples${measureOnly ? " (measure-only)" : ""}`);
if (failures.length) process.exitCode = 1;
