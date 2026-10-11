// Reference driver: the web TV client in Playwright (Chromium, 1920x1080, TV user agent). Contract: docs/parity/SUITE.md.
//   PLAYARR_WEB_URL (default https://playarr.app), PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD,
//   PARITY_CHROME (browser path, default Playwright's). Sessions are never shared: every run signs in fresh (new
//   browser profile, so a new device id) and keeps the session in memory only; nothing is written to disk.
import { chromium } from "playwright-core";

const KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", select: "Enter", back: "Escape" };
const UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";

export async function createDriver() {
  const env = process.env, web = (env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
  let browser, ctx, page, theme = "dark", session; // session: this run's own storage state, in memory
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };
  const open = async (keep = true) => {
    // Refresh tokens rotate: carry this run's live session into the next context (theme switch), or it comes up signed out.
    if (ctx && keep) session = await ctx.storageState();
    await ctx?.close();
    ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: UA, colorScheme: theme, locale: "en-GB", timezoneId: "Asia/Bangkok",
      ...(session ? { storageState: session } : {}) });
    await ctx.addInitScript((t) => localStorage.setItem("playarr-theme", t), theme);
    page = await ctx.newPage();
    await page.goto(web + "/", { waitUntil: "load" });
    await page.waitForTimeout(2500);
    if (!(await page.locator(".app-nav").count())) {
      if (!env.PLAYARR_USERNAME) throw new Error("signed out and PLAYARR_USERNAME/PLAYARR_PASSWORD not set");
      await page.goto(web + "/login", { waitUntil: "load" });
      await page.getByText(/sign in manually|manual/i).first().click().catch(() => {});
      await page.fill('input[name="server-url"]', env.PLAYARR_SERVER_URL);
      await page.fill('input[name="username"]', env.PLAYARR_USERNAME);
      await page.fill('input[name="password"]', env.PLAYARR_PASSWORD);
      await page.locator("button[type=submit]").click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
      await page.waitForTimeout(4000);
    }
  };
  return {
    async start() { browser = await chromium.launch(env.PARITY_CHROME ? { executablePath: env.PARITY_CHROME } : {}); await open(); },
    async stop() { await browser?.close(); },
    async setTheme(t) { if (t !== theme) { theme = t; await open(); } },
    async home() {
      await page.goto(web + "/", { waitUntil: "load" });
      await page.waitForTimeout(2500);
      // Signed out (the server can drop a session when other devices sign in): sign in again once.
      if (!(await page.locator(".app-nav").count())) { try { session = undefined; await open(false); } finally { await page.goto(web + "/", { waitUntil: "load" }); } }
      await page.waitForFunction(() => document.querySelectorAll(".app-nav-link").length >= 6 && !document.querySelector(".app-nav-link-placeholder") && document.querySelector(".tv-home-card"), null, { timeout: 30000 });
      // Home rails fill in asynchronously and reorder the cards: wait until the list holds still, then log the first card
      // so Home-rail drift (other clients' activity on the shared account) is visible next to the D-pad results.
      let last = "", still = 0;
      for (let i = 0; i < 40 && still < 3; i += 1) {
        const now = await page.evaluate(() => [...document.querySelectorAll(".tv-home-card")].map((c) => c.getAttribute("aria-label")).join("|"));
        still = now && now === last ? still + 1 : 0; last = now; await page.waitForTimeout(1500);
      }
      console.log(`  home first card: ${last.split("|")[0]}`);
      await page.evaluate(() => document.querySelector(".tv-home-card")?.focus());
      await settle();
    },
    async route(r) { await page.goto(web + r, { waitUntil: "load" }); await settle(); },
    async key(k, { long } = {}) {
      if (long) { await page.keyboard.down(KEYS[k]); await page.waitForTimeout(900); await page.keyboard.up(KEYS[k]); }
      else await page.keyboard.press(KEYS[k]);
      await page.waitForTimeout(350);
    },
    async location() { const u = new URL(page.url()); return u.pathname + u.search; },
    // Focused item label, or null when the page body has focus (a check then fails).
    async focused() {
      return page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        return e.getAttribute("aria-label") || e.textContent.trim().slice(0, 80) || e.className.toString();
      });
    },
    async screenshot(file) {
      await page.waitForFunction(() => ![...document.querySelectorAll("[class*=card-art]")].some((e) => !e.querySelector("img") && e.getBoundingClientRect().top < innerHeight), null, { timeout: 20000 }).catch(() => {});
      if (new URL(page.url()).pathname.startsWith("/login") || (await page.getByText("API request failed").count())) throw new Error("signed out or error page");
      await page.screenshot({ path: file });
    },
    // Plays media file `c.file` (a deep link on web; devices open it by their own means), returns {state, startSeconds, advancedSeconds, proxied}.
    async play(c, expect) {
      let proxied = false;
      page.on("request", (r) => { if (r.url().includes("/media/proxy/")) proxied = true; });
      await page.goto(web + "/player/" + c.file, { waitUntil: "load" });
      const t0 = Date.now();
      const pos = () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.error && v.readyState >= 2 ? v.currentTime : null; });
      let p0 = null;
      while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) { await page.waitForTimeout(500); p0 = await pos(); }
      if (p0 === null) return { state: "error", detail: "no frames in time" };
      const startSeconds = (Date.now() - t0) / 1000;
      await page.waitForTimeout((expect.advanceSeconds + 1) * 1000);
      const p1 = await pos();
      return { state: p1 !== null && p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 === null ? 0 : p1 - p0, proxied };
    },
  };
}
