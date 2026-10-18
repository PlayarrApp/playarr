#!/usr/bin/env node
// Owner rule 2026-10-18: no content under the left nav, anywhere. Walks every routed page of the shell at each width
// (dark; light at spot widths) and fails when a visible element's box intersects a nav group's box. Full-bleed art that
// is meant to sit behind the nav carries `data-nav-behind` (or sits inside such an element) and is exempt.
// Prints a table of offenders (route, width, element, boxes).
//   node scripts/nav-overlap-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish, base } = await boot({ canDownload: true, movies: 24, series: 8, artists: 4, playlists: 2, watchlist: 3, folders: true }, { realisticAuth: true });
const first = async (kind) => (await (await fetch(`${base}/api/v1/catalog?kind=${kind}&limit=1`, { headers: { authorization: "Bearer t" } })).json()).items[0]?.id;
const [movieId, seriesId, artistId] = [await first("movie"), await first("series"), await first("artist")];

const ROUTES = [
  "/", "/downloads", "/movies", "/series", "/music", "/sites", "/search", "/search?q=a", "/watchlist", "/requests", "/playlists", "/calendar",
  "/calendar?view=month&date=2026-10-07", "/folders", "/settings", "/settings/appearance", "/settings/profile-avatar", "/settings/language",
  "/settings/player", "/settings/server", "/settings/profile-lock", "/settings/invite", "/settings/request-latency", "/settings/remote",
  "/settings/your-data", "/settings/home", `/movies/${movieId}`, `/series/${seriesId}`, `/music/${artistId}`, "/clients", "/no-such-page",
];
const WIDTHS = process.env.NAV_OVERLAP_QUICK ? [390, 768, 1280] : [360, 390, 600, 768, 900, 1024, 1180, 1280, 1440, 1920];
const LIGHT_WIDTHS = [390, 768, 1280];

function offenders() {
  let groups = [...document.querySelectorAll(".app-nav .app-nav-group")].map((g) => g.getBoundingClientRect()).filter((r) => r.width && r.height);
  if (!groups.length) groups = [...document.querySelectorAll(".app-nav")].map((g) => g.getBoundingClientRect()).filter((r) => r.width && r.height);
  if (!groups.length) return { nav: false, hits: [] };
  const hits = [];
  // A bottom bar (phones) floats over a page that scrolls beneath it by design; only the side rail reserves a column.
  const navBox = document.querySelector(".app-nav").getBoundingClientRect();
  if (navBox.width > navBox.height) return { nav: true, hits };
  for (const el of document.querySelectorAll("[data-page-id] *, .page-header *")) {
    if (el.closest(".app-nav, [data-nav-behind], [aria-hidden='true'], .skeleton-state")) continue;
    const css = getComputedStyle(el);
    if (css.visibility === "hidden" || css.display === "none") continue;
    let opacity = 1;
    for (let p = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
    if (opacity < 0.05) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own && !/^(BUTTON|A|INPUT|SELECT|IMG|CANVAS|TEXTAREA|SVG|VIDEO)$/i.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Painted only where every clipping ancestor lets it show.
    let box = r;
    for (let p = el.parentElement; p && box; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(o.overflowX + o.overflowY)) {
        const pr = p.getBoundingClientRect();
        const l = Math.max(box.left, pr.left), rt = Math.min(box.right, pr.right), t = Math.max(box.top, pr.top), b = Math.min(box.bottom, pr.bottom);
        box = rt > l && b > t ? { left: l, right: rt, top: t, bottom: b } : null;
      }
    }
    if (!box) continue;
    for (const g of groups) {
      if (box.left < g.right - 0.5 && box.right > g.left + 0.5 && box.top < g.bottom - 0.5 && box.bottom > g.top + 0.5) {
        hits.push(`${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(" ")[0]} x[${Math.round(box.left)}-${Math.round(box.right)}] y[${Math.round(box.top)}-${Math.round(box.bottom)}] nav x[${Math.round(g.left)}-${Math.round(g.right)}] y[${Math.round(g.top)}-${Math.round(g.bottom)}]`);
        break;
      }
    }
  }
  return { nav: true, hits };
}

const table = [];
for (const [theme, widths] of process.env.NAV_OVERLAP_HERO_ONLY ? [] : [["dark", WIDTHS], ["light", LIGHT_WIDTHS]]) {
  for (const width of widths) {
    for (const route of ROUTES) {
      const { page, context } = await open(route, { width, height: width < 700 ? 800 : 720, theme });
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(500);
      const { nav, hits } = await page.evaluate(offenders);
      for (const h of hits.slice(0, 4)) table.push({ theme, width, route, hit: h });
      check(`${theme} ${width} ${route}: nothing under the nav`, nav && hits.length === 0, nav ? hits.slice(0, 2).join(" | ") : "no nav");
      await context.close();
    }
  }
}
if (table.length) {
  console.log("\ntheme  width  route  offender");
  for (const r of table) console.log(`${r.theme}\t${r.width}\t${r.route}\t${r.hit}`);
}
// Hero details panel (title, meta, synopsis, buttons): short heights and browser zoom shrink the CSS viewport (125% of
// 1280x720 is 1024x576, 150% is 853x480), which is where the left panel used to slide under the rail.
const HERO_ROUTES = ["/", "/movies", "/series", "/music", `/movies/${movieId}`, `/series/${seriesId}`];
const heroSizes = [];
for (const h of process.env.NAV_OVERLAP_QUICK ? [600, 768] : [600, 700, 768, 900, 1080]) for (const w of process.env.NAV_OVERLAP_QUICK ? [768, 1280] : [768, 900, 1024, 1180, 1280, 1440]) heroSizes.push([w, h, `${w}x${h}`]);
for (const [w, h, z] of [[1280, 720, 1.25], [1280, 720, 1.5], [1440, 900, 1.25], [1440, 900, 1.5]]) heroSizes.push([Math.round(w / z), Math.round(h / z), `${w}x${h}@${z * 100}%`]);
for (const [w, h, label] of heroSizes) {
  for (const route of HERO_ROUTES) {
    const { page, context } = await open(route, { width: w, height: h });
    await page.waitForTimeout(500);
    const { nav, hits } = await page.evaluate(offenders);
    check(`hero ${label} ${route}: nothing under the nav`, nav && hits.length === 0, nav ? hits.slice(0, 2).join(" | ") : "no nav");
    await context.close();
  }
}
// Tall and near-square desktop windows (owner repro 2026-10-18: 1600x1164). The rail is at its full 64 px tile height from
// 1080 px up, and the hero column is placed from the width only, so every tall size must keep the title clear of it too.
// Checked specifically: the hero title (the widest text of the left column) must exist, and its leftmost glyph, not just its
// box, must start beyond the rail's right edge plus a gap. 1600x1164 also runs at devicePixelRatio 2 and with a classic
// 15 px scrollbar (the first two are the sizes an owner screenshot at 2x or a Windows browser gives).
const TALL = process.env.NAV_OVERLAP_QUICK
  ? [[1600, 1164]]
  : [[1600, 1164], [1440, 1080], [1280, 1024], [1024, 1024], [1366, 1366], [1080, 1920]];
const classicScrollbar = "html, body { overflow-y: scroll !important; } ::-webkit-scrollbar { width: 15px; height: 15px; }";
const tallVariants = [];
for (const [w, h] of TALL) tallVariants.push({ w, h, label: `${w}x${h}`, dpr: 1 });
tallVariants.push({ w: 1600, h: 1164, label: "1600x1164@2x", dpr: 2 }, { w: 1600, h: 1164, label: "1600x1164 scrollbar", dpr: 1, scrollbar: true });

function heroTitleGap() {
  const groups = [...document.querySelectorAll(".app-nav .app-nav-group")].map((g) => g.getBoundingClientRect()).filter((r) => r.width && r.height);
  const nav = document.querySelector(".app-nav")?.getBoundingClientRect();
  if (!groups.length || !nav || nav.width > nav.height) return { nav: false };
  const navRight = Math.max(...groups.map((g) => g.right));
  const titles = [...document.querySelectorAll(".details-panel-title, .tv-detail-title")].filter((el) => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== "hidden");
  const lefts = titles.flatMap((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [el.getBoundingClientRect().left, ...[...range.getClientRects()].filter((r) => r.width).map((r) => r.left)];
  });
  return { nav: true, titles: titles.length, navRight, left: lefts.length ? Math.min(...lefts) : null };
}

for (const { w, h, label, dpr, scrollbar } of tallVariants) {
  for (const route of HERO_ROUTES) {
    const { page, context } = await open(route, { width: w, height: h, contextOptions: { deviceScaleFactor: dpr }, init: scrollbar ? `document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(classicScrollbar)}; document.head.append(s); });` : undefined });
    await page.waitForTimeout(500);
    const { nav, hits } = await page.evaluate(offenders);
    check(`tall ${label} ${route}: nothing under the nav`, nav && hits.length === 0, nav ? hits.slice(0, 2).join(" | ") : "no nav");
    const t = await page.evaluate(heroTitleGap);
    const ok = t.nav && t.titles > 0 && t.left !== null && t.left >= t.navRight + 8;
    check(`tall ${label} ${route}: hero title clear of the nav`, ok, t.nav ? `titles ${t.titles}, leftmost glyph ${t.left}, nav right ${t.navRight}` : "no nav");
    await context.close();
  }
}
// Phones: a page without the library letter rail reserves no gutter for it. The cards fill the row to the page gutter.
for (const route of ["/search?q=a", "/watchlist", "/playlists", "/movies"]) {
  const { page, context } = await open(route, { width: 390, height: 800 });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".media-card")].map((c) => c.getBoundingClientRect()).filter((r) => r.width);
    return { rail: Boolean(document.querySelector(".tv-alphabet")), right: Math.max(0, ...cards.map((r) => r.right)) };
  });
  if (!m.right) { check(`390 ${route}: has cards`, false, "no cards"); }
  else if (m.rail) check(`390 ${route}: letter rail keeps its gutter`, 390 - m.right >= 48, `gap ${390 - m.right}`);
  else check(`390 ${route}: no rail, no rail gutter`, 390 - m.right <= 20, `gap ${390 - m.right}`);
  await context.close();
}
await finish();
