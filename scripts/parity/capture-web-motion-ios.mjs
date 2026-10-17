#!/usr/bin/env node
// Web counterpart of the iOS scripted Home scroll (clients/ios ParityLaunch --playarr-parity-motion): the phone profile
// (393x852, touch) scrolls Home down through every rail, back up, then each rail to its last card, with a burst of 5 frames
// about 150 ms apart after every step: <out>/<theme>/step-NN-i.png.
//   node capture-web-motion-ios.mjs --out <dir> [--theme dark|light|both]
// Needs PLAYARR_WEB_URL (default https://playarr.app), PLAYARR_TEST_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD
// (credentials may come from ~/.secrets PLAYARR_DEVICE_TEST_* when unset; never printed) and PARITY_CHROMIUM or Playwright's chromium.
// Run it in a memory scope: systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- node ...
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { resolveTestServerUrl } from "./test-server-env.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const out = opt("out", "motion-out");
const sec = {};
try { for (const l of readFileSync(`${homedir()}/.secrets`, "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) sec[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); } } catch { /* env only */ }
const web = (process.env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
const server = resolveTestServerUrl(process.env), user = process.env.PLAYARR_USERNAME ?? sec.PLAYARR_DEVICE_TEST_USERNAME, pass = process.env.PLAYARR_PASSWORD ?? sec.PLAYARR_DEVICE_TEST_PASSWORD;
const themes = opt("theme", "dark") === "both" ? ["dark", "light"] : [opt("theme", "dark")];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.PARITY_CHROMIUM || undefined });
for (const theme of themes) {
  const dir = join(out, theme); mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto(`${web}/login`);
  await page.fill("#login-server-url", server).catch(() => {});
  await page.fill("#login-username", user);
  await page.fill('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  await page.goto(`${web}/`); await page.waitForTimeout(6000);
  const rails = await page.locator(".tv-home-rails > *").count();
  console.log(`${theme}: ${rails} rail elements`);
  let step = 0;
  const burst = async () => { step += 1; await sleep(4000); for (let i = 0; i < 5; i += 1) { await page.screenshot({ path: join(dir, `step-${String(step).padStart(2, "0")}-${i}.png`) }); await sleep(150); } };
  const scrollRail = (i) => page.locator(".tv-home-rails > *").nth(i).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  for (let i = 1; i < rails; i += 1) { await scrollRail(i); await burst(); }
  for (let i = rails - 2; i >= 0; i -= 1) { await scrollRail(i); await burst(); }
  for (let i = 0; i < rails; i += 1) {
    await page.locator(".tv-home-rails > *").nth(i).evaluate((el) => { const t = [...el.querySelectorAll("*")].find((n) => n.scrollWidth > n.clientWidth + 8 && getComputedStyle(n).overflowX !== "visible"); t?.scrollTo({ left: t.scrollWidth, behavior: "smooth" }); });
    await burst();
  }
  await ctx.close();
}
await browser.close();
