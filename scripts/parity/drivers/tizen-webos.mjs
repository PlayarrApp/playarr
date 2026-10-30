// Suite driver (docs/parity/SUITE.md) for the Samsung Tizen emulator and the LG webOS simulator.
//   DEVICE=tizen|webos|tizen65  [TIZEN_DISPLAY=:25] [WEBOS_DISPLAY=:26] [WEBOS_CDP=9226] [PARITY_NETLOG=<dir>]
//   PARITY_PIN_CLOCK=2026-10-07T12:00:00Z  [webos only] pins Date, zone and locale from the inspector without stable mode
// webOS: Chrome DevTools Protocol (keys and eval). Tizen: X key events to the emulator window plus the debug build's
// netlog.js eval channel (a debug build with scripts/parity/tizen-webos/netlog.js; the host side is logserver.py <dir>/log.txt). Both then drive the same page functions.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installRegionPin, installVisualDate } from "./web.mjs";
import { layoutExpression } from "../layout-dump.mjs";
import { assertDeviceTestIdentity, fetchCurrentIdentity, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl } from "../device-test-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const NETLOG = process.env.PARITY_NETLOG ?? join(tmpdir(), "playarr-netlog");
const XCLICK = join(here, "..", "tizen-webos", "xclick.py");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Real TVs are driven over the inspector: webOS (WEBOS_REAL=1, ares inspector forward) and Samsung Tizen (TIZEN_REAL=1, the debug port of `sdb shell 0 debug <app id>`).
const TIZEN_REAL = process.env.TIZEN_REAL === "1";
const REAL_TV = process.env.WEBOS_REAL === "1" || TIZEN_REAL;
const CDP_HOST = process.env.CDP_HOST ?? "127.0.0.1";
// Samsung TVs cannot return pixels over the inspector (Page.captureScreenshot never answers), so TIZEN_MIRROR=<receiver base as the TV reaches it>
// runs the debug-mirror build of the Tizen app (apps/tv-tizen/vite.config.debug-mirror.ts) from the local receiver: the driver navigates the TV's
// app page there over the inspector and takes screenshots from the frames the page posts (token: PLAYARR_VIDAA_MIRROR_TOKEN, never logged).
const TIZEN_MIRROR = TIZEN_REAL ? process.env.TIZEN_MIRROR?.replace(/\/$/, "") : undefined;
const mirrorToken = () => process.env.PLAYARR_VIDAA_MIRROR_TOKEN ?? "";
const mirrorLocal = () => (process.env.TIZEN_MIRROR_LOCAL ?? TIZEN_MIRROR ?? "").replace(/\/$/, "");
// The TV keeps the debug page in its cache between runs: a fresh query makes every run load the build the receiver serves now.
const mirrorEntry = (route = "/") => `${TIZEN_MIRROR}/?mirrorPng=1&mirrorWidth=1920&r=${Date.now()}&mirrorToken=${encodeURIComponent(mirrorToken())}#${route}`;
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

// Selectors below avoid :is(): the Samsung TVs on Tizen 6.5 run Chromium 85, where an unsupported selector makes querySelector throw.
// Page code (injected into the app): true when `element` is not cut off by a scrolling or clipping ancestor. A lazy image
// below a column's scroll edge is on screen by its rectangle but never loads and is not visible to the user.
export function insideAncestorClips(element, win = globalThis) {
  let rect = element.getBoundingClientRect();
  for (let node = element.parentElement; node && node !== win.document?.documentElement; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = node.getBoundingClientRect();
    const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
    const top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
    if (right <= left || bottom <= top) return false;
    rect = { left, right, top, bottom };
  }
  return true;
}

// The static seed's calendar posters are plain <img> URLs on the host's loopback artwork port, which the TV cannot reach: serve them through the page's own origin (the receiver forwards /art/*).
function installLoopbackArt() {
  // A TV page on file:// has no origin that forwards /art; the emulator reaches the host's loopback artwork server at 10.0.2.2 (QEMU user networking).
  const fix = (v) => String(v).replace(/^https?:\/\/(127\.0\.0\.1|localhost):(\d+)(\/art\/)/, (m, h, port, rest) => (location.protocol === "file:" ? `http://10.0.2.2:${port}${rest}` : `${location.origin}${rest}`));
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", { ...d, set(v) { d.set.call(this, fix(v)); } });
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) { return sa.call(this, n, this instanceof HTMLImageElement && n === "src" ? fix(v) : v); };
}
// Keeps the playback listener the app registers on AVPlay, so a capture can deliver the position tick of a paused seek (AVPlay sends none while paused).
function tapAvplayListener() {
  try {
    const a = window.webapis && window.webapis.avplay;
    if (!a || a.__tapped) return;
    const set = a.setListener.bind(a);
    a.setListener = function (listener) { window.__avListener = listener; return set(listener); };
    a.__tapped = true;
  } catch (e) { /* no AVPlay on this page */ }
}

export async function createDriver() {
  // TIZEN_REAL=1 runs the Samsung TV through the webOS CDP path, so DEVICE=webos is forced for it.
  // DEVICE=tizen65 is the Tizen 6.5 engine stand-in: the built Tizen web package in a pinned Chromium 85 (the Tizen 6.5 engine) with the Tizen 6.5
  // user agent, on its own Xvfb display (TIZEN65_DISPLAY, default :65) and inspector port (TIZEN65_CDP, default 9285). It is driven exactly like the
  // webOS simulator (inspector keys and page evaluation, root grab), with no webOS system keyboard and no Luna hooks.
  const tizen65 = !TIZEN_REAL && process.env.DEVICE === "tizen65";
  const device = TIZEN_REAL || tizen65 ? "webos" : process.env.DEVICE;
  if (!["tizen", "webos"].includes(device)) throw new Error("DEVICE=tizen|webos|tizen65 required");
  const display = tizen65 ? process.env.TIZEN65_DISPLAY ?? ":65" : device === "tizen" ? process.env.TIZEN_DISPLAY ?? ":25" : process.env.WEBOS_DISPLAY ?? ":26";
  const cdpPort = tizen65 ? process.env.TIZEN65_CDP ?? "9285" : process.env.WEBOS_CDP ?? "9226";
  let playerStarted = false;
  let tizenPinScript = null; // base64 of the page script that pins Date, zone and locale: stored for netlog.js to run before the app renders
  // PARITY_PIN_CLOCK=<ISO instant> pins the clock without the isolated-account stable mode (the real TV stays on the shared Device Test account), so Calendar renders the web refs' date.
  let pin = null; // { fixedNow, timeZone, locale } from setDeterministicCapture or PARITY_PIN_CLOCK, re-applied on every CDP connection
  if (process.env.PARITY_PIN_CLOCK && device === "webos") {
    if (!Number.isFinite(Date.parse(process.env.PARITY_PIN_CLOCK))) throw new Error("PARITY_PIN_CLOCK must be an ISO instant");
    pin = { fixedNow: process.env.PARITY_PIN_CLOCK, timeZone: "UTC", locale: "en-GB" };
  }
  let ws, seq = 0, pending = new Map(), evalSeq = 0, theme, loadedTheme;
  const allowedUsernames = loadAllowedDeviceTestUsernames({ env: process.env, client: process.env.PARITY_CLIENT });
  const trustedServerUrl = loadTrustedDeviceTestServerUrl();

  function closeCdp(socket = ws) {
    if (!socket) return;
    if (socket === ws) {
      ws = undefined;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP socket closed"));
      }
      pending.clear();
    }
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  }
  async function cdpConnect() {
    const list = await (await fetch(`http://${CDP_HOST}:${cdpPort}/json/list`)).json();
    const t = list.find((x) => new RegExp(process.env.WEBOS_MATCH ?? (tizen65 ? "^https?://" : "webos-stage")).test(x.url));
    if (!t) throw new Error("webOS app page not found (launcher showing?)");
    const socket = new WebSocket(t.webSocketDebuggerUrl);
    const requests = new Map();
    ws = socket;
    pending = requests;
    socket.onmessage = (m) => {
      const msg = JSON.parse(m.data), request = requests.get(msg.id);
      if (request) { clearTimeout(request.timer); requests.delete(msg.id); request.resolve(msg); }
    };
    await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
    // Records the Media Session action handlers (the now-playing buttons) on every new document, as the web driver does.
    await cdp("Page.enable");
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(${pageHook})()` });
    if (tizen65) await cdp("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(new URL("../tizen-webos/avplay-shim.js", import.meta.url), "utf8") });
    if (TIZEN_MIRROR) await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.__mirrorPause = true;(${installLoopbackArt})();` });
    if (pin) {
      // The same pin the web driver gives the browser: zone, locale and a fixed Date (wall time still advances), for this document and every new one.
      await cdp("Emulation.setTimezoneOverride", { timezoneId: pin.timeZone });
      await cdp("Emulation.setLocaleOverride", { locale: pin.locale });
      // A real TV's inspector does not always honour the zone override (the Samsung QN700B showed ICT, 19:00, on some screens): pin the zone in the page too.
      const install = `(${installVisualDate})(${JSON.stringify(pin.fixedNow)});(${installRegionPin})(${JSON.stringify(pin.timeZone)}, ${JSON.stringify(pin.locale)})`;
      await cdp("Page.addScriptToEvaluateOnNewDocument", { source: install });
      await cdp("Runtime.evaluate", { expression: install });
    }
  }
  async function keyboardVisible() {
    if (TIZEN_REAL || tizen65) return false; // the Samsung TV shows no system keyboard target on the inspector
    const list = await (await fetch(`http://${CDP_HOST}:${cdpPort}/json/list`)).json();
    const target = list.find((item) => /#\/keyboard\//.test(item.url));
    if (!target) throw new Error("webOS system keyboard visibility is unavailable");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("keyboard CDP connection timed out")), 5000);
        socket.onopen = () => { clearTimeout(timer); resolve(); };
        socket.onerror = (error) => { clearTimeout(timer); reject(error); };
      });
      const state = await new Promise((resolve, reject) => {
        const id = 1;
        const timer = setTimeout(() => reject(new Error("keyboard visibility query timed out")), 15000);
        socket.onmessage = (message) => {
          const response = JSON.parse(message.data);
          if (response.id !== id) return;
          clearTimeout(timer);
          if (response.error || response.result?.exceptionDetails) reject(new Error("keyboard visibility query failed"));
          else resolve(response.result?.result?.value);
        };
        socket.send(JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            expression: `(() => { const r = document.documentElement.getBoundingClientRect(); return { hidden: document.hidden, visibility: document.visibilityState, width: r.width, height: r.height }; })()`,
            returnByValue: true,
          },
        }));
      });
      if (!state || typeof state.hidden !== "boolean") throw new Error("webOS system keyboard visibility is unknown");
      return !state.hidden && state.visibility !== "hidden" && state.width > 1 && state.height > 40;
    } finally {
      socket.close();
    }
  }
  // Player chrome for the refs (web driver playerControls): the clip paused on its 2 s frame, controls revealed, focus dropped.
  // Chromium 94 presents the frame before an exact 2.000 s seek target (burned-in 1.933), so the pin aims 2.03 s, which presents the 2.000 s frame (2.02 s still shows frame 29, measured).
  async function pinPlayerFrame() {
    const pin = (t) => ev(`(async () => {
      const v = document.querySelector("video");
      v.pause();
      if (Math.abs(v.currentTime - ${t}) > 0.0005) await new Promise((res) => { v.addEventListener("seeked", res, { once: true }); v.currentTime = ${t}; setTimeout(res, 8000); });
      v.pause();
      if (v.requestVideoFrameCallback) await new Promise((res) => { v.requestVideoFrameCallback(() => res()); setTimeout(res, 3000); });
      return v.paused && Math.abs(v.currentTime - ${t}) < 0.001;
    })()`);
    const avplay = device === "tizen" || tizen65; // the Tizen 6.5 stand-in plays through the AVPlay shim (tizen-webos/avplay-shim.js)
    if (avplay) {
      // Tizen plays through AVPlay, a native plane. Method of docs/parity/DEVICES.md: hold the clip paused at exactly 2000 ms (seek while
      // paused, no play-then-pause), read the position back from the player, and refuse the capture unless it is paused on that frame.
      const av = `(() => { const a = window.webapis && window.webapis.avplay; return a ? a.getState() : "none"; })()`;
      if (!(await until(`(${av}) === "PLAYING" || (${av}) === "PAUSED"`, 60000))) throw new Error("AVPlay did not start");
      let held = false;
      for (let i = 0; i < 8 && !held; i += 1) {
        const state = await ev(`new Promise((resolve) => { const a = window.webapis.avplay; try { a.pause(); a.seekTo(2000, () => resolve("ok"), () => resolve("seek failed")); } catch (e) { resolve(String(e)); } setTimeout(() => resolve("timeout"), 15000); })`);
        await sleep(1500);
        const t = Number(await ev(`(() => { try { return window.webapis.avplay.getCurrentTime(); } catch (e) { return -1; } })()`));
        // AVPlay lands a seek to 2000 ms on the next decoded frame and reports it (2023 ms on the 30 fps static clip): hold to within one frame, deterministically.
        held = state === "ok" && t >= 2000 && t < 2034 && (await ev(av)) === "PAUSED";
      }
      if (!held) throw new Error("player did not hold paused on the 2000 ms frame");
      // AVPlay sends position ticks only while playing, so the page's seek bar still shows the pre-seek tick: hand the page the position just read back
      // through the listener the app registered (the measured value, not a constant).
      await ev(`(() => { try { const a = window.webapis.avplay; if (window.__avListener && window.__avListener.oncurrentplaytime) window.__avListener.oncurrentplaytime(a.getCurrentTime()); } catch (e) {} return true; })()`);
    } else if (!(await until(`(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 2; })()`, 60000))) throw new Error("player video has no frames");
    if (device === "tizen") {
      // No CDP here and the emulator's own video is visible to the grab: reveal the controls with a key (they hide on a timer).
      for (let i = 0; i < 6 && !(await ev(`(() => { const c = document.querySelector(".player-controls"); return !!c && !c.classList.contains("is-hidden"); })()`)); i += 1) { xkey("up", false); await sleep(1000); }
    } else await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 960, y: 540 });
    if (!(await until(`!!document.querySelector(".player-controls") && !document.querySelector(".player-controls").classList.contains("is-hidden")`, 10000))) throw new Error("player controls did not show");
    if (device === "tizen") {
      // The emulator draws the AVPlay video as its own layer above the browser, so a grab of a playing clip shows the video without the controls
      // (a real TV composites the plane under the browser). The page is not touched: the screenshot is what the emulator shows, and the layout
      // export is the DOM as laid out. The pixel score of this screen is therefore an emulator limit (docs/parity/DEVICES.md).
      await sleep(1000);
    }
    // A late play() or a timer can resume playback: hold the frame until it stays paused for two checks 0.7 s apart.
    let held = avplay ? 2 : 0;
    for (let i = 0; i < 12 && held < 2; i += 1) { held = (await pin(2.03)) ? held + 1 : 0; await sleep(700); }
    if (held < 2) throw new Error("player did not hold a paused frame at 2 s");
    if (!avplay) {
      // The seek bar fill follows the last position tick the app received, which can lag the paused position by a few frames. Hand the app the position the
      // video really holds (a timeupdate, as the Tizen path does with the AVPlay position) and refuse the capture until the fill shows that position.
      const synced = `(() => { const v = document.querySelector("video"), f = document.querySelector(".player-seek-progress"); return !!v && !!f && Math.abs(parseFloat(f.style.width) - 100 * v.currentTime / v.duration) < 0.15; })()`;
      for (let i = 0; i < 10 && !(await ev(synced)); i += 1) { await ev(`(document.querySelector("video").dispatchEvent(new Event("timeupdate")), true)`); await sleep(400); }
      if (!(await ev(synced))) throw new Error("the seek bar fill does not show the paused position");
    }
    await sleep(600); // the player moves focus to play/pause on a timer: let it, then drop it
    await ev(`(document.activeElement instanceof HTMLElement && document.activeElement.blur(), true)`);
  }
  async function clickDisplayAt(x, y) {
    const tree = execFileSync("xwininfo", ["-display", display, "-root", "-tree"], { encoding: "utf8" });
    const window = tree.split("\n").find((line) => line.includes('"webOS TV') && /\d+x\d+[+-]\d+[+-]-?\d+/.test(line));
    const geometry = window?.match(/\d+x\d+([+-]\d+)([+-]-?\d+)/);
    if (!geometry) throw new Error("webOS simulator window position is unavailable");
    const screenX = Number.parseInt(geometry[1], 10) + x;
    const screenY = Number.parseInt(geometry[2].replace("+", ""), 10) + y;
    execFileSync("python3", [XCLICK, display, "click", String(screenX), String(screenY)], { stdio: "ignore" });
  }
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++seq;
    const timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP ${method} timed out`)); }, 15000);
    pending.set(i, { resolve, reject, timer });
    try { ws.send(JSON.stringify({ id: i, method, params })); }
    catch (error) { clearTimeout(timer); pending.delete(i); reject(error); }
  });
  async function ev(expr) {
    if (device === "tizen") {
      const id = `d${Date.now()}${evalSeq++}`;
      // Newlines stay: a line comment in the expression (fetchCurrentIdentity has some) would swallow the rest of a collapsed line.
      writeFileSync(`${NETLOG}/cmd.txt`, `eval:${id}:${expr}`);
      // A loaded host (many emulators) can stall the TV page for tens of seconds: wait up to PARITY_EVAL_WAIT_MS (default 120 s).
      for (let i = 0; i < Number(process.env.PARITY_EVAL_WAIT_MS ?? 120000) / 500; i += 1) {
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
  // Store the pin for the next page start and apply it to this page too; a no-op when the page already runs it.
  async function applyTizenPin() {
    if (!tizenPinScript) return;
    await ev(`(localStorage.setItem("__parityPin", atob("${tizenPinScript}")), window.__parityPinned || (0, eval)(atob("${tizenPinScript}")), true)`);
    if ((await ev("window.__parityPinned === true")) !== true) throw new Error("tizen page did not take the pinned clock");
  }
  async function guard() {
    const check = () => ev(`(${fetchCurrentIdentity.toString()})({ expectedServerUrl: ${JSON.stringify(trustedServerUrl)} })`);
    // The app rotates its access token while the check is in flight (slower on a real TV): re-validate once against the new session.
    const identity = await check().catch((error) => { if (/session changed during identity check/.test(error.message)) return check(); throw error; });
    return assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl: trustedServerUrl });
  }
  // Reload at a hash route and wait until the app is up again (a reload drops the debug channel for a few seconds).
  // The app swaps its refresh token when the 15 minute access token runs out. A page reload that cuts that exchange short loses the new token, and
  // the retry with the retired one is a token reuse: the server ends the session. Before any reload, let a refresh that is due finish first.
  async function settleTokenRefresh() {
    const state = `(() => { try { const t = JSON.parse(localStorage.getItem("playarr:session") || "null")?.accessToken; const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return { token: t.slice(-24), left: p.exp - Date.now() / 1000 }; } catch (e) { return null; } })()`;
    const first = await ev(state);
    if (!first || first.left > 150) return;
    // Due soon: wait for the app's own refresh to land (the access token changes), then give any retry traffic a moment.
    for (let i = 0; i < 120; i += 1) {
      await sleep(1000);
      const now = await ev(state);
      if (now && now.token !== first.token) { await sleep(3000); return; }
    }
    throw new Error("the app did not refresh its access token before the reload");
  }
  async function load(route) {
    await guard();
    await settleTokenRefresh();
    if (device === "tizen") {
      // The host is shared and often loaded: allow a slow reload before re-sending (a command polled during a reload is lost).
      for (let a = 0; a < 4; a += 1) {
        writeFileSync(`${NETLOG}/cmd.txt`, `hash:${route}`);
        await sleep(8000);
        for (let i = 0; i < 6; i += 1) if ((await ev("location.hash").catch(() => undefined)) === `#${route}`) { await applyTizenPin(); await guard(); return; }
      }
      throw new Error(`tizen did not reach ${route}`);
    }
    // The app restores focus and scroll from sessionStorage on reload; a fresh web page load has none.
    await ev(`(sessionStorage.clear(), history.scrollRestoration = "manual", history.replaceState(null, "", "#" + ${JSON.stringify(route)}), setTimeout(() => location.reload(), 50), true)`).catch(() => {});
    await sleep(2500);
    closeCdp();
    await cdpConnect();
    loadedTheme = theme;
    await guard();
  }
  async function until(expr, ms = 90000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(1000); }
    return false;
  }
  const routeReady = async (route) => {
    const path = route.split("?")[0].replace(/\/$/, "") || "/";
    const selectors = path === "/" ? [
      '[data-page-id="home"] .tv-home-feature',
      '[data-page-id="home"] .tv-home-card',
    ] : path === "/search" ? [
      '[data-page-id="search"] .tv-search-form input[type="search"]',
      '[data-page-id="search"] .tv-search-copy',
    ] : path === "/movies" || path === "/series" || path === "/music" ? [
      '[data-page-id="library"].tv-library',
      '[data-page-id="library"] .tv-title-card',
    ] : path === "/calendar" ? [
      '[data-page-id="calendar"].calendar-page',
      '[data-page-id="calendar"] .calendar-scroll, [data-page-id="calendar"] .calendar-agenda-content',
    ] : path.startsWith("/settings") ? [
      '[data-page-id="settings"].settings-page',
      '[data-page-id="settings"] .settings-workspace',
    ] : path.startsWith("/music/") ? [
      '[data-page-id="music-detail"].tv-music-detail',
      '[data-page-id="music-detail"] .tv-detail-title',
    ] : path === "/playlists" ? [
      '[data-page-id="playlists"].tv-playlists',
      '[data-page-id="playlists"] .tv-playlist-directory-card, [data-page-id="playlists"] .tv-home-card',
    ] : path.startsWith("/movies/") || path.startsWith("/series/") || path.startsWith("/sites/") || path.startsWith("/search/") || path.startsWith("/library/") || path.startsWith("/playlists/") ? [
      '[data-page-id="work-detail"].tv-detail',
      '[data-page-id="work-detail"] .tv-detail-title',
    ] : path === "/downloads" ? [
      '[data-page-id="downloads"].tv-downloads',
      '[data-page-id="downloads"] .tv-downloads-content',
    ] : path === "/watchlist" || path === "/requests" ? [
      `[data-page-id="${path.slice(1)}"]`,
      `[data-page-id="${path.slice(1)}"] > header`,
    ] : path === "/profiles" ? [".profiles-page"] : path.startsWith("/player/") ? [".player-page"] : [
      "[data-page-id]",
      "[data-page-id] > header",
    ];
    const query = JSON.stringify(selectors);
    if (!(await until(`(() => { const s = ${query}; return s.every((q) => document.querySelector(q)); })()`, 90000))) {
      throw new Error(`route view did not become ready: ${path}`);
    }
    if (path === "/") {
      if (!(await until(`(() => { const cards = [...document.querySelectorAll(".tv-home-card")]; return cards.length >= 1 && !!document.querySelector(".tv-home-feature h2") && cards.some((c) => c.getBoundingClientRect().width > 0); })()`, 30000))) {
        throw new Error("home content did not populate");
      }
      if (!(await until(`(async () => { const img = document.querySelector('[data-page-id="home"] > .tv-key-art img'); if (!img) return false; const r = img.getBoundingClientRect(); const s = getComputedStyle(img); if (!img.currentSrc || !img.complete || img.naturalWidth === 0 || r.width <= 0 || r.height <= 0 || s.visibility === "hidden" || Number(s.opacity) === 0) return false; try { await img.decode(); return true; } catch { return false; } })()`, 60000))) {
        throw new Error("home backdrop artwork did not load");
      }
    } else if (path === "/search") {
      if (!(await until(`(() => { const root = document.querySelector('[data-page-id="search"]'); return !!root && !!root.querySelector(".tv-search-prompt, .tv-search-results, .tv-search-preview"); })()`, 30000))) {
        throw new Error("search content did not populate");
      }
    }
    await settleVisibleImages(path === "/");
  };
  async function settleVisibleImages(requireVisibleImage = false) {
    let previous = "", stable = 0;
    for (let i = 0; i < 60 && stable < 3; i += 1) {
      await guard();
      const state = await ev(`(async () => {
        const activeAnimations = (document.getAnimations?.() ?? []).filter((animation) => {
          const endTime = animation.effect?.getComputedTiming().endTime;
          return animation.playState === "running" && Number.isFinite(endTime);
        });
        if (${device === "webos"} && activeAnimations.length) return null;
        const insideAncestorClips = ${insideAncestorClips.toString()};
        const visible = [...document.images].filter((img) => {
          const r = img.getBoundingClientRect(), s = getComputedStyle(img);
          return insideAncestorClips(img) && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth &&
            s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && !!(img.currentSrc || img.getAttribute("src") || img.getAttribute("srcset"));
        });
        if (${requireVisibleImage} && !visible.length) return null;
        // A card whose art has not loaded yet (no src, or fading in at opacity 0) is not in the visible list; on Home only, wait for it for the first 30 s (a card with no art at all must not block the capture).
        if (${requireVisibleImage} && ${i} < 40) {
          const bare = [...document.querySelectorAll(".media-card")].filter((card) => {
            const r = card.getBoundingClientRect();
            return insideAncestorClips(card) && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && ![...card.querySelectorAll("img")].some((img) => (img.currentSrc || img.getAttribute("src")) && img.complete && img.naturalWidth > 0);
          });
          if (bare.length) return null;
        }
        if (visible.some((img) => !img.currentSrc || !img.complete || img.naturalWidth === 0)) return null;
        try { await Promise.all(visible.map((img) => img.decode())); } catch { return null; }
        const page = document.querySelector("[data-page-id]");
        const surfaces = [...(page?.querySelectorAll("h1,h2,h3,input,button,a,[role=alert],[role=search]") ?? [])]
          .filter((element) => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0; })
          .slice(0, 48)
          .map((element) => { const r = element.getBoundingClientRect(); return [element.tagName, element.getAttribute("aria-label") || element.textContent.trim().replace(/\\s+/g, " ").slice(0, 80), ...[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)]; });
        const currentNav = document.querySelector(".app-nav-link[aria-current=page]");
        const focused = document.activeElement;
        return JSON.stringify({ page: page?.getAttribute("data-page-id") ?? "", text: (page?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 2000), currentNav: currentNav?.getAttribute("aria-label") ?? "", focus: focused?.getAttribute("aria-label") || focused?.textContent?.trim().slice(0, 80) || focused?.tagName || "", surfaces, images: visible.map((img) => [img.currentSrc, img.naturalWidth, img.naturalHeight]) });
      })()`);
      if (state && state === previous) stable += 1;
      else stable = 0;
      previous = state ?? "";
      await sleep(750);
      await guard();
    }
    if (stable < 3) throw new Error("visible images did not settle before capture");
    await ev(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  }
  const xkey = (k, long) => execFileSync("python3", [XCLICK, display, ...(long ? ["hold", XKEY[k], "900"] : ["press", XKEY[k]])], { stdio: "ignore" });

  return {
    // webOS is driven over CDP, so the clock, zone and locale are pinned from the inspector; Tizen's driver has no CDP channel (netlog eval only).
    async setDeterministicCapture({ fixedNow, timeZone = "UTC", locale = "en-GB" } = {}) {
      if (!fixedNow || !Number.isFinite(Date.parse(fixedNow))) throw new Error(`${device} deterministic capture requires a valid fixedNow instant`);
      if (device === "tizen") {
        // No CDP here: the pin is a script kept in the app's localStorage, which the debug build's netlog.js runs at page start, before the app's first render.
        if (timeZone !== "UTC") throw new Error(`tizen stable capture unsupported for ${timeZone}: the page pin renders UTC only`);
        const source = `(${installVisualDate})(${JSON.stringify(fixedNow)});(${installRegionPin})(${JSON.stringify(timeZone)}, ${JSON.stringify(locale)});(${installLoopbackArt})();(${tapAvplayListener})();window.__parityPinned = true;`;
        tizenPinScript = Buffer.from(source).toString("base64");
        return;
      }
      pin = { fixedNow, timeZone, locale };
      if (ws && ws.readyState === 1) { closeCdp(); await cdpConnect(); }
    },
    // The layout schema document (docs/parity/LAYOUT.md): the same DOM dump as the web refs, run in the app page through the inspector or netlog channel.
    async layoutDump({ screen, theme }) {
      await guard();
      // The emulator composites the AVPlay plane above the browser (DEVICES.md): the app syncs the object's rect to the player shell, so what lies inside it is not visible.
      const doc = await ev(layoutExpression(screen, device === "tizen" && !TIZEN_REAL ? { opaquePlanes: ['object[type="application/avplayer"]'] } : {}));
      if (!doc?.elements) throw new Error("layout dump returned no elements");
      return { screen, theme, viewport: doc.viewport, clockPinned: !!(pin || tizenPinScript), elements: doc.elements, occluded: doc.occluded };
    },
    // The deployed package carries parity-build.json (written by the deploy scripts: repository HEAD, build time, SHA-256 of the entry bundle). The loaded
    // bundle is hashed again here, so the identity is only returned when the running page really is that build.
    async captureBuildIdentity() {
      await guard();
      const found = await ev(`new Promise((resolve) => {
        const get = (url) => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("GET", url + (url.includes("?") ? "&" : "?") + "n=" + Date.now()); x.onload = () => ok(x.responseText); x.onerror = () => no(new Error("read " + url)); x.send(); });
        const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
        (async () => {
          const info = JSON.parse(await get("./parity-build.json"));
          const entry = Array.from(document.scripts).map((e) => e.src).find((u) => /\\/assets\\//.test(u) && /\\.js(\\?|$)/.test(u));
          if (!entry) return resolve({ error: "no entry bundle" });
          const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await get(entry))));
          resolve({ info, digest });
        })().catch((e) => resolve({ error: String(e && e.message || e) }));
      })`);
      await guard();
      if (!found || found.error) throw new Error(`${device} build identity unavailable: ${found?.error ?? "no answer"}`);
      const { info, digest } = found;
      if (!/^[0-9a-f]{40}$/.test(info.sha) || !Number.isFinite(Date.parse(info.builtAt))) throw new Error(`${device} parity-build.json is malformed`);
      if (info.bundleSha256 !== digest) throw new Error(`${device} loaded bundle ${digest.slice(0, 12)} is not the deployed build ${String(info.bundleSha256).slice(0, 12)}`);
      return `${info.sha}@${info.builtAt}`;
    },
    // Fonts decoded, no loading placeholders, every visible image settled, two frames painted: the same bar the web driver holds before a capture.
    async waitReady() {
      await guard();
      if (!(await until(`document.fonts.status === "loaded" && !document.querySelector(".skeleton, [class*=skeleton-], .tv-mini-spinner")`, 60000))) throw new Error("fonts or loading placeholders did not settle");
      await settleVisibleImages();
      await ev(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
      await guard();
    },
    strictReadiness: true,
    // The simulator runs the web client in Chromium 94: Media Session is readable like on web; Tizen has no CDP hook for the handlers.
    supports: device === "webos" && !tizen65 ? { nowPlaying: true, downloads: true, notifications: true, "grouped-downloads": true } : {},
    async start() {
      if (device === "webos") {
        // Chromium shows a link's address in a status bubble over the page while the pointer rests on it: park the pointer outside the 1920x1080 page, on the larger Xvfb screen.
        if (tizen65) execFileSync("python3", [XCLICK, display, "park", "1990", "1190"], { stdio: "ignore" });
        await cdpConnect();
        if (TIZEN_MIRROR) {
          await cdp("Page.navigate", { url: mirrorEntry("/") });
          await sleep(6000);
          closeCdp();
          await cdpConnect();
        }
        await guard();
      } else {
        await guard();
        execFileSync("xset", ["-display", display, "r", "off"], { stdio: "ignore" });
        execFileSync("python3", [XCLICK, display, "focus"], { stdio: "ignore" }); // no window manager on the headless display: give the emulator window the input focus
        await applyTizenPin();
      }
      // X autorepeat would turn a held key into repeated presses and cancel the long-press timer.
      await guard();
    },
    async stop() {
      closeCdp();
      // The TV's inspector proxy never completes the WebSocket close handshake, so its sockets keep node alive after the run;
      // the unref'd timer does not delay a normal exit and ends the process once everything else is done.
      if (REAL_TV) setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
    },
    async setTheme(t) {
      await guard();
      await ev(`(localStorage.setItem("playarr-theme", ${JSON.stringify(t)}), true)`);
      await guard();
      theme = t;
    },
    async home() {
      await guard();
      await load("/");
      if (!(await until(`document.querySelectorAll(".app-nav-link").length >= 6 && !document.querySelector(".app-nav-link-placeholder") && !!document.querySelector(".tv-home-card")`))) throw new Error("home did not load");
      // A key sent before the first card holds focus is lost.
      if (!(await until("!!document.activeElement && document.activeElement !== document.body", 10000))) throw new Error("no focus on home");
      // Rails fill in asynchronously and reorder the cards: wait until the card list holds still before focusing.
      let last = "", still = 0;
      for (let i = 0; i < 40 && still < 3; i += 1) {
        await guard();
        const now = await ev(`[...document.querySelectorAll(".tv-home-card")].map((c) => c.getAttribute("aria-label") || c.textContent.trim().slice(0, 40)).join("|")`);
        await guard();
        still = now && now === last ? still + 1 : 0; last = now; await sleep(1500);
      }
      console.log(`  home first card: ${last.split("|")[0]}`);
      await sleep(3500); // the key handler attaches a moment after the first focus
      await guard();
      await routeReady("/");
      await guard();
    },
    async route(r) {
      await guard();
      if ((await ev('location.hash.replace(/^#/, "")')) !== r || loadedTheme !== theme) await load(r);
      await guard();
      await routeReady(r);
      await guard();
    },
    async key(k, { long } = {}) {
      await guard();
      // The simulator opens the player slower than web: a key sent while the title is still loading toggles or opens the wrong thing.
      if (device === "webos") {
        const onPlayer = await ev(`/^#\\/player\\//.test(location.hash)`).catch(() => false);
        if (onPlayer && !playerStarted) { await until(`(() => { const v = document.querySelector("video"); return !!v && !v.paused && v.currentTime > 1; })()`, 30000); playerStarted = true; }
        if (!onPlayer) playerStarted = false;
        await guard();
      }
      if (device === "tizen") {
        await guard();
        if (long) {
          const key = XKEY[k];
          execFileSync("python3", [XCLICK, display, "down", key], { stdio: "ignore" });
          try { await sleep(900); await guard(); }
          finally { execFileSync("python3", [XCLICK, display, "up", key], { stdio: "ignore" }); }
        } else xkey(k, false);
      }
      else {
        const c = { key: KEYNAME[k], code: KEYNAME[k], windowsVirtualKeyCode: KEYCODE[k], nativeVirtualKeyCode: KEYCODE[k] };
        if (k === "select") {
          // Chromium needs the character event to run native button activation. rawKeyDown alone
          // focuses controls but does not click action buttons in the webOS simulator.
          // Real TV: a separate char event lands after the route change the keydown caused and activates the new page's focus (Enter on the nav profile entry bounced Profiles back to Home), so send one keyDown that carries the text.
          const real = REAL_TV;
          await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...c, ...(real ? { text: "\r", unmodifiedText: "\r" } : {}) });
          try {
            if (!real) await cdp("Input.dispatchKeyEvent", { type: "char", ...c, text: "\r", unmodifiedText: "\r" });
            if (long) { await sleep(900); await guard(); }
          } finally { await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...c }); }
        } else {
          await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...c });
          try { if (long) { await sleep(900); await guard(); } }
          finally { await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...c }); }
        }
      }
      // Real TV: the app applies a directional key on the next animation frame and a busy main thread can delay it by seconds; two frames flush the queue.
      if (REAL_TV) await ev(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
      await sleep(device === "webos" ? 1000 : 350);
      await guard();
    },
    // Known state for the player checks on the Tizen 6.5 lane (tizen65 only): the AVPlay shim (tizen-webos/avplay-shim.js, decodes nothing) is PLAYING past 0.5 s,
    // the controls are up and focus is on play/pause. The shim D-pad proves the focus and controls logic only, not decoding or the native plane (up to 30 s, else throws).
    async playerReady() {
      if (!tizen65) throw new Error("stable capture unsupported: playerReady is the Tizen 6.5 AVPlay shim lane only");
      await guard();
      const ready = `(() => { try { const a = window.webapis.avplay, c = document.querySelector(".player-controls");
        if (a.getState() === "PAUSED" && a.getCurrentTime() < 59000) a.play();
        return a.getState() === "PLAYING" && a.getCurrentTime() > 500 && !!c && !c.classList.contains("is-hidden") && !!document.activeElement?.closest("[data-player-default-focus]"); } catch (e) { return false; } })()`;
      if (!(await until(ready, 30000))) throw new Error("player not ready: AVPlay shim playing, controls up, focus on play/pause");
      // The controls hide 5 s after playback starts (the pinned capture frame was paused, so the timer began at the play() above): a mouse move restarts it,
      // so the check keys run inside a fresh window, as the web driver's start does.
      await ev(`(() => { const s = document.querySelector(".player-page") || document.body; s.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); return true; })()`);
      await sleep(300);
      if (!(await until(ready, 5000))) throw new Error("player not ready after refreshing the controls timer");
      await guard();
    },
    // Used by the shared runner before the first key of a player check (alongside the webOS wait in key()).
    async playhead() { await guard(); const value = await ev(`(() => { try { const a = window.webapis.avplay; if (a.getState() !== "NONE") return a.getCurrentTime() / 1000; } catch (e) {} const v = document.querySelector("video"); return v ? v.currentTime : null; })()`); await guard(); return value; },
    async panelOpen() { await guard(); const value = !!(await ev(`[...document.querySelectorAll(".player-quality-menu")].some((m) => m.getBoundingClientRect().width > 0)`)); await guard(); return value; },
    async location() { await guard(); const value = (await ev("location.hash.replace(/^#/, '')")) ?? null; await guard(); return value; },
    async focused() {
      await guard();
      const value = await ev(`(() => { const e = document.activeElement; if (!e || e === document.body) return null;
        const label = (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 80) || e.className.toString()).replace(/^Resume (.*) from \\d+:\\d+(?::\\d+)?$/i, "Open $1");
        let position = null; const nav = e.closest(".app-nav-link"); const card = e.closest(".tv-home-card");
        if (nav) position = { rail: "nav", index: [...document.querySelectorAll(".app-nav-link")].indexOf(nav) };
        else if (card) { const rail = (c) => (c.getAttribute("data-navigation-focus-key") || "").split(":")[1]; const cards = [...document.querySelectorAll(".tv-home-card")]; const rails = [...new Set(cards.map(rail))];
          position = { rail: rails.indexOf(rail(card)), index: cards.filter((c) => rail(c) === rail(card)).indexOf(card) }; }
        return { label, position }; })()`);
      await guard();
      return value;
    },
    async screenshot(file) {
      await guard();
      if (REAL_TV) {
        // Real TV: no X display. The inspector's Page.captureScreenshot shows the app only (no system menus, keyboard or video plane).
        if (await ev(BAD)) throw new Error("signed out or error page");
        // The web refs are taken at the top of a detail page (web driver does the same): the focus-scroll to the first episode card must not show in the capture.
        await ev(`(/^#\\/(movies|series)\\/[^/]+\\/?$/.test(location.hash) && ([document.scrollingElement, ...document.querySelectorAll("*")].forEach((e) => { if (e && e.scrollTop > 0) e.scrollTop = 0; }), true))`);
        await settleVisibleImages();
        await guard();
        // Detail refs are taken at page top (web driver does the same): focus scrolled the page down on the TV.
        if (await ev(`/^#\\/(movies|series)\\/[^/]+\\/?$/.test(location.hash)`)) await ev(`(() => { for (const e of [document.scrollingElement, ...document.querySelectorAll("*")]) if (e && e.scrollTop > 0) e.scrollTop = 0; return true; })()`);
        if (TIZEN_MIRROR) {
          const q = (name) => `${mirrorLocal()}/__mirror/${name}?t=${encodeURIComponent(mirrorToken())}`;
          // A focused text field opens the TV's keyboard, which shrinks the page to the strip above it (Search: 1920x568): blur it first.
          if (Number(await ev("innerHeight")) < 1000) {
            await ev("(document.activeElement instanceof HTMLElement && document.activeElement.blur(), true)");
            if (!(await until("innerHeight >= 1070", 15000))) throw new Error("the TV keyboard did not close before capture");
          }
          await ev("window.__mirrorPause = false");
          const since = Date.now() / 1000;
          let frame;
          for (let i = 0; i < 90 && !frame; i += 1) {
            await sleep(1500);
            const candidate = await (await fetch(q("latest.json"))).json().catch(() => null);
            if (candidate?.hasImage && !candidate.captureError && Number(candidate.receivedAt) > since && String(candidate.route).includes(await ev("location.hash"))) frame = candidate;
          }
          if (!frame) throw new Error("no fresh mirror frame from the TV page");
          writeFileSync(file, Buffer.from(await (await fetch(q("latest.jpg"))).arrayBuffer()));
          await ev("window.__mirrorPause = true");
        } else {
          const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
          writeFileSync(file, Buffer.from(shot.result.data, "base64"));
        }
        await guard();
        return;
      }
      if (device === "webos" && (await keyboardVisible())) {
        const searchInput = await ev(`(() => { const e = document.activeElement; return location.hash === "#/search" && e?.matches('input[type="search"]') && e.value === ""; })()`);
        if (!searchInput) throw new Error("webOS system keyboard is visible; refusing an obscured capture");
        const filter = await ev(`(() => { const controls = [...document.querySelectorAll('button[aria-controls="search-filters-drawer"]')]; if (controls.length !== 1) return { error: "expected one Search Filters control" }; const e = controls[0], r = e.getBoundingClientRect(), s = getComputedStyle(e); if (e.disabled || r.width <= 0 || r.height <= 0 || s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return { error: "Search Filters control is not visible" }; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        if (!filter || filter.error) throw new Error(filter?.error ?? "cannot dismiss Search keyboard without its Filters control");
        await guard();
        await clickDisplayAt(Math.round(filter.x), Math.round(filter.y));
        if (!(await until(`location.hash.includes("/search?panel=filters") && !!document.querySelector(".tv-filter-drawer")`, 10000))) {
          throw new Error("real Filters selection did not open the Search drawer");
        }
        for (let i = 0; i < 10 && (await keyboardVisible()); i += 1) await sleep(300);
        if (await keyboardVisible()) throw new Error("webOS system keyboard remained visible after selecting Filters");
        await guard();
        xkey("back"); // A real Back closes the drawer and restores focus to the Filters opener.
        if (!(await until(`location.hash === "#/search" && document.activeElement?.getAttribute("aria-label") === "Filters"`, 10000))) {
          throw new Error("closing Search filters did not restore focus to Filters");
        }
        if (await keyboardVisible()) throw new Error("webOS system keyboard reopened after returning focus to Filters");
        execFileSync("python3", [XCLICK, display, "park"], { stdio: "ignore" }); // the real click left the pointer over Filters: its hover look is not in the web ref
      }
      if (device === "webos" && (await keyboardVisible())) throw new Error("webOS system keyboard is visible; refusing an obscured capture");
      if (await ev(BAD)) throw new Error("signed out or error page");
      // Tizen: the Samsung keyboard opens for the focused field and halves the page. A real Back press closes the keyboard and leaves the field focused,
      // which is the state the web shows.
      if (device === "tizen" && Number(await ev("innerHeight")) < 1070 && (await ev(`location.hash === "#/search"`))) {
        xkey("back");
        for (let i = 0; i < 20 && Number(await ev("innerHeight")) < 1070; i += 1) await sleep(500);
        if (Number(await ev("innerHeight")) < 1070) throw new Error("the Samsung keyboard did not close before capture");
        await sleep(1500);
      }
      if (await ev(`/^#\\/player\\//.test(location.hash)`)) await pinPlayerFrame();
      // Detail refs are taken at page top (the web driver does the same): the focus-scroll to the first episode card must not show in the capture.
      if (await ev(`/^#\\/(movies|series)\\/[^/]+\\/?$/.test(location.hash)`)) await ev(`(() => { for (const e of [document.scrollingElement, ...document.querySelectorAll("*")]) if (e && e.scrollTop > 0) e.scrollTop = 0; return true; })()`);
      await settleVisibleImages();
      await guard();
      if (tizen65 && (await ev(`!!document.querySelector('.app-nav-link')`))) {
        // The nav rail adds Downloads once the downloads capability and storage probe resolve (App.tsx render filter): a grab before that shows a rail one item short (screens without a rail, profiles and the player, skip it).
        if (!(await until(`!!document.querySelector('.app-nav-link[href$="/downloads"]')`, 20000))) throw new Error("the nav rail never showed Downloads");
        await sleep(300);
      }
      if (tizen65) {
        // This Xvfb is larger than the page (a window the size of the screen loses a pixel row and column), and the XWD grab fails on it: ImageMagick grabs the root, the page is its top-left 1920x1080.
        execFileSync("magick", ["import", "-display", display, "-window", "root", "-crop", "1920x1080+0+0", "+repage", `png:${file}`]);
        await guard();
        return;
      }
      const xwd = `${file}.xwd`;
      writeFileSync(xwd, execFileSync("xwd", ["-display", display, "-root", "-silent"], { maxBuffer: 64 << 20 }));
      await guard();
      // The Tizen emulator draws its own title bar and 1 px borders (no window manager on the headless display): cut the 1920x1080 app area out of the root grab.
      const crop = device === "tizen" ? ["-crop", `1920x1080+${process.env.TIZEN_CONTENT_OFFSET ?? "6,35"}`.replace(",", "+"), "+repage"] : [];
      execFileSync("magick", [`xwd:${xwd}`, ...crop, `png:${file}`]);
      rmSync(xwd);
    },
    // ---- Downloads cases (webOS only): the same steps as the web driver, as page code over CDP (Playwright cannot attach to Chromium 94).
    async download(c, expect) {
      await guard();
      if (device !== "webos") return { state: "failed", detail: "not supported by this driver" };
      const m = c.media;
      let step = "";
      const q = async (js) => { await guard(); const value = await ev(`(() => { ${js} })()`); await guard(); return value; };
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
        while (Date.now() - t0 < ms) { await guard(); const st = await status(lvl); await guard(); if (re.test(st)) return st; if (/failed/i.test(st)) throw new Error("download failed: " + st); await sleep(1500); }
        throw new Error(`timed out waiting for ${re}: ${await status(lvl)}`);
      };
      const throttle = async (on) => { await guard(); if (device === "webos") await cdp("Network.emulateNetworkConditions", on ? { offline: false, latency: 50, downloadThroughput: 300 * 1024, uploadThroughput: -1 } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await guard(); };
      const list = async () => { await guard(); await load("/downloads"); await guard(); await sleep(2500); };
      const confirmDrawer = () => q(`const b = document.querySelector(".download-quality-drawer .is-primary"); if (!b) return false; b.click(); return true;`);
      const start = async (again = true) => {
        await guard();
        step = "load";
        await load(m.episode ? `/series/${m.work}` : `/movies/${m.work}`);
        await until(m.episode ? `!!document.querySelector('a.tv-episode-card[href$="${m.file}"]')` : `!!document.querySelector("button.tv-detail-download")`, 30000);
        step = "card";
        if (m.episode) {
          // Long press = Enter held on the focused card, with real key events as a remote sends them.
          await guard();
          await ev(`(() => { const a = document.querySelector('a.tv-episode-card[href$="${m.file}"]'); a.scrollIntoView({ block: "center" }); a.focus(); return true; })()`);
          await sleep(1200);
          const kc = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
          await guard(); await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...kc });
          try { await sleep(1000); await guard(); }
          finally { await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...kc }); }
          await until(`!!document.querySelector(".media-context-drawer")`, 10000);
          step = "drawer"; await sleep(600);
          // Choose Download in the actions drawer.
          await guard();
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
    async cleanupDownloads() { await guard(); },
    // Opens the file's player by deep link (as the web driver does), samples the playhead of <video> or Tizen AVPlay.
    async play(c, expect) {
      await guard();
      const pos = `(() => { const v = document.querySelector("video"); if (v && !v.error && v.readyState >= 2) return v.currentTime;
        try { const a = webapis.avplay; if (a.getState() === "PLAYING") return a.getCurrentTime() / 1000; } catch (e) {} return null; })()`;
      await load("/player/" + c.file);
      await guard();
      const t0 = Date.now();
      let p0 = null;
      while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) { await guard(); await sleep(500); await guard(); p0 = await ev(pos).catch(() => null) ?? null; }
      let out;
      if (p0 === null) out = { state: "error", detail: "no frames in time" };
      else {
        const startSeconds = (Date.now() - t0) / 1000;
        // Playing means the playhead advanced by advanceSeconds within advanceSeconds + 6 s of wall clock (startup buffering eats part of a short window).
        let p1 = p0;
        for (let i = 0; i < (expect.advanceSeconds + 6) * 2 && p1 - p0 < expect.advanceSeconds; i += 1) { await guard(); await sleep(500); await guard(); p1 = (await ev(pos).catch(() => null)) ?? p1; }
        out = { state: p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 - p0 };
      }
      if (device === "webos" && c.nowPlaying && out.state === "playing") {
        await guard();
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
