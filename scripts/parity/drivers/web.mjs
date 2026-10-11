// Reference driver: the web TV client in Playwright (Chromium, 1920x1080, TV user agent). Contract: docs/parity/SUITE.md.
//   PLAYARR_WEB_URL (default https://playarr.app), PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD,
//   PARITY_CHROME (browser path, default Playwright's). Sessions are never shared: every run signs in fresh (new
//   browser profile, so a new device id) and keeps the session in memory only; nothing is written to disk.
import { chromium } from "playwright-core";

const KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", select: "Enter", back: "Escape" };
const UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";

export async function createDriver() {
  const env = process.env, web = (env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
  let cdp, browser, ctx, page, theme = "dark", session; // session: this run's own storage state, in memory
  const touched = new Set(); // downloadMedia entries the downloads cases used
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };
  const open = async (keep = true) => {
    // Refresh tokens rotate: carry this run's live session into the next context (theme switch), or it comes up signed out.
    if (ctx && keep) session = await ctx.storageState();
    cdp = undefined; await ctx?.close();
    ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: UA, colorScheme: theme, locale: "en-GB", timezoneId: "Asia/Bangkok",
      ...(session ? { storageState: session } : {}) });
    await ctx.addInitScript((t) => localStorage.setItem("playarr-theme", t), theme);
    await ctx.grantPermissions(["notifications"], { origin: web }).catch(() => {});
    // Records system notifications (Notifications API) and Media Session handlers; kept in sessionStorage across reloads.
    await ctx.addInitScript(() => {
      const log = (n) => { try { const a = JSON.parse(sessionStorage.getItem("__notes") || "[]"); a.push({ ...n, at: Date.now() }); sessionStorage.setItem("__notes", JSON.stringify(a)); } catch {} };
      const N = window.Notification;
      if (N) {
        window.Notification = function (title, o) { log({ title, body: o?.body ?? "", tag: o?.tag ?? "" }); return new N(title, o); };
        window.Notification.prototype = N.prototype;
        Object.defineProperty(window.Notification, "permission", { get: () => N.permission });
        window.Notification.requestPermission = N.requestPermission.bind(N);
      }
      const sw = window.ServiceWorkerRegistration?.prototype;
      if (sw?.showNotification) { const f = sw.showNotification; sw.showNotification = function (title, o) { log({ title, body: o?.body ?? "", tag: o?.tag ?? "" }); return f.call(this, title, o); }; }
      window.__mediaHandlers = {};
      const ms = navigator.mediaSession;
      if (ms) { const f = ms.setActionHandler.bind(ms); ms.setActionHandler = (a, h) => { window.__mediaHandlers[a] = h; return f(a, h); }; }
    });
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
  // "Frames advance": the video has data, then its playhead moves by advanceSeconds.
  const frames = async (expect) => {
    const t0 = Date.now();
    const pos = () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.error && v.readyState >= 2 ? v.currentTime : null; });
    let p0 = null;
    while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) { await page.waitForTimeout(500); p0 = await pos(); }
    if (p0 === null) return { state: "error", detail: "no frames in time" };
    const startSeconds = (Date.now() - t0) / 1000;
    await page.waitForTimeout((expect.advanceSeconds + 1) * 1000);
    const p1 = await pos();
    return { state: p1 !== null && p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 === null ? 0 : p1 - p0 };
  };
  // Profiling data for the performance epic (not scored): negotiated mode, the server's own play-method facts (source and
  // delivered codec, resolution, bitrate, dynamic range, audio), the decoded size, time to first frame, any 503 or stall.
  const profile = async (neg, r) => {
    const info = neg.info, q = info?.quality_options?.find((o) => o.id === info.selected_quality_id);
    let health = {};
    if (info?.session_id) {
      health = await page.evaluate(async (id) => {
        const tok = JSON.parse(localStorage.getItem("playarr:session")).accessToken, base = localStorage.getItem("playarr:apiBaseUrl").replace(/"/g, "");
        const res = await fetch(`${base}/api/v1/playback/sessions/${id}/health`, { method: "POST", headers: { Authorization: "Bearer " + tok, "content-type": "application/json" }, body: "{}" });
        const j = res.ok ? await res.json() : {};
        return { play_method: j.play_method, ...Object.fromEntries((j.facts ?? []).filter((f) => f.value != null && f.value !== "null").map((f) => [f.key, f.value])) };
      }, info.session_id).catch(() => ({}));
    }
    const size = await page.evaluate(() => { const v = document.querySelector("video"); return v ? { width: v.videoWidth, height: v.videoHeight } : null; });
    return { mode: info?.mode ?? null, playMethod: health.play_method ?? null, quality: q ? { id: q.id, height: q.height, bitrate: q.video_bitrate_bps } : null, health, decoded: size,
      timeToFirstFrameSeconds: r.startSeconds ?? null, negotiationStatuses: neg.statuses, no_transcode_capacity: neg.statuses.includes(503), stalled: r.state === "stalled" };
  };
  // ---- Downloads page helpers. A TV episode lives under a series group (series > season > episode); a movie is one row.
  const touchedNote = "touched";
  const dl = (m) => {
    const series = () => page.locator("li.tv-download-group[data-level='1'] > .tv-download-group-row", { hasText: m.title });
    const season = () => page.locator("li.tv-download-group[data-level='2'] > .tv-download-group-row", { hasText: `Season ${m.season}` /* shortcut: also matches Season 20, fine for the one pinned season */ });
    const row = () => (m.episode ? series() : page.locator(".tv-download-row:not(.tv-download-group-row)", { hasText: m.title }));
    const list = async () => { await page.goto(web + "/downloads", { waitUntil: "load" }); await page.waitForTimeout(2500); };
    const button = (loc, name) => loc.first().getByRole("button", { name: new RegExp(`^${name}$`, "i") });
    // Delete asks for confirmation in a drawer.
    const del = async (loc) => { await button(loc, "delete").click(); await page.locator(".download-quality-drawer .is-primary").click(); };
    const gone = () => page.waitForFunction((t) => !document.body.innerText.includes(t) || ![...document.querySelectorAll(".tv-download-row")].some((x) => x.textContent.includes(t)), m.title, { timeout: 20000 }).then(() => true, () => false);
    const expand = async (loc) => { const tog = loc.first().locator("button[aria-expanded]"); if ((await tog.getAttribute("aria-expanded")) === "false") await tog.click(); await page.waitForTimeout(800); };
    const status = async (loc = row()) => ((await loc.first().locator(".tv-download-row-meta").textContent({ timeout: 3000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
    const waitFor = async (re, ms, loc = row()) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const st = await status(loc);
        if (re.test(st)) return st;
        if (/failed/i.test(st)) throw new Error("download failed: " + st);
        await page.waitForTimeout(1500);
      }
      throw new Error(`timed out waiting for ${re}: ${await status(loc)}`);
    };
    // Slows the network (CDP) so a small file is still downloading when a case pauses or cancels it.
    const throttle = async (on) => {
      cdp ??= await ctx.newCDPSession(page); // one session: a second one would not undo the first
      await cdp.send("Network.emulateNetworkConditions", on ? { offline: false, latency: 50, downloadThroughput: 300 * 1024, uploadThroughput: -1 } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    };
    const clean = async () => {
      await list();
      for (let i = 0; i < 5 && (await row().count()); i += 1) { await del(row()); await page.waitForTimeout(1500); }
    };
    const start = async (again = true) => {
      if (m.episode) {
        await page.goto(`${web}/series/${m.work}`, { waitUntil: "load" });
        const card = page.locator(`a.tv-episode-card[href$="${m.file}"]`).first();
        await card.waitFor({ timeout: 20000 });
        await card.focus();
        await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter");
        await page.waitForSelector(".media-context-drawer", { timeout: 10000 });
        await page.waitForTimeout(600);
        await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
      } else {
        await page.goto(`${web}/movies/${m.work}`, { waitUntil: "load" });
        for (let i = 0; i < 4 && !(await page.locator(".download-quality-drawer").count()); i += 1) {
          await page.locator("button.tv-detail-download").first().click({ timeout: 20000 });
          await page.waitForSelector(".download-quality-drawer", { timeout: 5000 }).catch(() => {});
        }
      }
      await page.waitForSelector(".download-quality-drawer .ui-select-trigger", { timeout: 20000 });
      for (let i = 0; i < 3 && !(await page.locator(".ui-select-option").count()); i += 1) { await page.locator(".ui-select-trigger").click(); await page.waitForTimeout(800); }
      await page.locator(".ui-select-option").first().click(); // original: ready at once, no transcode slot; the pinned files are the smallest originals
      await page.locator(".download-quality-drawer .is-primary").click();
      await page.waitForTimeout(1500);
      await list();
      await row().first().waitFor({ timeout: 15000 }).catch(() => {});
      if (!(await row().count())) { if (again) return start(false); throw new Error("no row on the Downloads page after starting"); } // the first request after sign-in can be dropped
    };
    return { row, series, season, list, button, del, gone, expand, status, waitFor, throttle, clean, start, touchedNote };
  };
  const ready = /downloaded/i;
  const ok = (detail) => ({ state: "ok", detail });
  const bad = (detail) => ({ state: "failed", detail });
  async function dlCase(c, m, r, limit) {
    switch (c.action) {
      case "start": { await r.start(); return ok(await r.waitFor(ready, limit)); }
      case "pause-resume": {
        await r.throttle(true); await r.start();
        if (!(await r.button(r.row(), "pause").count())) return bad("no Pause control on the Downloads page");
        await r.button(r.row(), "pause").click(); await r.waitFor(/paused/i, 15000);
        await r.button(r.row(), "resume").click(); await r.waitFor(/downloading|queued|processing/i, 15000);
        await r.throttle(false); await r.waitFor(ready, limit); return ok("paused, resumed, completed");
      }
      case "cancel": {
        await r.throttle(true); await r.start(); await r.waitFor(/queued|processing|downloading/i, 60000);
        await r.button(r.row(), "cancel").click();
        const st = await r.status(); // a cancelled download is removed or shown as cancelled
        return (await r.gone()) || /cancel/i.test(st) ? ok("cancelled") : bad("still downloading after Cancel: " + st);
      }
      case "delete": {
        await r.start(); await r.waitFor(ready, limit); await r.del(r.row());
        return (await r.gone()) ? ok("row removed") : bad("row still listed after Delete");
      }
      case "edit": {
        await r.start(); await r.waitFor(ready, limit);
        await r.button(r.row(), "edit").click();
        await page.waitForSelector(".download-quality-drawer", { timeout: 10000 });
        await page.locator(".download-quality-drawer .tv-segmented").first().locator("button").nth(2).click(); // keep until: after watched
        const hasQuality = (await page.locator(".download-quality-drawer .ui-select-trigger").count()) > 0;
        await page.locator(".download-quality-drawer .is-primary").click();
        await page.waitForTimeout(1000);
        const meta = await r.status();
        if (/keep forever/i.test(meta)) return bad("keep-until did not change: " + meta);
        return hasQuality ? ok("keep-until and quality editable") : bad("keep-until edited; the web edit drawer has no quality control");
      }
      case "offline-play": {
        await r.start(); await r.waitFor(ready, limit);
        try {
          await ctx.setOffline(true);
          await page.evaluate((f) => { history.pushState({}, "", "/player/" + f); window.dispatchEvent(new PopStateEvent("popstate")); }, m.file); // in-app route change: a reload offline has no app shell
          // The local copy loads asynchronously and the first negotiation can run before it: "Try again" is the user's retry.
          const retry = page.getByRole("button", { name: /try again/i });
          await retry.waitFor({ timeout: 6000 }).then(() => retry.click(), () => {});
          // Autoplay is blocked without a user gesture: the viewer presses Play.
          await page.waitForTimeout(1500);
          await page.evaluate(() => document.querySelector("video")?.play().catch(() => {}));
          const f = await frames({ startWithinSeconds: 30, advanceSeconds: 3 });
          if (f.state !== "playing" && env.PARITY_DEBUG) await page.screenshot({ path: `${env.PARITY_DEBUG}/${c.id}.png` });
          return f.state === "playing" ? ok(`offline frames advanced ${f.advancedSeconds.toFixed(1)}s`) : bad(JSON.stringify(f));
        } finally { await ctx.setOffline(false); }
      }
      case "notification": {
        await r.list();
        const on = page.getByRole("button", { name: /turn on notifications/i });
        await on.waitFor({ timeout: 10000 }).catch(() => {});
        if (!(await on.count())) return bad("no notifications switch on the Downloads page");
        await on.click(); await page.waitForTimeout(1000);
        await page.evaluate(() => sessionStorage.removeItem("__notes"));
        await r.throttle(true); await r.start();
        const read = async () => JSON.parse((await page.evaluate(() => sessionStorage.getItem("__notes"))) || "[]");
        await page.waitForTimeout(8000);
        await r.button(r.row(), "pause").click().catch(() => {});
        await page.waitForTimeout(3000);
        const midNotes = await read();
        await r.button(r.row(), "resume").click().catch(() => {});
        await r.throttle(false);
        await r.waitFor(ready, limit); await page.waitForTimeout(3000);
        const notes = await read(), last = notes.at(-1);
        if (!notes.length) return bad("no system notification raised");
        const bodies = new Set(notes.map((n) => n.body + n.title));
        const sawPaused = midNotes.some((n) => /paused/i.test(`${n.title} ${n.body}`));
        return bodies.size > 1 && sawPaused && /complete|downloaded|done/i.test(`${last.title} ${last.body}`) ? ok(`${notes.length} updates: progress, paused, completed`) : bad(`notifications incomplete (updates ${bodies.size}, paused ${sawPaused}): ${JSON.stringify(notes.slice(-2))}`);
      }
      case "series-pause": case "season-pause": {
        const lvl = c.action === "series-pause" ? r.series : r.season;
        await r.throttle(true); await r.start();
        if (c.action === "season-pause") await r.expand(r.series());
        await lvl().first().waitFor({ timeout: 8000 }).catch(() => {});
        if (!(await lvl().count())) return bad(`no ${c.action.split("-")[0]} row`);
        await r.button(lvl(), "pause").click(); await r.waitFor(/paused/i, 15000, lvl());
        await r.button(lvl(), "resume").click(); await r.throttle(false); await r.waitFor(ready, limit, lvl());
        return ok("paused, resumed, completed at " + c.action.split("-")[0] + " level");
      }
      case "series-delete": case "season-delete": {
        await r.start(); await r.waitFor(ready, limit);
        if (c.action === "season-delete") { await r.expand(r.series()); await r.del(r.season()); } else await r.del(r.series());
        return (await r.gone()) ? ok("group removed") : bad("group still listed after Delete");
      }
      default: return bad(`driver has no steps for ${c.action}`);
    }
  }
  // Media Session as the now-playing entry: metadata with a title, state "playing", and the pause action pauses the player.
  const nowPlaying = async () => {
    const info = await page.evaluate(() => { const m = navigator.mediaSession; return { title: m.metadata?.title ?? "", state: m.playbackState, pause: !!window.__mediaHandlers?.pause }; });
    let pausedOk = false;
    if (info.pause) {
      pausedOk = await page.evaluate(async () => { window.__mediaHandlers.pause({ action: "pause" }); await new Promise((r) => setTimeout(r, 800)); return document.querySelector("video")?.paused === true; });
      await page.evaluate(() => document.querySelector("video")?.play());
    }
    return { ...info, pausedOk, ok: !!info.title && info.state === "playing" && pausedOk };
  };
  return {
    supports: { downloads: true, notifications: true, nowPlaying: true, "grouped-downloads": true },
    async start() { browser = await chromium.launch(env.PARITY_CHROME ? { executablePath: env.PARITY_CHROME } : {}); await open().catch(async () => { await new Promise((r) => setTimeout(r, 15000)); await open(false); }); }, // one retry: sign-in can time out when many devices sign in at once
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
        const now = await page.evaluate(() => [...document.querySelectorAll(".tv-home-card")].map((c) => c.getAttribute("aria-label") || c.textContent.trim().slice(0, 40)).join("|"));
        still = now && now === last ? still + 1 : 0; last = now; await page.waitForTimeout(1500);
      }
      console.log(`  home first card: ${last.split("|")[0]}`);
      // The key handler attaches a moment after the first focus: a key sent sooner is lost (the web checks then fail at random).
      await page.waitForTimeout(3500);
      await settle();
    },
    async route(r) { await page.goto(web + r, { waitUntil: "load" }); await settle(); },
    async key(k, { long } = {}) {
      if (long) { await page.keyboard.down(KEYS[k]); await page.waitForTimeout(900); await page.keyboard.up(KEYS[k]); }
      else await page.keyboard.press(KEYS[k]);
      await page.waitForTimeout(350);
    },
    async location() { const u = new URL(page.url()); return u.pathname + u.search; },
    // { label, position } of the focused item, or null when the page body has focus (a check then fails).
    // position: { rail, index } = Home rail number and card number in it, or { rail: "nav", index } for a nav item; null elsewhere.
    async focused() {
      return page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        // Resume progress is per account and changes between runs: "Resume X from 2:14" and "Open X" are the same item.
        const label = (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 80) || e.className.toString()).replace(/^Resume (.*) from \d+:\d+(?::\d+)?$/i, "Open $1");
        let position = null;
        const nav = e.closest(".app-nav-link");
        const card = e.closest(".tv-home-card");
        if (nav) position = { rail: "nav", index: [...document.querySelectorAll(".app-nav-link")].indexOf(nav) };
        else if (card) {
          const rail = (c) => (c.getAttribute("data-navigation-focus-key") || "").split(":")[1];
          const cards = [...document.querySelectorAll(".tv-home-card")];
          const rails = [...new Set(cards.map(rail))];
          position = { rail: rails.indexOf(rail(card)), index: cards.filter((c) => rail(c) === rail(card)).indexOf(card) };
        }
        return { label, position };
      });
    },
    async screenshot(file) {
      await page.waitForFunction(() => ![...document.querySelectorAll("[class*=card-art]")].some((e) => !e.querySelector("img") && e.getBoundingClientRect().top < innerHeight), null, { timeout: 20000 }).catch(() => {});
      // Loading placeholders (skeletons, spinners) must be gone: a half-loaded screen is not a capture.
      await page.waitForFunction(() => !document.querySelector(".skeleton, [class*=skeleton-], .tv-mini-loader"), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      if (new URL(page.url()).pathname.startsWith("/login") || (await page.getByText("API request failed").count())) throw new Error("signed out or error page");
      await page.screenshot({ path: file });
    },
    // Plays media file `c.file` (a deep link on web; devices open it by their own means), returns {state, startSeconds, advancedSeconds, proxied}.
    async play(c, expect) {
      let proxied = false;
      const neg = { statuses: [] }; // every negotiation answer, so a 503 shows even when a retry then succeeds
      const onReq = (r) => { if (r.url().includes("/media/proxy/")) proxied = true; };
      const onRes = async (r) => {
        if (!/\/api\/v1\/playback\/[0-9a-f-]{36}\?/.test(r.url())) return;
        neg.statuses.push(r.status());
        if (r.ok()) neg.info = await r.json().catch(() => null);
      };
      page.on("request", onReq); page.on("response", onRes);
      try {
        await page.goto(web + "/player/" + c.file, { waitUntil: "load" });
        const r = await frames(expect);
        if (c.nowPlaying && r.state === "playing") r.nowPlaying = await nowPlaying();
        r.profile = await profile(neg, r);
        return { ...r, proxied };
      } finally { page.off("request", onReq); page.off("response", onRes); }
    },
    // Downloads cases (docs/parity/SUITE.md). Returns { state: "ok" | "failed", detail }. Cases clean up after themselves.
    async download(c, expect) {
      const m = c.media, limit = expect.withinSeconds * 1000;
      touched.add(m);
      const r = dl(m);
      try {
        await r.clean();
        return await dlCase(c, m, r, limit);
      } catch (e) {
        if (env.PARITY_DEBUG) await page.screenshot({ path: `${env.PARITY_DEBUG}/${c.id}.png` }).catch(() => {});
        return { state: "failed", detail: e.message.split("\n").filter((l) => !/^\s*$/.test(l)).slice(0, 3).join(" ").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 300) };
      } finally { await r.throttle(false).catch(() => {}); await r.clean().catch(() => {}); }
    },
    // Safety net for an aborted run: remove every download the cases touched.
    async cleanupDownloads() { for (const m of touched) await dl(m).clean().catch(() => {}); },
  };
}
