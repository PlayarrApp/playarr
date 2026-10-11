#!/usr/bin/env node
// Calendar agenda on a phone (390x844), light and dark, against the deterministic mock API (nav-perf/server.mjs):
//   1.10038 the agenda uses the standard page gutter on the left (same inset as the other mobile pages)
//   1.10039 no horizontal overflow, and every agenda item ends inside the viewport minus the gutter
//   1.10040 the sticky day headings are transparent (no opaque background) and a soft fade sits under them
//   1.10041 the navigation row stays fixed while the agenda scrolls, fits the viewport and is right-aligned flush with the content
// Set AGENDA_SHOTS=<dir> to also write screenshots.
//
//   node scripts/calendar-agenda-mobile-e2e.mjs [--no-build] [--dist dir]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const distIdx = args.indexOf("--dist");
const DIST = distIdx >= 0 ? args[distIdx + 1] : join(root, "dist");
if (!args.includes("--no-build") && distIdx < 0) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const server = await startServer({ distDir: DIST });
const base = `http://127.0.0.1:${server.port}`;
const dir = join(homedir(), ".cache/ms-playwright");
const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
const exe = process.env.NAV_PERF_CHROMIUM || (full ? join(dir, full, "chrome-linux64/chrome") : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SHOTS = process.env.AGENDA_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
  failed ||= !ok;
};

async function open(page, url, theme) {
  await page.context().addInitScript(({ base, userId, theme }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    localStorage.setItem("playarr-theme", theme);
  }, { base, userId: USER_ID, theme });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(url);
  await page.waitForSelector(".calendar-entry", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".calendar-scroll .skeleton, .tv-library-grid-panel .skeleton"));
  await page.waitForTimeout(500);
}

for (const theme of ["light", "dark"]) {
  const label = `390 ${theme}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await open(page, `${base}/calendar?view=agenda&date=2026-10-07`, theme);
  const shot = (name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) }) : null);
  await shot("agenda-top");

  // The gutter every other mobile page uses: the page header's left inset.
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const gutterPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-page-gutter"));
    const entries = [...document.querySelectorAll(".calendar-entry:not(.calendar-entry-skeleton)")].map((e) => e.getBoundingClientRect());
    const nav = document.querySelector(".calendar-nav-inline");
    const header = document.querySelector(".calendar-header");
    return {
      vw,
      scrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      gutter: gutterPx,
      entryLefts: entries.map((r) => r.left),
      entryRights: entries.map((r) => r.right),
      nav: rect(nav) && { l: rect(nav).left, r: rect(nav).right, t: rect(nav).top, b: rect(nav).bottom },
      header: rect(header) && { l: rect(header).left, r: rect(header).right },
    };
  });
  console.log(JSON.stringify(m));
  const gutter = m.gutter;
  check(`${label}: 1.10038 entries start at the page gutter (gutter ${gutter})`, gutter > 0 && m.entryLefts.every((l) => Math.abs(l - gutter) <= 1), JSON.stringify(m.entryLefts.slice(0, 3)));
  check(`${label}: 1.10039 no horizontal overflow (scrollWidth ${m.scrollW} vs ${m.vw})`, m.scrollW === m.vw && m.bodyScrollW <= m.vw, JSON.stringify(m));
  check(`${label}: 1.10039 every agenda item ends within the viewport minus the gutter`, m.entryRights.length > 0 && m.entryRights.every((r) => r <= m.vw - gutter + 1), JSON.stringify(m.entryRights.slice(0, 3)));

  // 1.10041: nav row fixed while scrolling.
  const navBefore = m.nav;
  await page.evaluate(() => {
    const g = document.querySelector(".tv-title-grid");
    g.style.scrollBehavior = "auto";
    g.scrollTop = 2000;
    window.scrollTo(0, 2000);
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".calendar-agenda-fade"), "::after").opacity === "1", null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await shot("agenda-scrolled");
  const after = await page.evaluate(() => {
    const r = document.querySelector(".calendar-nav-inline")?.getBoundingClientRect();
    const g = document.querySelector(".tv-title-grid");
    const heads = [...document.querySelectorAll(".calendar-agenda-content .calendar-day > h3")];
    const sticky = heads.find((h) => Math.abs(h.getBoundingClientRect().top - parseFloat(getComputedStyle(h).top) - g.getBoundingClientRect().top) <= 2) ?? heads[0];
    const cs = getComputedStyle(sticky);
    const content = document.querySelector(".calendar-agenda-content").getBoundingClientRect();
    const fadeEl = document.querySelector(".calendar-agenda-fade");
    return {
      scrollTop: g.scrollTop,
      winY: window.scrollY,
      nav: r && { l: r.left, r: r.right, t: r.top, b: r.bottom },
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      bgColor: cs.backgroundColor,
      bgImage: cs.backgroundImage,
      contentRight: content.right,
      fadeOpacity: getComputedStyle(fadeEl, "::after").opacity,
      fadeH: parseFloat(getComputedStyle(fadeEl, "::after").height),
      headH: sticky.getBoundingClientRect().height,
      fadeBg: getComputedStyle(fadeEl, "::after").backgroundImage,
    };
  });
  console.log(JSON.stringify(after));
  check(`${label}: 1.10041 the navigation row is unchanged after scrolling 2000px`, !!navBefore && !!after.nav && after.scrollTop > 0 && ["l", "r", "t", "b"].every((k) => Math.abs(after.nav[k] - navBefore[k]) <= 1), JSON.stringify({ navBefore, after: after.nav, scrollTop: after.scrollTop }));
  check(`${label}: 1.10041 the navigation row is fully inside the viewport`, !!after.nav && after.nav.l >= 0 && after.nav.r <= after.vw && after.nav.t >= 0 && after.nav.b <= after.vh, JSON.stringify(after.nav));
  check(`${label}: 1.10041 the navigation row is right-aligned flush with the content's right edge (+-1px)`, !!after.nav && Math.abs(after.nav.r - (after.vw - gutter)) <= 1, JSON.stringify({ nav: after.nav, vw: after.vw, gutter }));
  // 1.10040
  check(`${label}: 1.10040 the sticky day heading has no opaque background`, after.bgColor === "rgba(0, 0, 0, 0)" && (after.bgImage === "none" || !/rgb\(/.test(after.bgImage.replace(/rgba\([^)]*,\s*0\)/g, ""))), JSON.stringify({ bg: after.bgColor, img: after.bgImage }));
  check(`${label}: 1.10040 a soft fade sits under the sticky heading`, after.fadeOpacity === "1" && /gradient/.test(after.fadeBg ?? "") && /rgba?\(0, 0, 0, 0\)\s*\)?$/.test(after.fadeBg) && after.fadeH > after.headH, JSON.stringify({ h: after.fadeH, headH: after.headH, bg: after.fadeBg }));
  // A taller page header (wrapped title, larger text): the nav row follows the measured header bottom and the list starts below it.
  await page.evaluate(() => { const g = document.querySelector(".tv-title-grid"); g.style.scrollBehavior = "auto"; g.scrollTop = 0; });
  await page.addStyleTag({ content: ".calendar-page .page-header { min-height: 120px !important; height: 120px !important; }" });
  await page.waitForTimeout(400);
  const tall = await page.evaluate(() => {
    const h = document.querySelector('[data-page-id="calendar"] .page-header').getBoundingClientRect();
    const n = document.querySelector(".calendar-header-fixed").getBoundingClientRect();
    const firstHead = document.querySelector(".calendar-agenda-content .calendar-day > h3").getBoundingClientRect();
    return { headerBottom: h.bottom, navTop: n.top, navBottom: n.bottom, firstHeadTop: firstHead.top };
  });
  check(`${label}: 1.10041 with a taller header the nav row sits 8px under it and the list starts below the row`, tall.headerBottom > 100 && Math.abs(tall.navTop - (tall.headerBottom + 8)) <= 1.5 && tall.firstHeadTop >= tall.navBottom - 1, JSON.stringify(tall));
  await context.close();
}
await browser.close();
await server.close?.();
process.exit(failed ? 1 : 0);
