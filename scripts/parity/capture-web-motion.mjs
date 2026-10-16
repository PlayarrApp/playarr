#!/usr/bin/env node
// Capture deliberate web motion samples. CSS/Web Animations are disabled so only the requested gesture and frame cadence vary.
//   node capture-web-motion.mjs --out <dir> [--theme dark|light|both] [--profile phone|tv] [--keys]
// Requires an isolated PARITY_CLIENT, PARITY_LOCK_DIR, and a valid PARITY_FIXED_NOW or FIXTURE_CLOCK.
import { applyCanonicalDeck } from "./canonical-deck.mjs";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { withCaptureState } from "./capture-state.mjs";
import { FIXTURE_CLOCK } from "../fixtures/catalog.mjs";
import { clickIfPresent, installVisualDate } from "./drivers/web.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const out = resolve(opt("out", "web-motion"));
const tv = opt("profile", "phone") === "tv";
const keys = args.includes("--keys");
const themes = opt("theme", "both") === "both" ? ["dark", "light"] : [opt("theme", "dark")];
const fixedNow = process.env.PARITY_FIXED_NOW ?? FIXTURE_CLOCK;
if (!Number.isFinite(Date.parse(fixedNow))) throw new Error("PARITY_FIXED_NOW must be a valid ISO date");
if (!process.env.PARITY_CLIENT || !process.env.PARITY_LOCK_DIR) throw new Error("PARITY_CLIENT and PARITY_LOCK_DIR are required for isolated web-motion capture");
const web = (process.env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
const CHROME_VERSION = ["130", "0", "0", "0"].join(".");
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36`;
const TV_UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";

const waitReady = async (page, screen, phase) => {
  await page.waitForFunction(({ screen, phase }) => {
    if (document.fonts?.status !== "loaded") return false;
    const pendingImages = [...document.images].some((image) => image.getAttribute("src") && (!image.complete || image.naturalWidth === 0));
    if (pendingImages) return false;
    if (document.querySelector('[aria-busy="true"], [data-loading="true"]')) return false;
    if (phase === "route" && screen === "home") return Boolean(document.querySelector(".tv-home-card"));
    if (phase === "route" && screen === "movies") return Boolean(document.querySelector(".tv-library-card, [data-testid='library-card']"));
    return true;
  }, { screen, phase }, { timeout: 30000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

await withCaptureState({ client: process.env.PARITY_CLIENT, files: [] }, async (captureState) => {
  Object.assign(process.env, captureState.env);
  await applyCanonicalDeck(captureState);
  const snapshot = await captureState.snapshotNow();
  const browser = await chromium.launch(process.env.PARITY_CHROME ? { executablePath: process.env.PARITY_CHROME } : {});
  captureState.registerInterruptCleanup(() => browser.close());
  try {
    for (const theme of themes) {
      const dir = join(out, theme); mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: tv ? { width: 1920, height: 1080 } : { width: 360, height: 780 }, deviceScaleFactor: tv ? 1 : 3, isMobile: !tv, hasTouch: true, userAgent: tv ? TV_UA : MOBILE_UA, colorScheme: theme, locale: "en-GB", timezoneId: "Asia/Bangkok", reducedMotion: "reduce" });
      await ctx.addInitScript(installVisualDate, fixedNow);
      await ctx.addInitScript(({ theme }) => {
        localStorage.setItem("playarr-theme", theme);
        try { sessionStorage.clear(); } catch {}
        const css = document.createElement("style");
        css.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}";
        (document.head ?? document.documentElement).append(css);
      }, { theme });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await page.goto(`${web}/login`, { waitUntil: "load" });
      await clickIfPresent(page.getByText(/sign in manually|manual/i).first());
      await page.fill('input[name="server-url"]', captureState.env.PLAYARR_SERVER_URL);
      await page.fill('input[name="username"]', captureState.env.PLAYARR_USERNAME);
      await page.fill('input[name="password"]', captureState.env.PLAYARR_PASSWORD);
      await page.locator("button[type=submit]").click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
      await page.waitForSelector(".app-nav-link", { timeout: 30000 });
      await page.goto(`${web}/`, { waitUntil: "load" });
      await waitReady(page, "home", "route");
      // Five samples at deliberate 150 ms intervals preserve the motion comparison's temporal signal.
      const burst = async (name) => { for (let i = 0; i < 5; i += 1) { await page.evaluate(() => document.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())); await page.screenshot({ path: join(dir, `web-${name}-${i}.png`) }); if (i < 4) await page.waitForFunction((start) => performance.now() >= start + 150, await page.evaluate(() => performance.now())); } };
      const swipe = async (x, y, dx, dy) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let i = 1; i <= 12; i += 1) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 12, y: y + dy * i / 12 }] }); await page.waitForFunction((start) => performance.now() >= start + 25, await page.evaluate(() => performance.now())); }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      await burst("home-00-top");
      if (tv && keys) {
        const press = async (key, n = 1) => { for (let i = 0; i < n; i += 1) await page.keyboard.press(key); };
        await page.keyboard.press("ArrowRight"); await burst("home-00-enter");
        for (let i = 1; i <= 3; i += 1) { await press("ArrowDown"); await burst(`home-${String(i).padStart(2, "0")}-down`); }
        for (let i = 1; i <= 2; i += 1) { await press("ArrowUp"); await burst(`home-${String(3 + i).padStart(2, "0")}-up`); }
        await press("ArrowRight", 14); await burst("home-06-right-end");
        await page.goto(`${web}/movies`, { waitUntil: "load" }); await waitReady(page, "movies", "route");
        await page.getByRole("button", { name: /filter/i }).first().click();
        await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"], [data-testid*="filter"]')].some((node) => node.getClientRects().length > 0)); await burst("filters-00-open");
        await press("ArrowDown", 14); await burst("filters-01-bottom");
        await ctx.close();
        continue;
      }
      const RX = tv ? 1300 : 180, dy = tv ? 400 : 420, y0 = tv ? 900 : 650, y1 = tv ? 500 : 230;
      for (let i = 1; i <= 4; i += 1) { await swipe(RX, y0, 0, -dy); await burst(`home-${String(i).padStart(2, "0")}-down`); }
      for (let i = 1; i <= 4; i += 1) { await swipe(RX, y1, 0, dy); await burst(`home-${String(4 + i).padStart(2, "0")}-up`); }
      const RY = tv ? 930 : 380, RW = tv ? 800 : 300;
      for (let i = 1; i <= 3; i += 1) { await swipe(tv ? 1800 : 330, RY, -RW, 0); await burst(`home-rail-${String(i).padStart(2, "0")}-left`); }
      for (let i = 1; i <= 3; i += 1) { await swipe(tv ? 900 : 30, RY, RW, 0); await burst(`home-rail-${String(3 + i).padStart(2, "0")}-right`); }
      await page.goto(`${web}/movies`, { waitUntil: "load" }); await waitReady(page, "movies", "route");
      await page.getByRole("button", { name: /filter/i }).first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"], [data-testid*="filter"]')].some((node) => node.getClientRects().length > 0)); await burst("filters-00-open");
      for (let i = 1; i <= 3; i += 1) { await swipe(tv ? 1700 : 180, tv ? 800 : 600, 0, tv ? -600 : -466); await burst(`filters-${String(i).padStart(2, "0")}-up`); }
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`motion capture state ${snapshot.hash}; clock ${fixedNow}; animations/transitions suppressed, gesture and 150 ms frame cadence retained`);
});
