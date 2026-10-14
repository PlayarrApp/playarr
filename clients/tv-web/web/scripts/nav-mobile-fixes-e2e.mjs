#!/usr/bin/env node
// Owner-reported phone layout fixes at 390x844 (rows 1.10028 to 1.10030, 1.10033 to 1.10036 and 1.10042): music
// cover art leads the page, the series description renders once without shifting, the cast rail uses the TV spacing,
// the drawer close button is inset equally, header actions sit flush with the grid, Search paints no block and keeps its
// prompt under the field, and Settings sub-pages keep the Settings title with the section as the subtitle.
//
//   node scripts/nav-mobile-fixes-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot(
  { movies: 12, series: 4, artists: 3, artistAlbums: 3, castCount: 10, seasons: 2, seasonEpisodes: 6, episodeOverviews: true, resumeEpisodeIndex: 2, resumePlanDelayMs: 600 },
  { realisticAuth: true }
);
const phone = { width: 390, height: 844 };
const setTheme = (page, theme) => page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
const rect = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
  }, selector);

// 1.10028: the cover art's top does not move when the album (and so the details) change.
{
  const { context, page } = await open("/music", phone);
  await page.waitForSelector(".tv-title-card", { timeout: 8000 });
  await page.locator(".tv-title-card").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".tv-music-album-cover-flow", { timeout: 8000 });
  await page.waitForTimeout(900);
  const first = await rect(page, ".tv-music-album-cover-flow");
  const firstCopy = await rect(page, ".tv-detail-copy");
  await page.locator(".tv-music-album-card:not(.is-selected)").first().click({ force: true });
  await page.waitForTimeout(900);
  const second = await rect(page, ".tv-music-album-cover-flow");
  const secondCopy = await rect(page, ".tv-detail-copy");
  check("music: cover art above the details", first.bottom <= firstCopy.top + 1, `art bottom ${first.bottom}, details top ${firstCopy.top}`);
  check("music: the two albums have different-length details", Math.abs(firstCopy.height - secondCopy.height) > 1, `${firstCopy.height} vs ${secondCopy.height}`);
  check("music: art top identical across albums", first.top === second.top, `${first.top} vs ${second.top}`);
  await context.close();
}

// 1.10029: the series description is one node, painted once, without moving anything.
{
  const { context, page } = await open("/series", phone);
  await page.waitForSelector(".tv-title-card", { timeout: 8000 });
  await page.evaluate(() => {
    const w = window;
    w.__shift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput && e.sources?.some((s) => s.node && document.querySelector(".tv-detail-copy")?.contains(s.node))) w.__shift += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    w.__frames = [];
    const tick = () => {
      const s = document.querySelector(".tv-detail-synopsis");
      if (s) {
        w.__node ??= s;
        w.__frames.push({
          same: s === w.__node,
          visible: getComputedStyle(s).visibility === "visible",
          text: s.textContent,
          top: s.offsetTop,
          height: s.offsetHeight,
        });
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.locator(".tv-title-card").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ frames: window.__frames, shift: window.__shift }));
  const shown = r.frames.filter((f) => f.visible);
  const texts = new Set(shown.map((f) => f.text));
  check("series: description is the same DOM node throughout", r.frames.length > 0 && r.frames.every((f) => f.same));
  check("series: description is painted once, never swapped", shown.length > 0 && texts.size === 1, [...texts].join(" / ").slice(0, 120));
  check("series: description block never changes size", new Set(r.frames.map((f) => `${f.top}:${f.height}`)).size === 1, [...new Set(r.frames.map((f) => `${f.top}:${f.height}`))].join(" "));
  check("series: CLS 0 for the copy block", r.shift === 0, String(r.shift));

  // 1.10030: cast rail spacing is the TV web value (the clamp's floor at this width) and the card is the TV card.
  await page.waitForSelector(".tv-cast-track .tv-person-card", { timeout: 8000 });
  const cast = await page.evaluate(() => {
    const scroll = document.querySelector(".tv-cast-track .tv-media-track-scroll");
    const cards = [...scroll.querySelectorAll(".tv-person-card")].slice(0, 2).map((c) => c.getBoundingClientRect());
    return { gap: getComputedStyle(scroll).columnGap, basis: cards[0].width, pitch: cards[1].left - cards[0].left };
  });
  check("cast: gap is the cast token (14px)", cast.gap === "14px", cast.gap);
  check("cast: card width is the TV card (104px) and pitch is width plus gap", Math.abs(cast.basis - 104) <= 1 && Math.abs(cast.pitch - 118) <= 1, JSON.stringify(cast));
  await context.close();
}
{
  const { context, page } = await open("/series", { width: 1920, height: 1080 });
  await page.waitForSelector(".tv-title-card", { timeout: 8000 });
  await page.locator(".tv-title-card").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".tv-cast-track .tv-person-card", { timeout: 8000 });
  const gap = await page.evaluate(() => getComputedStyle(document.querySelector(".tv-cast-track .tv-media-track-scroll")).columnGap);
  check("cast: TV layout keeps its own gap (1.3vw, 25px at 1920)", Math.abs(parseFloat(gap) - 24.96) <= 1, gap);
  await context.close();
}

// 1.10033 and 1.10034: drawer close inset and the header action's right edge.
for (const theme of ["dark", "light"]) {
  const { context, page } = await open("/movies", phone);
  await setTheme(page, theme);
  await page.waitForSelector(".tv-title-card", { timeout: 8000 });
  await page.waitForTimeout(500);
  const action = await rect(page, ".shell-action-column .action-pill");
  const cards = await page.evaluate(() => [...document.querySelectorAll(".tv-title-card")].slice(0, 2).map((c) => c.getBoundingClientRect().right));
  // The grid ends beside the 52px letter rail (owner 2026-10-12); the header action keeps the page gutter like every other page.
  check(`${theme} library: header action sits at the page gutter, grid ends beside the letter rail`, action !== null && Math.abs(action.right - 374) <= 1 && Math.max(...cards) <= 338.5, `${action?.right} vs ${Math.max(...cards)}`);
  await page.locator(".shell-action-column .action-pill").first().click();
  await page.waitForSelector(".drawer .drawer-close", { timeout: 5000 });
  await page.waitForTimeout(700);
  const drawer = await rect(page, ".tv-filter-drawer");
  const close = await rect(page, ".drawer-close");
  const right = drawer.right - close.right;
  const top = close.top - drawer.top;
  check(`${theme} drawer: close button right inset equals top inset`, Math.abs(right - top) <= 1, `right ${right}, top ${top}`);
  await context.close();
}

// 1.10035 and 1.10036: Search keeps its prompt under the field and paints no block of its own.
const backgroundAt = (page, points) =>
  page.evaluate((pts) => pts.map(([x, y]) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const c = getComputedStyle(el).backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (m && (m[1].split(",").length < 4 || parseFloat(m[1].split(",")[3]) > 0.02)) return c;
    }
    return "none";
  }), points);
for (const theme of ["dark", "light"]) {
  const points = [[6, 500], [6, 650], [384, 500], [384, 650]];
  const search = await open("/search", phone);
  await setTheme(search.page, theme);
  await search.page.waitForSelector(".tv-search-form", { timeout: 8000 });
  await search.page.waitForTimeout(800);
  const form = await rect(search.page, ".tv-search-form");
  const empty = await rect(search.page, ".tv-search-rail-surface .tv-empty-state-art");
  check(`${theme} search: empty state directly under the field`, empty !== null && empty.top >= form.bottom && empty.top - form.bottom <= 32, `form bottom ${form.bottom}, empty top ${empty?.top}`);
  const searchColours = await backgroundAt(search.page, points);
  await search.context.close();
  const other = await open("/movies", phone);
  await setTheme(other.page, theme);
  await other.page.waitForTimeout(800);
  const otherColours = await backgroundAt(other.page, points);
  check(`${theme} search: background matches another page's`, JSON.stringify(searchColours) === JSON.stringify(otherColours), `${searchColours.join(" | ")} vs ${otherColours.join(" | ")}`);
  await other.context.close();
}

// Settings sub-pages: the h1 is the Settings title; a phone shows the section name in its place (owner rule 2026-10-14).
const tvTitle = await (async () => {
  const { context, page } = await open("/settings/appearance", { width: 1920, height: 1080 });
  await page.waitForSelector(".page-header h1", { timeout: 8000 });
  const title = await page.locator(".page-header h1").first().textContent();
  await context.close();
  return title?.trim();
})();
for (const section of ["appearance", "language", "player"]) {
  const { context, page } = await open(`/settings/${section}`, phone);
  await page.waitForSelector(".page-header h1", { state: "attached", timeout: 8000 });
  const h = await page.evaluate(() => {
    const detail = document.querySelector(".page-header .page-header-detail");
    return {
      title: document.querySelector(".page-header h1")?.textContent?.trim(),
      detail: detail?.textContent?.trim() ?? null,
      detailShown: detail ? getComputedStyle(detail).display !== "none" : false,
      subtitleStyle: detail?.classList.contains("page-header-detail") ?? false,
      detailSize: detail ? parseFloat(getComputedStyle(detail).fontSize) : 0,
      titleSize: parseFloat(getComputedStyle(document.querySelector(".page-header h1")).fontSize),
    };
  });
  check(`settings/${section}: h1 is the Settings title, as on TV web`, h.title === tvTitle, `${h.title} vs ${tvTitle}`);
  check(`settings/${section}: phone shows the section name (detail) instead of the title`, Boolean(h.detail) && h.detailShown && h.subtitleStyle && true, JSON.stringify(h));
  await context.close();
}
await finish();
