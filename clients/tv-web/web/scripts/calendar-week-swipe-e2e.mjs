#!/usr/bin/env node
// Calendar week on phones (390x844, 360x780, touch): horizontal swipe moves between day columns and snaps,
// vertical swipe scrolls a column, the document never scrolls sideways, today's column is visible on load.
// Desktop (1280) and TV (1920) week screenshots are written when WEEK_SHOTS=<dir> is set.
//
//   node scripts/calendar-week-swipe-e2e.mjs [--no-build] [--dist dir]
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
const SHOTS = process.env.WEEK_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
  failed ||= !ok;
};

async function open(viewport, touch, url) {
  const context = await browser.newContext({ viewport, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  await context.addInitScript(({ base, userId }) => {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId, name: "P", deviceId: "d", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId }));
    localStorage.setItem("playarr-theme", "dark");
  }, { base, userId: USER_ID });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${base}${url}`);
  await page.waitForSelector(".calendar-week-scroll .calendar-entry", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".calendar-week-scroll .skeleton"));
  await page.waitForTimeout(600);
  return { context, page };
}

// Touch drag through CDP so the browser's own scroller handles it.
async function swipe(page, x0, y0, x1, y1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(900);
}

const state = (page) => page.evaluate(() => {
  const s = document.querySelector(".calendar-week-scroll");
  const sr = s.getBoundingClientRect();
  const cols = [...s.querySelectorAll(".calendar-day")].map((d) => d.closest(".calendar-day-window") ?? d);
  const today = s.querySelector(".calendar-day.is-today");
  const tr = today?.getBoundingClientRect();
  return {
    left: s.scrollLeft, max: s.scrollWidth - s.clientWidth, vw: document.documentElement.clientWidth,
    docW: document.documentElement.scrollWidth, ta: getComputedStyle(s).touchAction, ob: getComputedStyle(s).overscrollBehaviorX,
    offsets: cols.map((c) => c.getBoundingClientRect().left - sr.left + s.scrollLeft),
    todayVisible: !!tr && tr.left >= sr.left - 1 && tr.right <= sr.right + 1,
    sr: { l: sr.left, r: sr.right },
  };
});

for (const [w, h] of process.env.WEEK_DESKTOP_ONLY ? [] : [[390, 844], [360, 780]]) {
  const label = `${w}x${h}`;
  const { context, page } = await open({ width: w, height: h }, true, "/calendar?view=week");
  const a = await state(page);
  console.log(label, JSON.stringify(a));
  check(`${label}: scroller can scroll sideways (max ${a.max})`, a.max > 50, JSON.stringify(a));
  check(`${label}: touch-action pans both axes, overscroll-x contained`, /pan-x/.test(a.ta) && /pan-y/.test(a.ta) || a.ta === "auto" ? a.ob === "contain" : false, `${a.ta} ${a.ob}`);
  check(`${label}: today's column visible on load`, a.todayVisible, JSON.stringify(a));
  const y = Math.round(h * 0.4);
  // Make the visible column taller than the screen so a vertical swipe has room (the mock week is short).
  await page.evaluate(() => {
    const col = [...document.querySelectorAll(".calendar-week-scroll .calendar-day")].find((d) => d.classList.contains("is-today")) ?? document.querySelector(".calendar-week-scroll .calendar-day");
    const pad = document.createElement("div");
    pad.style.height = "2000px";
    col.append(pad);
  });
  // Today is usually the last day (nowhere to go forward), so swipe towards the side that has room.
  const dir = a.left >= a.max - 1 ? 1 : -1;
  await swipe(page, Math.round(w * (dir > 0 ? 0.2 : 0.8)), y, Math.round(w * (dir > 0 ? 0.8 : 0.2)), y);
  const b = await state(page);
  console.log(label, "after swipe", b.left);
  check(`${label}: swipe moved scrollLeft (${a.left} -> ${b.left})`, Math.abs(b.left - a.left) > 20, "");
  check(`${label}: scrollLeft snapped to a column boundary`, b.offsets.some((o) => Math.abs(o - b.left) <= 1) || Math.abs(b.left - b.max) <= 1, JSON.stringify({ left: b.left, offsets: b.offsets }));
  await swipe(page, Math.round(w * (dir > 0 ? 0.8 : 0.2)), y, Math.round(w * (dir > 0 ? 0.2 : 0.8)), y);
  const c = await state(page);
  check(`${label}: swipe back moved scrollLeft (${b.left} -> ${c.left})`, Math.abs(c.left - b.left) > 20, "");
  // Vertical swipe inside the column that has entries.
  const col = await page.evaluate(() => {
    const cols = [...document.querySelectorAll(".calendar-week-scroll .calendar-day")];
    const s = document.querySelector(".calendar-week-scroll").getBoundingClientRect();
    const c = cols.find((d) => { const r = d.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1 && d.scrollHeight > d.clientHeight + 20; });
    if (c) c.scrollTop = 0;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top, h: r.height };
  });
  if (col) {
    await swipe(page, col.x, col.top + col.h * 0.8, col.x, col.top + col.h * 0.2);
    const st = await page.evaluate(() => Math.max(...[...document.querySelectorAll(".calendar-week-scroll .calendar-day")].map((d) => d.scrollTop)));
    const d = await state(page);
    check(`${label}: vertical swipe scrolls the column (scrollTop ${st}) without moving sideways`, st > 0 && Math.abs(d.left - c.left) <= 1, JSON.stringify({ st, d: d.left, c: c.left }));
  } else console.log(`SKIP  ${label}: no overflowing column in the mock data for the vertical swipe`);
  const e = await state(page);
  check(`${label}: document width stays the viewport (${e.docW} vs ${e.vw})`, e.docW <= e.vw, "");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `week-${label}.png`) });
  await context.close();
}

for (const [w, h] of [[1280, 800], [1920, 1080]]) {
  const { context, page } = await open({ width: w, height: h }, false, "/calendar?view=week&date=2026-10-07");
  const e = await state(page);
  check(`${w}: document width stays the viewport`, e.docW <= e.vw, JSON.stringify(e));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `week-${w}.png`) });
  await context.close();
}

await browser.close();
server.close?.();
process.exit(failed ? 1 : 0);
