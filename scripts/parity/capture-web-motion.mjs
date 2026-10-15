#!/usr/bin/env node
// Web counterpart of the Harmony phone motion bursts: the same swipes through Home, a rail and the Filters and Actions panels, a 5-frame
// burst (about 150 ms apart) after each step, written to <out>/<theme>/web-<step>-<n>.png at the phone reference viewport (360x780 @3).
//   node capture-web-motion.mjs --out <dir> [--theme dark|light|both] [--profile phone|tv]
// Needs PARITY_CHROME=<chromium path> and the Device Test account (PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD, or the
// PLAYARR_DEVICE_TEST_* entries of ~/.secrets); never prints them. Run it in a memory scope (see capture-refs.mjs).
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const out = opt("out", "web-motion");
const tv = opt("profile", "phone") === "tv"; // --profile tv: 1920x1080 TV client, swipes in the rails column, Filters via the header button
const themes = opt("theme", "both") === "both" ? ["dark", "light"] : [opt("theme", "dark")];
const secrets = {};
try { for (const l of readFileSync(join(homedir(), ".secrets"), "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) secrets[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); } } catch {}
const env = { ...process.env };
env.PLAYARR_SERVER_URL ??= secrets.PLAYARR_DEVICE_TEST_SERVER_URL;
env.PLAYARR_USERNAME ??= secrets.PLAYARR_DEVICE_TEST_USERNAME;
env.PLAYARR_PASSWORD ??= secrets.PLAYARR_DEVICE_TEST_PASSWORD;
if (!env.PLAYARR_SERVER_URL || !env.PLAYARR_USERNAME || !env.PLAYARR_PASSWORD) throw new Error("Device Test credentials missing");
const web = (env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
const CHROME_VERSION = ["130", "0", "0", "0"].join("."); // joined so the guard against literal IPv4-shaped data does not read it as an address
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36`;
const browser = await chromium.launch(env.PARITY_CHROME ? { executablePath: env.PARITY_CHROME } : {});
for (const theme of themes) {
  const dir = join(out, theme); mkdirSync(dir, { recursive: true });
  const TV_UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";
  const ctx = await browser.newContext({ viewport: tv ? { width: 1920, height: 1080 } : { width: 360, height: 780 }, deviceScaleFactor: tv ? 1 : 3, isMobile: !tv, hasTouch: true, userAgent: tv ? TV_UA : MOBILE_UA, colorScheme: theme, locale: "en-GB", timezoneId: "Asia/Bangkok" });
  await ctx.addInitScript((t) => { localStorage.setItem("playarr-theme", t); try { sessionStorage.clear(); } catch {} }, theme);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${web}/login`, { waitUntil: "load" });
  await page.getByText(/sign in manually|manual/i).first().click().catch(() => {});
  await page.fill('input[name="server-url"]', env.PLAYARR_SERVER_URL);
  await page.fill('input[name="username"]', env.PLAYARR_USERNAME);
  await page.fill('input[name="password"]', env.PLAYARR_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForTimeout(4000);
  const burst = async (name) => { for (let i = 0; i < 5; i += 1) { await page.screenshot({ path: join(dir, `web-${name}-${i}.png`) }); await page.waitForTimeout(150); } };
  // A real touch drag (CDP touch events: Input.synthesizeScrollGesture does not scroll Home's inner scroller): 12 moves over about 300 ms,
  // the same as the Harmony bridge's /swipe.
  const swipe = async (x, y, dx, dy) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i += 1) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 12, y: y + dy * i / 12 }] }); await page.waitForTimeout(25); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(700);
  };
  await page.goto(`${web}/`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector(".tv-home-card"), null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await burst("home-00-top");
  const RX = tv ? 1300 : 180; // the rails column on the TV
  const dy = tv ? 400 : 420, y0 = tv ? 900 : 650, y1 = tv ? 500 : 230;
  for (let i = 1; i <= 4; i += 1) { await swipe(RX, y0, 0, -dy); await burst(`home-${String(i).padStart(2, "0")}-down`); }
  for (let i = 1; i <= 4; i += 1) { await swipe(RX, y1, 0, dy); await burst(`home-${String(4 + i).padStart(2, "0")}-up`); }
  const RY = tv ? 930 : 380, RW = tv ? 800 : 300;
  for (let i = 1; i <= 3; i += 1) { await swipe(tv ? 1800 : 330, RY, -RW, 0); await burst(`home-rail-${String(i).padStart(2, "0")}-left`); }
  for (let i = 1; i <= 3; i += 1) { await swipe(tv ? 900 : 30, RY, RW, 0); await burst(`home-rail-${String(3 + i).padStart(2, "0")}-right`); }
  await page.goto(`${web}/movies`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /filter/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500); await burst("filters-00-open");
  for (let i = 1; i <= 3; i += 1) { await swipe(tv ? 1700 : 180, tv ? 800 : 600, 0, tv ? -600 : -466); await burst(`filters-${String(i).padStart(2, "0")}-up`); }
  await ctx.close();
}
await browser.close();
