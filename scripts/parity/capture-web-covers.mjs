#!/usr/bin/env node
// Web Library in Covers mode on a phone (360x780@3) at each artwork size and theme: <out>/<theme>/web-library-covers-<size>.png.
//   PARITY_CHROME=<chromium> node capture-web-covers.mjs --out <dir>   (Device Test credentials from the environment or ~/.secrets)
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1] ?? "web-covers";
const secrets = {};
try { for (const l of readFileSync(join(homedir(), ".secrets"), "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) secrets[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); } } catch {}
const env = { ...process.env };
env.PLAYARR_SERVER_URL ??= secrets.PLAYARR_DEVICE_TEST_SERVER_URL; env.PLAYARR_USERNAME ??= secrets.PLAYARR_DEVICE_TEST_USERNAME; env.PLAYARR_PASSWORD ??= secrets.PLAYARR_DEVICE_TEST_PASSWORD;
const web = (env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
const UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${["130", "0", "0", "0"].join(".")} Mobile Safari/537.36`;
const browser = await chromium.launch(env.PARITY_CHROME ? { executablePath: env.PARITY_CHROME } : {});
for (const theme of ["dark", "light"]) {
  mkdirSync(join(out, theme), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, colorScheme: theme, locale: "en-GB", timezoneId: "Asia/Bangkok" });
  await ctx.addInitScript((t) => { localStorage.setItem("playarr-theme", t); localStorage.setItem("playarr.libraryView.movie", "cover"); try { sessionStorage.clear(); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(`${web}/login`, { waitUntil: "load" });
  await page.getByText(/sign in manually|manual/i).first().click().catch(() => {});
  await page.fill('input[name="server-url"]', env.PLAYARR_SERVER_URL); await page.fill('input[name="username"]', env.PLAYARR_USERNAME); await page.fill('input[name="password"]', env.PLAYARR_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }); await page.waitForTimeout(4000);
  for (const size of ["small", "medium", "large"]) {
    await page.evaluate((s) => localStorage.setItem("playarr-artwork-size", s), size);
    await page.goto(`${web}/movies?view=cover`, { waitUntil: "load" }); await page.waitForTimeout(6000);
    await page.screenshot({ path: join(out, theme, `web-library-covers-${size}.png`) });
  }
  await ctx.close();
}
await browser.close();
