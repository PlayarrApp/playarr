// Suite driver (docs/parity/SUITE.md) for the Samsung Tizen emulator and the LG webOS simulator.
//   DEVICE=tizen|webos  [TIZEN_DISPLAY=:25] [WEBOS_DISPLAY=:26] [WEBOS_CDP=9226] [PARITY_NETLOG=<dir>]
// webOS: Chrome DevTools Protocol (keys and eval). Tizen: X key events to the emulator window plus the debug build's
// netlog.js eval channel (a debug build with scripts/parity/tizen-webos/netlog.js; the host side is logserver.py <dir>/log.txt). Both then drive the same page functions.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installRegionPin, installVisualDate } from "./web.mjs";
import { assertDeviceTestIdentity, fetchCurrentIdentity, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl } from "../device-test-guard.mjs";

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

export async function createDriver({ env = process.env, secrets, fetchImpl = fetch, WebSocketImpl = WebSocket, sleepImpl = sleep, now = () => Date.now(), readFile = readFileSync } = {}) {
  const device = env.DEVICE;
  if (!["tizen", "webos"].includes(device)) throw new Error("DEVICE=tizen|webos required");
  const display = device === "tizen" ? env.TIZEN_DISPLAY ?? ":25" : env.WEBOS_DISPLAY ?? ":26";
  const cdpPort = env.WEBOS_CDP ?? "9226";
  let playerStarted = false;
  let tizenPinScript = null; // base64 of the page script that pins Date, zone and locale: stored for netlog.js to run before the app renders
  let ws, seq = 0, pending = new Map(), evalSeq = 0, theme, loadedTheme, deterministicScriptId, deterministicCapture, hooksInstalledCurrent = false;
  const deterministicOwner = randomUUID();
  const allowedUsernames = loadAllowedDeviceTestUsernames({ env, client: device === "tizen" ? env.PARITY_CLIENT : undefined, ...(secrets ? { secrets } : {}) });
  const trustedServerUrl = loadTrustedDeviceTestServerUrl({ env, ...(secrets ? { secrets } : {}) });

  function closeCdp(socket = ws) {
    if (!socket) return;
    if (socket === ws) {
      ws = undefined;
      deterministicScriptId = undefined;
      hooksInstalledCurrent = false;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP socket closed"));
      }
      pending.clear();
    }
    if (socket.readyState < WebSocketImpl.CLOSING) socket.close();
  }
  async function cdpConnect() {
    if (ws?.readyState === 1) return;
    const list = await (await fetchImpl(`http://localhost:${cdpPort}/json/list`)).json();
    const t = list.find((x) => new RegExp(env.WEBOS_MATCH ?? "webos-stage").test(x.url));
    if (!t) throw new Error("webOS app page not found (launcher showing?)");
    const socket = new WebSocketImpl(t.webSocketDebuggerUrl);
    const requests = new Map();
    ws = socket;
    pending = requests;
    socket.onmessage = (m) => {
      const msg = JSON.parse(m.data), request = requests.get(msg.id);
      if (request) { clearTimeout(request.timer); requests.delete(msg.id); request.resolve(msg); }
    };
    await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
    // Records the Media Session action handlers (the now-playing buttons) on every new document, as the web driver does.
    assertCdp(await cdp("Page.enable"), "Page.enable");
    assertCdp(await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(${pageHook})()` }), "Page.addScriptToEvaluateOnNewDocument");
    if (deterministicCapture) {
      const identityResponse = await cdp("Runtime.evaluate", {
        expression: `(${fetchCurrentIdentity.toString()})({ expectedServerUrl: ${JSON.stringify(trustedServerUrl)} })`,
        awaitPromise: true,
        returnByValue: true,
      });
      assertIdentityCdp(identityResponse);
      const identity = identityResponse.result?.result?.value;
      assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl: trustedServerUrl });
      await installDeterministicHooks();
    }
  }
  async function keyboardVisible() {
    const list = await (await fetchImpl(`http://localhost:${cdpPort}/json/list`)).json();
    const target = list.find((item) => /#\/keyboard\//.test(item.url));
    if (!target) throw new Error("webOS system keyboard visibility is unavailable");
    const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
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
  const IDENTITY_ERRORS = [
    ["device-test account identity request failed", "identity-request-failed"],
    ["device-test account identity unavailable", "identity-session-unavailable"],
    ["device-test account identity server is invalid", "identity-server-invalid"],
    ["device-test account identity server is not trusted", "identity-server-untrusted"],
    ["device-test account identity response invalid", "identity-response-invalid"],
    ["device-test account identity is missing or ambiguous", "identity-profile-ambiguous"],
    ["device-test account session changed during identity check", "identity-session-changed"],
  ];
  // Only a fixed category is surfaced: the page exception text can carry account or server details.
  function exceptionCategory(details) {
    const diagnostic = [details.text, details.exception?.description].filter((value) => typeof value === "string").join("\n");
    const category = IDENTITY_ERRORS.find(([message]) => diagnostic.includes(message))?.[1];
    return category ? ` (${category})` : "";
  }
  function assertCdp(response, method) {
    if (response?.error) throw new Error(`CDP ${method} failed`);
    const details = response?.result?.exceptionDetails;
    if (details) throw new Error(`CDP ${method} raised a page exception${exceptionCategory(details)}`);
    return response;
  }
  function assertIdentityCdp(response) {
    if (response?.error) throw new Error("CDP Runtime.evaluate device-test identity failed");
    const details = response?.result?.exceptionDetails;
    if (!details) return response;
    throw new Error(`CDP Runtime.evaluate device-test identity raised a page exception${exceptionCategory(details)}`);
  }
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
    const r = assertCdp(await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), "Runtime.evaluate").result;
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  }
  // Store the pin for the next page start and apply it to this page too; a no-op when the page already runs it.
  async function applyTizenPin() {
    if (!tizenPinScript) return;
    await ev(`(localStorage.setItem("__parityPin", atob("${tizenPinScript}")), window.__parityPinned || (0, eval)(atob("${tizenPinScript}")), true)`);
    if ((await ev("window.__parityPinned === true")) !== true) throw new Error("tizen page did not take the pinned clock");
  }
  // The identity request crosses the network to the test server and can time out under load, and the app rotates its
  // token every 15 minutes. Only those two transient failures are retried (six attempts, growing pause); anything else still fails at once.
  async function guard() {
    let identity;
    for (let attempt = 1; ; attempt += 1) {
      try {
        identity = await ev(`(${fetchCurrentIdentity.toString()})({ expectedServerUrl: ${JSON.stringify(trustedServerUrl)} })`);
        break;
      } catch (error) {
        if (attempt >= 6 || !/identity-(request-failed|session-changed)/.test(error.message)) throw error;
        await sleepImpl(2000 * attempt);
      }
    }
    return assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl: trustedServerUrl });
  }
  // Reload at a hash route and wait until the app is up again (a reload drops the debug channel for a few seconds).
  async function load(route) {
    await guard();
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
    await sleepImpl(2500);
    hooksInstalledCurrent = false;
    closeCdp();
    await cdpConnect();
    loadedTheme = theme;
    await guard();
  }
  async function until(expr, ms = 90000) {
    const t0 = now();
    while (now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleepImpl(1000); }
    return false;
  }
  function installVisualDate(fixedNow, owner) {
    if (window.__parityCaptureState?.owner !== owner) {
      window.__parityCaptureState = { owner, nativeDate: window.Date, nativeAnimate: Element.prototype.animate };
    }
    const NativeDate = window.Date;
    const pinnedMs = new NativeDate(fixedNow).valueOf();
    function VisualDate(...args) {
      if (!new.target) return NativeDate();
      return Reflect.construct(NativeDate, args.length ? args : [pinnedMs], new.target);
    }
    VisualDate.prototype = NativeDate.prototype;
    Object.setPrototypeOf(VisualDate, NativeDate);
    Object.defineProperty(VisualDate, "name", { value: "Date" });
    Object.defineProperty(VisualDate, "now", { value: () => NativeDate.now() });
    window.Date = VisualDate;
  }
  function installMotionSuppression(owner) {
    const state = window.__parityCaptureState;
    if (!state || state.owner !== owner) throw new Error("deterministic capture ownership was lost");
    state.observer?.disconnect();
    if (state.finish) {
      document.removeEventListener("animationstart", state.finish, true);
      document.removeEventListener("transitionrun", state.finish, true);
    }
    state.style?.remove();
    const css = "*,*::before,*::after{animation:none!important;scroll-behavior:auto!important;transition:none!important;caret-color:transparent!important}";
    const install = () => {
      if (!document.head || state.style?.isConnected) return;
      const style = document.createElement("style");
      style.id = `parity-motion-off-${owner}`;
      style.textContent = css;
      document.head.append(style);
      state.style = style;
    };
    install();
    state.observer = new MutationObserver(install);
    state.observer.observe(document, { childList: true, subtree: true });
    const finish = (element) => {
      for (const animation of element?.getAnimations?.() ?? []) { try { animation.finish(); } catch { animation.cancel(); } }
    };
    const animate = state.nativeAnimate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      try { animation.finish(); } catch { animation.cancel(); }
      return animation;
    };
    state.finish = (event) => finish(event.target);
    document.addEventListener("animationstart", state.finish, true);
    document.addEventListener("transitionrun", state.finish, true);
  }
  function restoreDeterministicCapture(owner) {
    const state = window.__parityCaptureState;
    if (!state || state.owner !== owner) return;
    window.Date = state.nativeDate;
    Element.prototype.animate = state.nativeAnimate;
    state.observer?.disconnect();
    if (state.finish) {
      document.removeEventListener("animationstart", state.finish, true);
      document.removeEventListener("transitionrun", state.finish, true);
    }
    state.style?.remove();
    delete window.__parityCaptureState;
  }
  async function installDeterministicHooks() {
    const restoreSource = `(${restoreDeterministicCapture.toString()})(${JSON.stringify(deterministicOwner)})`;
    const source = `(${installVisualDate.toString()})(${JSON.stringify(deterministicCapture.fixedNow)},${JSON.stringify(deterministicOwner)})`;
    const motionSource = `(${installMotionSuppression.toString()})(${JSON.stringify(deterministicOwner)})`;
    if (deterministicScriptId) {
      assertCdp(await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: deterministicScriptId }), "Page.removeScriptToEvaluateOnNewDocument");
      deterministicScriptId = undefined;
    }
    const installed = assertCdp(await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `${restoreSource};${source};${motionSource}` }), "Page.addScriptToEvaluateOnNewDocument");
    if (installed.error || !installed.result?.identifier) throw new Error("webOS deterministic capture hook could not be registered");
    deterministicScriptId = installed.result.identifier;
    assertCdp(await cdp("Runtime.evaluate", { expression: `${restoreSource};${source};${motionSource}` }), "Runtime.evaluate deterministic hook");
    hooksInstalledCurrent = true;
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
      '[data-page-id="calendar"] :is(.calendar-scroll, .calendar-agenda-content)',
    ] : path.startsWith("/settings") ? [
      '[data-page-id="settings"].settings-page',
      '[data-page-id="settings"] .settings-workspace',
    ] : path.startsWith("/music/") ? [
      '[data-page-id="music-detail"].tv-music-detail',
      '[data-page-id="music-detail"] .tv-detail-title',
    ] : path === "/playlists" ? [
      '[data-page-id="playlists"].tv-playlists',
      '[data-page-id="playlists"] :is(.tv-playlist-directory-card, .tv-home-card)',
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
      await sleepImpl(750);
      await guard();
    }
    if (stable < 3) throw new Error("visible images did not settle before capture");
    await ev(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  }
  const xkey = (k, long) => execFileSync("python3", [XCLICK, display, ...(long ? ["hold", XKEY[k], "900"] : ["press", XKEY[k]])], { stdio: "ignore" });

  async function setDeterministicCapture({ fixedNow, disableAnimations, timeZone = "UTC", locale = "en-GB" } = {}) {
    if (device === "tizen") {
      // No CDP here: the pin is a script kept in the app's localStorage, which the debug build's netlog.js runs at page start, before the app's first render.
      if (!fixedNow || !Number.isFinite(Date.parse(fixedNow))) throw new Error("tizen deterministic capture requires a valid fixedNow instant");
      if (timeZone !== "UTC") throw new Error(`tizen stable capture unsupported for ${timeZone}: the page pin renders UTC only`);
      const source = `(${installVisualDate})(${JSON.stringify(fixedNow)});(${installRegionPin})(${JSON.stringify(timeZone)}, ${JSON.stringify(locale)});window.__parityPinned = true;`;
      tizenPinScript = Buffer.from(source).toString("base64");
      return;
    }
    if (typeof fixedNow !== "string" || !fixedNow || !Number.isFinite(Date.parse(fixedNow))) throw new Error("deterministic capture requires a valid fixedNow date string");
    if (disableAnimations !== true) throw new Error("deterministic capture requires animation suppression");
    await guard();
    deterministicCapture = { fixedNow, fixedMs: Date.parse(fixedNow) };
    await installDeterministicHooks();
    await guard();
  }
  async function captureBuildIdentity() {
    if (device !== "webos") throw new Error("Tizen stable build identity is unsupported");
    await guard();
    const manifestPath = env.PARITY_WEBOS_BUILD_MANIFEST;
    const stageRoot = env.PARITY_WEBOS_STAGE_ROOT;
    if (!manifestPath || !stageRoot || !isAbsolute(manifestPath) || !isAbsolute(stageRoot)) {
      throw new Error("webOS stable build identity requires absolute PARITY_WEBOS_BUILD_MANIFEST and PARITY_WEBOS_STAGE_ROOT paths");
    }
    let manifest;
    try { manifest = JSON.parse(readFile(manifestPath, "utf8")); }
    catch { throw new Error("webOS stage build manifest is unavailable or invalid"); }
    const entry = manifest?.runtimeEntry;
    if (manifest?.schema !== 1 || !/^[0-9a-f]{40}$/i.test(manifest.sourceCommit ?? "") ||
        !/^[0-9a-f]{64}$/i.test(manifest.packageTreeSha256 ?? "") ||
        typeof entry?.name !== "string" || !/^assets\/[A-Za-z0-9._-]+\.js$/.test(entry.name) ||
        !/^[0-9a-f]{64}$/i.test(entry.sha256 ?? "") || entry.observedLoadedInDevice !== true) {
      throw new Error("webOS stage build manifest lacks a verified runtime entry");
    }
    if (env.PARITY_EXPECTED_BUILD_SHA && manifest.sourceCommit.toLowerCase() !== env.PARITY_EXPECTED_BUILD_SHA.toLowerCase()) {
      throw new Error(`staged webOS build ${manifest.sourceCommit} does not match pinned build ${env.PARITY_EXPECTED_BUILD_SHA}`);
    }
    const loaded = await ev(`(() => {
      const expected = ${JSON.stringify(entry.name)};
      const resources = performance.getEntriesByType("resource");
      const resource = resources.find((candidate) => { try { return new URL(candidate.name, location.href).pathname.endsWith("/" + expected); } catch { return false; } });
      return resource ? { url: new URL(resource.name, location.href).href } : null;
    })()`);
    await guard();
    if (!loaded?.url) throw new Error("webOS runtime entry is not present in Chromium resource timing");
    const frameTree = await cdp("Page.getFrameTree");
    const frameId = frameTree?.result?.frameTree?.frame?.id;
    if (!frameId) throw new Error("webOS Chromium main frame is unavailable for build identity");
    const resource = await cdp("Page.getResourceContent", { frameId, url: loaded.url });
    if (resource.error) throw new Error("webOS loaded runtime content is unavailable from Chromium");
    const loadedContent = resource?.result?.content;
    if (typeof loadedContent !== "string") throw new Error("webOS loaded runtime content is unavailable from Chromium");
    const loadedBytes = resource.result.base64Encoded ? Buffer.from(loadedContent, "base64") : Buffer.from(loadedContent, "utf8");
    const runtimeSha256 = createHash("sha256").update(loadedBytes).digest("hex");
    let stagedBytes;
    try { stagedBytes = readFile(join(stageRoot, entry.name)); }
    catch { throw new Error("webOS staged runtime entry is unavailable"); }
    const stagedSha256 = createHash("sha256").update(stagedBytes).digest("hex");
    if (runtimeSha256 !== entry.sha256.toLowerCase() || stagedSha256 !== entry.sha256.toLowerCase()) {
      throw new Error("webOS loaded and staged runtime entry hashes do not match its build manifest");
    }
    await guard();
    return { package: "webos-chromium", sha256: runtimeSha256 };
  }
  async function waitReady({ screen, phase = "capture" } = {}) {
    if (device !== "webos") throw new Error("Tizen stable readiness is unsupported");
    if (typeof screen !== "string" || !screen || !["route", "capture", "focus"].includes(phase)) throw new Error("webOS readiness requires a screen and a supported phase");
    await guard();
    const currentRoute = await ev('location.hash.replace(/^#/, "") || "/"');
    await guard();
    const fontsReady = await ev(`(() => {
      if (!document.fonts) return Promise.resolve(false);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        document.fonts.ready.then(() => {
          clearTimeout(timeout);
          resolve(document.fonts.status === "loaded");
        }, (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    })()`);
    await guard();
    if (fontsReady !== true) throw new Error("webOS document fonts did not become ready");
    await routeReady(currentRoute);
    const fontsStillReady = await ev('document.fonts?.status === "loaded"');
    await guard();
    if (fontsStillReady !== true) throw new Error("webOS document fonts changed while waiting for route readiness");
    if (deterministicCapture) {
      const clock = await ev("({ visualNow: new Date().valueOf(), wallNow: Date.now() })");
      await guard();
      if (clock?.visualNow !== deterministicCapture.fixedMs || !Number.isFinite(clock.wallNow)) {
        throw new Error("webOS deterministic visual clock was not consumed by the current document");
      }
    }
    if (phase === "focus") {
      let previous = "", stable = 0;
      for (let i = 0; i < 12 && stable < 2; i += 1) {
        await guard();
        const focused = await ev(`(() => { const element = document.activeElement; if (!element || element === document.body) return ""; const rect = element.getBoundingClientRect(); return JSON.stringify([element.tagName, element.getAttribute("aria-label") || element.textContent.trim().slice(0, 80), Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]); })()`);
        await guard();
        stable = focused && focused === previous ? stable + 1 : 0;
        previous = focused || "";
        if (stable < 2) await sleepImpl(250);
      }
      if (stable < 2) throw new Error(`focus did not become stable for ${screen}`);
    }
    await guard();
    const finalRoute = await ev('location.hash.replace(/^#/, "") || "/"');
    await guard();
    if (finalRoute !== currentRoute) throw new Error("webOS route changed while waiting for readiness");
  }

  return {
    setDeterministicCapture,
    captureBuildIdentity,
    waitReady,
    // The simulator runs the web client in Chromium 94: Media Session is readable like on web; Tizen has no CDP hook for the handlers.
    supports: device === "webos" ? { nowPlaying: true, downloads: true, notifications: true, "grouped-downloads": true } : {},
    async start() {
      if (device === "webos") {
        if (ws?.readyState !== 1) await cdpConnect();
        await guard();
      } else {
        await guard();
        execFileSync("xset", ["-display", display, "r", "off"], { stdio: "ignore" });
        await applyTizenPin();
      }
      // X autorepeat would turn a held key into repeated presses and cancel the long-press timer.
      await guard();
    },
    async stop() {
      try {
        if (device === "webos" && ws?.readyState === 1 && deterministicCapture) {
          try {
            if (deterministicScriptId) {
              assertCdp(await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: deterministicScriptId }), "Page.removeScriptToEvaluateOnNewDocument");
              deterministicScriptId = undefined;
            }
          } finally {
            try {
              if (hooksInstalledCurrent) assertCdp(await cdp("Runtime.evaluate", { expression: `(${restoreDeterministicCapture.toString()})(${JSON.stringify(deterministicOwner)})` }), "Runtime.evaluate deterministic restore");
            } finally {
              hooksInstalledCurrent = false;
              deterministicCapture = undefined;
            }
          }
        }
      } finally {
        closeCdp();
        // The TV's inspector proxy never completes the WebSocket close handshake, so its sockets keep node alive after the run;
        // the unref'd timer does not delay a normal exit and ends the process once everything else is done.
        if (process.env.WEBOS_REAL === "1") setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
      }
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
      // The app keeps fetching for several seconds after the first card holds focus, and a Left sent meanwhile is dropped
      // (the nav move never lands). Wait until the page's resource count holds still, not for a fixed time.
      let quiet = 0, seen = null;
      for (let i = 0; i < 40 && quiet < 3; i += 1) {
        await sleepImpl(1000);
        const count = await ev('performance.getEntriesByType("resource").length');
        quiet = count === seen ? quiet + 1 : 0; seen = count;
      }
      if (quiet < 3) throw new Error("home never stopped loading resources");
      // Rails reorder while they fill, which leaves focus on whichever card moved: start every key script from the first card.
      if (!(await ev('(() => { const card = document.querySelector(".tv-home-card"); if (!card) return false; card.focus({ preventScroll: true }); return document.activeElement === card; })()'))) throw new Error("home first card did not take focus");
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
      let navFrom = null;
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
        // Enter on a nav tile is a route change: remember where we were so the wait below can prove it happened.
        navFrom = k === "select" ? await ev('document.activeElement?.closest(".app-nav-link") ? location.hash : null').catch(() => null) : null;
        const c = { key: KEYNAME[k], code: KEYNAME[k], windowsVirtualKeyCode: KEYCODE[k], nativeVirtualKeyCode: KEYCODE[k] };
        if (k === "select") {
          // Chromium needs the character event to run native button activation. rawKeyDown alone
          // focuses controls but does not click action buttons in the webOS simulator.
          // Real TV: a separate char event lands after the route change the keydown caused and activates the new page's focus (Enter on the nav profile entry bounced Profiles back to Home), so send one keyDown that carries the text.
          const real = process.env.WEBOS_REAL === "1";
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
      if (navFrom && !(await until(`location.hash !== ${JSON.stringify(navFrom)}`, 10000))) throw new Error("Enter on a nav tile did not change the route");
      await sleep(device === "webos" ? 1000 : 350);
      // The app applies directional moves in the next animation frame; a slow simulator frame leaves them queued, and the
      // next key (above all Enter) then acts on focus that has not moved yet. Wait for two frames, not a longer sleep.
      if (device === "webos") await ev("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
      await guard();
    },
    // Used by the shared runner before the first key of a player check (alongside the webOS wait in key()).
    async playhead() { await guard(); const value = await ev(`(() => { const v = document.querySelector("video"); return v ? v.currentTime : null; })()`); await guard(); return value; },
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
      if (process.env.WEBOS_REAL === "1") {
        // Real TV: no X display. The inspector's Page.captureScreenshot shows the app only (no system menus, keyboard or video plane).
        if (await ev(BAD)) throw new Error("signed out or error page");
        await settleVisibleImages();
        await guard();
        const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
        writeFileSync(file, Buffer.from(shot.result.data, "base64"));
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
      }
      if (device === "webos" && (await keyboardVisible())) throw new Error("webOS system keyboard is visible; refusing an obscured capture");
      if (await ev(BAD)) throw new Error("signed out or error page");
      await settleVisibleImages();
      await guard();
      const xwd = `${file}.xwd`;
      writeFileSync(xwd, execFileSync("xwd", ["-display", display, "-root", "-silent"], { maxBuffer: 64 << 20 }));
      await guard();
      execFileSync("magick", [`xwd:${xwd}`, `png:${file}`]);
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
