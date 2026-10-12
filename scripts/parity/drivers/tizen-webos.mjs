// Suite driver (docs/parity/SUITE.md) for the Samsung Tizen emulator and the LG webOS simulator.
//   DEVICE=tizen|webos  [TIZEN_DISPLAY=:25] [WEBOS_DISPLAY=:26] [WEBOS_CDP=9226] [PARITY_NETLOG=<dir>]
// webOS: Chrome DevTools Protocol (keys and eval). Tizen: X key events to the emulator window plus the debug build's
// netlog.js eval channel (a debug build with scripts/parity/tizen-webos/netlog.js; the host side is logserver.py <dir>/log.txt). Both then drive the same page functions.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NETLOG = process.env.PARITY_NETLOG ?? join(tmpdir(), "playarr-netlog");
const XCLICK = join(here, "..", "tizen-webos", "xclick.py");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYCODE = { up: 38, down: 40, left: 37, right: 39, select: 13, back: 27 };
const KEYNAME = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", select: "Enter", back: "Escape" };
const XKEY = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Return", back: "Escape" };
const BAD = "/could not be loaded|not signed in|link code/i.test(document.body.innerText)";

// Runs on every new document: records Media Session action handlers, and system toasts (Luna createToast) in sessionStorage.__notes.
function pageHook() {
  window.__mediaHandlers = {};
  try {
    const log = (kind, o) => { const a = JSON.parse(sessionStorage.getItem("__notes") || "[]"); a.push({ kind, ...o }); sessionStorage.setItem("__notes", JSON.stringify(a)); };
    const B = window.PalmServiceBridge;
    if (B) {
      const c = B.prototype.call;
      B.prototype.call = function (uri, payload) {
        if (/createToast/.test(uri)) { try { log("toast", { title: JSON.parse(payload).message, body: "" }); } catch (e) { /* ignore */ } }
        return c.apply(this, arguments);
      };
    }
  } catch (e) { /* ignore */ }
  const ms = navigator.mediaSession;
  if (ms) { const f = ms.setActionHandler.bind(ms); ms.setActionHandler = (a, h) => { window.__mediaHandlers[a] = h; return f(a, h); }; }
}

export async function createDriver() {
  const device = process.env.DEVICE;
  if (!["tizen", "webos"].includes(device)) throw new Error("DEVICE=tizen|webos required");
  const display = device === "tizen" ? process.env.TIZEN_DISPLAY ?? ":25" : process.env.WEBOS_DISPLAY ?? ":26";
  const cdpPort = process.env.WEBOS_CDP ?? "9226";
  let ws, seq = 0, pending = new Map(), evalSeq = 0;

  async function cdpConnect() {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const t = list.find((x) => new RegExp(process.env.WEBOS_MATCH ?? "webos-stage").test(x.url));
    if (!t) throw new Error("webOS app page not found (launcher showing?)");
    ws = new WebSocket(t.webSocketDebuggerUrl);
    pending = new Map();
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    // Records the Media Session action handlers (the now-playing buttons) on every new document, as the web driver does.
    await cdp("Page.enable");
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(${pageHook})()` });
  }
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  async function ev(expr) {
    if (device === "tizen") {
      const id = `d${Date.now()}${evalSeq++}`;
      writeFileSync(`${NETLOG}/cmd.txt`, `eval:${id}:${expr.replace(/\n/g, " ")}`);
      for (let i = 0; i < 40; i += 1) {
        await sleep(500);
        const hit = readFileSync(`${NETLOG}/log.txt`, "utf8").split("\n").reverse().find((l) => l.includes(`"id":"${id}"`));
        if (hit) { const o = JSON.parse(hit.slice(hit.indexOf("{"))); if (o.error) throw new Error(o.error); return o.value; }
      }
      return undefined;
    }
    if (!ws || ws.readyState !== 1) await cdpConnect();
    const r = (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result;
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  }
  // Reload at a hash route and wait until the app is up again (a reload drops the debug channel for a few seconds).
  async function load(route) {
    if (device === "tizen") {
      // The host is shared and often loaded: allow a slow reload before re-sending (a command polled during a reload is lost).
      for (let a = 0; a < 4; a += 1) {
        writeFileSync(`${NETLOG}/cmd.txt`, `hash:${route}`);
        await sleep(8000);
        for (let i = 0; i < 6; i += 1) if ((await ev("location.hash").catch(() => undefined)) === `#${route}`) return;
      }
      throw new Error(`tizen did not reach ${route}`);
    }
    // The app restores focus and scroll from sessionStorage on reload; a fresh web page load has none.
    await ev(`(sessionStorage.clear(), history.scrollRestoration = "manual", history.replaceState(null, "", "#" + ${JSON.stringify(route)}), setTimeout(() => location.reload(), 50), true)`).catch(() => {});
    await sleep(2500);
    ws = undefined;
    await cdpConnect();
  }
  async function until(expr, ms = 90000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(1000); }
    return false;
  }
  const settle = async () => {
    await until("[...document.images].every((i) => i.complete)", 30000);
    await sleep(1500);
  };
  const xkey = (k, long) => execFileSync("python3", [XCLICK, display, ...(long ? ["hold", XKEY[k], "900"] : ["press", XKEY[k]])], { stdio: "ignore" });

  return {
    // The simulator runs the web client in Chromium 94: Media Session is readable like on web; Tizen has no CDP hook for the handlers.
    supports: device === "webos" ? { nowPlaying: true, downloads: true, notifications: true, "grouped-downloads": true } : {},
    async start() {
      if (device === "webos") await cdpConnect();
      // X autorepeat would turn a held key into repeated presses and cancel the long-press timer.
      else execFileSync("xset", ["-display", display, "r", "off"], { stdio: "ignore" });
    },
    async stop() { ws?.close(); },
    async setTheme(t) {
      await ev(`(localStorage.setItem("playarr-theme", ${JSON.stringify(t)}), true)`);
    },
    async home() {
      await load("/");
      if (!(await until(`document.querySelectorAll(".app-nav-link").length >= 6 && !document.querySelector(".app-nav-link-placeholder") && !!document.querySelector(".tv-home-card")`))) throw new Error("home did not load");
      // A key sent before the first card holds focus is lost.
      if (!(await until("!!document.activeElement && document.activeElement !== document.body", 10000))) throw new Error("no focus on home");
      // Rails fill in asynchronously and reorder the cards: wait until the card list holds still before focusing.
      let last = "", still = 0;
      for (let i = 0; i < 40 && still < 3; i += 1) {
        const now = await ev(`[...document.querySelectorAll(".tv-home-card")].map((c) => c.getAttribute("aria-label") || c.textContent.trim().slice(0, 40)).join("|")`).catch(() => "");
        still = now && now === last ? still + 1 : 0; last = now; await sleep(1500);
      }
      console.log(`  home first card: ${last.split("|")[0]}`);
      await sleep(3500); // the key handler attaches a moment after the first focus
      await settle();
    },
    async route(r) { await load(r); await settle(); },
    async key(k, { long } = {}) {
      if (device === "tizen") xkey(k, long);
      else {
        const c = { key: KEYNAME[k], code: KEYNAME[k], windowsVirtualKeyCode: KEYCODE[k], nativeVirtualKeyCode: KEYCODE[k] };
        await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...c });
        if (long) await sleep(900);
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...c });
      }
      await sleep(device === "webos" ? 1000 : 350); // the simulator drops presses that come faster than it renders
    },
    async location() { return (await ev("location.hash.replace(/^#/, '')")) ?? null; },
    async focused() {
      return ev(`(() => { const e = document.activeElement; if (!e || e === document.body) return null;
        const label = (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 80) || e.className.toString()).replace(/^Resume (.*) from \\d+:\\d+(?::\\d+)?$/i, "Open $1");
        let position = null; const nav = e.closest(".app-nav-link"); const card = e.closest(".tv-home-card");
        if (nav) position = { rail: "nav", index: [...document.querySelectorAll(".app-nav-link")].indexOf(nav) };
        else if (card) { const rail = (c) => (c.getAttribute("data-navigation-focus-key") || "").split(":")[1]; const cards = [...document.querySelectorAll(".tv-home-card")]; const rails = [...new Set(cards.map(rail))];
          position = { rail: rails.indexOf(rail(card)), index: cards.filter((c) => rail(c) === rail(card)).indexOf(card) }; }
        return { label, position }; })()`);
    },
    async screenshot(file) {
      await ev("(document.activeElement && document.activeElement.blur && document.activeElement.blur(), true)");
      if (await ev(BAD)) throw new Error("signed out or error page");
      await settle();
      const xwd = `${file}.xwd`;
      writeFileSync(xwd, execFileSync("xwd", ["-display", display, "-root", "-silent"], { maxBuffer: 64 << 20 }));
      execFileSync("magick", [`xwd:${xwd}`, `png:${file}`]);
      rmSync(xwd);
    },
    // ---- Downloads cases (webOS only): the same steps as the web driver, as page code over CDP (Playwright cannot attach to Chromium 94).
    async download(c, expect) {
      if (device !== "webos") return { state: "failed", detail: "not supported by this driver" };
      const m = c.media;
      let step = "";
      const q = (js) => ev(`(() => { ${js} })()`);
      const scope = c.action.startsWith("season-") ? "season" : "series"; // the row the case acts on: a season group, a series group, else the item row
      const lvlSel = (n) => `li.tv-download-group[data-level='${n}'] > .tv-download-group-row`;
      const rowSel = m.episode ? lvlSel(1) : `.tv-download-row:not(.tv-download-group-row)`;
      const rowJs = `const rows = [...document.querySelectorAll(${JSON.stringify(rowSel)})].filter((x) => x.textContent.includes(${JSON.stringify(m.title)})); const row = rows[0];`;
      const seasonJs = `const row = [...document.querySelectorAll(${JSON.stringify(lvlSel(2))})].find((x) => x.textContent.includes("Season ${m.season}"));`;
      const jsFor = (level) => (level === "season" ? seasonJs : rowJs);
      const status = async (lvl) => (await q(`${jsFor(lvl)} return row ? (row.querySelector(".tv-download-row-meta")?.textContent ?? "").replace(/\\s+/g, " ") : null;`)) ?? "";
      const has = async (lvl) => !!(await q(`${jsFor(lvl)} return !!row;`));
      const press = async (name, lvl) => q(`${jsFor(lvl)} const b = row && [...row.querySelectorAll("button")].find((x) => new RegExp("^${name}$", "i").test((x.getAttribute("aria-label") || x.textContent).trim())); if (!b) return false; b.click(); return true;`);
      const waitFor = async (re, ms, lvl) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const st = await status(lvl); if (re.test(st)) return st; if (/failed/i.test(st)) throw new Error("download failed: " + st); await sleep(1500); }
        throw new Error(`timed out waiting for ${re}: ${await status(lvl)}`);
      };
      const throttle = (on) => device === "webos" && cdp("Network.emulateNetworkConditions", on ? { offline: false, latency: 50, downloadThroughput: 300 * 1024, uploadThroughput: -1 } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      const list = async () => { await load("/downloads"); await sleep(2500); };
      const confirmDrawer = () => q(`const b = document.querySelector(".download-quality-drawer .is-primary"); if (!b) return false; b.click(); return true;`);
      const start = async (again = true) => {
        step = "load";
        await load(m.episode ? `/series/${m.work}` : `/movies/${m.work}`);
        await until(m.episode ? `!!document.querySelector('a.tv-episode-card[href$="${m.file}"]')` : `!!document.querySelector("button.tv-detail-download")`, 30000);
        step = "card";
        if (m.episode) {
          // Long press = Enter held on the focused card, with real key events as a remote sends them.
          await ev(`(() => { const a = document.querySelector('a.tv-episode-card[href$="${m.file}"]'); a.scrollIntoView({ block: "center" }); a.focus(); return true; })()`);
          await sleep(1200);
          const kc = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
          await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...kc }); await sleep(1000); await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...kc });
          await until(`!!document.querySelector(".media-context-drawer")`, 10000);
          step = "drawer"; await sleep(600);
          // Choose Download in the actions drawer.
          await ev(`(([...document.querySelectorAll(".media-context-drawer button, .media-context-drawer [role=button], .media-context-drawer [tabindex], .media-context-drawer a, .media-context-drawer li")].find((b) => /^\\W*download\\W*$/i.test(b.textContent.trim())) || { click() { throw new Error("no Download action"); } }).click(), true)`);
          await sleep(1500);
        } else for (let i = 0; i < 4 && !(await ev(`!!document.querySelector(".download-quality-drawer")`)); i += 1) { await ev(`document.querySelector("button.tv-detail-download").click()`); await sleep(2000); }
        await until(`!!document.querySelector(".download-quality-drawer .ui-select-trigger")`, 20000);
        step = "quality";
        for (let i = 0; i < 4 && !(await until(`!!document.querySelector(".ui-select-option")`, 3000)); i += 1) { await ev(`document.querySelector(".ui-select-trigger").click()`); await sleep(800); }
        await ev(`document.querySelector(".ui-select-option").click()`); // original: ready at once
        await sleep(500); await confirmDrawer(); await sleep(1500);
        await list();
        if (!(await has())) { if (again) return start(false); throw new Error("no row on the Downloads page after starting"); }
      };
      const gone = async () => { for (let i = 0; i < 20; i += 1) { if (!(await has())) return true; await sleep(1000); } return false; };
      const del = async () => { await press("delete"); await until(`!!document.querySelector(".download-quality-drawer .is-primary")`, 8000); await confirmDrawer(); };
      const clean = async () => { await list(); for (let i = 0; i < 5 && (await has()); i += 1) { await del(); await sleep(1500); } };
      const ready = /downloaded/i, limit = (expect?.withinSeconds ?? 300) * 1000;
      const ok = (detail) => ({ state: "ok", detail }), bad = (detail) => ({ state: "failed", detail });
      try {
        await clean();
        switch (c.action) {
          case "start": { await start(); return ok(await waitFor(ready, limit)); }
          case "pause-resume": {
            await throttle(true); await start();
            if (!(await press("pause"))) return bad("no Pause control on the Downloads page");
            await waitFor(/paused/i, 15000); await press("resume"); await waitFor(/downloading|queued|processing/i, 15000);
            await throttle(false); await waitFor(ready, limit); return ok("paused, resumed, completed");
          }
          case "cancel": {
            await throttle(true); await start(); await waitFor(/queued|processing|downloading/i, 60000); await press("cancel");
            const st = await status(); return (await gone()) || /cancel/i.test(st) ? ok("cancelled") : bad("still downloading after Cancel: " + st);
          }
          case "delete": { await start(); await waitFor(ready, limit); await del(); return (await gone()) ? ok("row removed") : bad("row still listed after Delete"); }
          case "edit": {
            await start(); await waitFor(ready, limit); await press("edit");
            await until(`!!document.querySelector(".download-quality-drawer")`, 10000);
            await q(`document.querySelectorAll(".download-quality-drawer .tv-segmented")[0].querySelectorAll("button")[2].click()`);
            // The quality options load after the drawer opens.
            const hasQuality = await until(`!!document.querySelector(".download-quality-drawer .ui-select-trigger")`, 8000);
            await confirmDrawer(); await sleep(1000);
            const meta = await status();
            if (/keep forever/i.test(meta)) return bad("keep-until did not change: " + meta);
            return hasQuality ? ok("keep-until and quality editable") : bad("keep-until edited; the edit drawer has no quality control");
          }
          case "offline-play": {
            await start(); await waitFor(ready, limit);
            await cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
            try {
              await ev(`(history.pushState({}, "", "#/player/${m.file}"), window.dispatchEvent(new PopStateEvent("popstate")), true)`);
              await sleep(6000);
              await ev(`(([...document.querySelectorAll("button")].find((b) => /try again/i.test(b.textContent)) || { click() {} }).click(), true)`);
              await sleep(1500); await ev(`(document.querySelector("video")?.play().catch(() => {}), true)`);
              const pos = `(() => { const v = document.querySelector("video"); return v && !v.error && v.readyState >= 2 ? v.currentTime : null; })()`;
              const t0 = Date.now(); let p0 = null;
              while (p0 === null && Date.now() - t0 < 30000) { await sleep(500); p0 = (await ev(pos)) ?? null; }
              if (p0 === null) return bad("no frames offline");
              await sleep(4000); const p1 = (await ev(pos)) ?? p0;
              return p1 - p0 >= 3 ? ok(`offline frames advanced ${(p1 - p0).toFixed(1)}s`) : bad(`stalled offline (${(p1 - p0).toFixed(1)}s)`);
            } finally { await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
          }
          case "notification": {
            await list();
            const on = await until(`[...document.querySelectorAll("button")].some((b) => /turn on notifications/i.test(b.textContent))`, 10000);
            if (!on) return bad("no notifications switch on the Downloads page");
            await ev(`(([...document.querySelectorAll("button")].find((b) => /turn on notifications/i.test(b.textContent)) || { click() {} }).click(), true)`); await sleep(1000);
            await ev(`(sessionStorage.removeItem("__notes"), true)`);
            await throttle(true); await start();
            const read = async () => JSON.parse((await ev(`sessionStorage.getItem("__notes")`)) || "[]");
            await sleep(8000); await press("pause"); await sleep(3000);
            const mid = await read();
            await press("resume"); await throttle(false); await waitFor(ready, limit); await sleep(3000);
            const notes = await read(); const toasts = notes.filter((n) => n.kind === "toast"); const last = toasts.at(-1);
            if (!toasts.length) return bad("no system toast raised");
            const sawPaused = mid.some((n) => n.kind === "toast" && /paused/i.test(n.title));
            return new Set(toasts.map((n) => n.title)).size > 1 && sawPaused && /complete|downloaded|done/i.test(last.title) ? ok(`${toasts.length} toasts: progress, paused, completed`) : bad(`toasts incomplete (paused ${sawPaused}): ${JSON.stringify(toasts.slice(-2))}`);
          }
          case "series-pause": case "season-pause": {
            await throttle(true); await start();
            if (scope === "season") { await q(`${rowJs} const t = row && row.querySelector("button[aria-expanded]"); if (t && t.getAttribute("aria-expanded") === "false") t.click(); return true;`); await sleep(800); }
            if (!(await has(scope))) return bad(`no ${scope} row`);
            await press("pause", scope); await waitFor(/paused/i, 15000, scope);
            await press("resume", scope); await throttle(false); await waitFor(ready, limit, scope);
            return ok(`paused, resumed, completed at ${scope} level`);
          }
          case "series-delete": case "season-delete": {
            await start(); await waitFor(ready, limit);
            if (scope === "season") { await q(`${rowJs} const t = row && row.querySelector("button[aria-expanded]"); if (t && t.getAttribute("aria-expanded") === "false") t.click(); return true;`); await sleep(800); }
            await press("delete", scope); await until(`!!document.querySelector(".download-quality-drawer .is-primary")`, 8000); await confirmDrawer();
            return (await gone()) ? ok("group removed") : bad("group still listed after Delete");
          }
          default: return bad(`driver has no steps for ${c.action}`);
        }
      } catch (e) { return bad(`${step}: ${String(e.message).split("\n")[0]}`); }
      finally { await throttle(false).catch(() => {}); await clean().catch(() => {}); }
    },
    async cleanupDownloads() {},
    // Opens the file's player by deep link (as the web driver does), samples the playhead of <video> or Tizen AVPlay.
    async play(c, expect) {
      const pos = `(() => { const v = document.querySelector("video"); if (v && !v.error && v.readyState >= 2) return v.currentTime;
        try { const a = webapis.avplay; if (a.getState() === "PLAYING") return a.getCurrentTime() / 1000; } catch (e) {} return null; })()`;
      await load("/player/" + c.file);
      const t0 = Date.now();
      let p0 = null;
      while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) { await sleep(500); p0 = await ev(pos).catch(() => null) ?? null; }
      let out;
      if (p0 === null) out = { state: "error", detail: "no frames in time" };
      else {
        const startSeconds = (Date.now() - t0) / 1000;
        // Playing means the playhead advanced by advanceSeconds within advanceSeconds + 6 s of wall clock (startup buffering eats part of a short window).
        let p1 = p0;
        for (let i = 0; i < (expect.advanceSeconds + 6) * 2 && p1 - p0 < expect.advanceSeconds; i += 1) { await sleep(500); p1 = (await ev(pos).catch(() => null)) ?? p1; }
        out = { state: p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 - p0 };
      }
      if (device === "webos" && c.nowPlaying && out.state === "playing") {
        const info = await ev(`(() => { const m = navigator.mediaSession; return { title: m.metadata?.title ?? "", state: m.playbackState, pause: !!window.__mediaHandlers?.pause }; })()`);
        let pausedOk = false;
        if (info.pause) {
          pausedOk = await ev(`(async () => { window.__mediaHandlers.pause({ action: "pause" }); await new Promise((r) => setTimeout(r, 800)); const ok = document.querySelector("video")?.paused === true; document.querySelector("video")?.play(); return ok; })()`);
        }
        out.nowPlaying = { ...info, pausedOk, ok: !!info.title && info.state === "playing" && pausedOk };
      }
      // AVPlay hangs the app if the page reloads while it plays: stop it first.
      await ev(`(() => { try { webapis.avplay.stop(); webapis.avplay.close(); } catch (e) {} return true; })()`).catch(() => {});
      return out;
    },
  };
}
