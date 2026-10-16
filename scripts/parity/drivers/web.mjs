// Reference driver: the web TV client in Playwright (Chromium, 1920x1080, TV user agent). Contract: docs/parity/SUITE.md.
//   PLAYARR_WEB_URL (default https://playarr.app), PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD,
//   PARITY_CHROME (browser path, default Playwright's), PLAYARR_WEB_MOBILE=1, PLAYARR_WEB_NO_DOWNLOADS=1 (hide Downloads like a device without storage), PLAYARR_WEB_USER_AGENT, and
//   PLAYARR_WEB_VIEWPORT_WIDTH/HEIGHT/DPR (TV defaults 1920/1080/1; mobile defaults 390/844/3). Sessions are never shared: every run signs in fresh (new
//   browser profile, so a new device id); login tokens stay in that browser context and are never written to disk.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { assertAllowedDeviceTestUsername, assertDeviceTestPage, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl, trustedLoginUsername } from "../device-test-guard.mjs";

// True when no card-art in view (and none cut by the viewport edge) lacks a loaded poster img.
const PLACEHOLDER_CARDS_GONE = () => ![...document.querySelectorAll("[class*=card-art]:not([class*=skeleton])")].some((e) => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 &&
    ![...e.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 0);
});

const KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", select: "Enter", back: "Escape" };
const UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export function stableNativeFocus(doc) {
  doc ??= document;
  const identity = () => {
    const element = doc.activeElement;
    const marker = doc.querySelector("[data-remote-active]");
    if (doc.body?.hasAttribute("data-remote-marker") && (!marker || marker !== element)) return null;
    if (!element || element === doc.body || !element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    const label = (element.getAttribute("aria-label") || element.textContent.trim().slice(0, 80) || element.className.toString()).replace(/\s+/g, " ");
    const half = label.length / 2;
    let normal = Number.isInteger(half) && half > 0 && label.slice(0, half) === label.slice(half) ? label.slice(0, half) : label;
    normal = normal.replace(/^Resume (.*) from \d+:\d+(?::\d+)?$/i, "Open $1");
    return { element, label: normal, key: element.getAttribute("data-navigation-focus-key") || element.id || element.tagName,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const current = identity();
  if (!current) {
    doc.__parityStableNativeFocus = null;
    return false;
  }
  const previous = doc.__parityStableNativeFocus;
  const stable = previous && Object.keys(current).every((key) => previous[key] === current[key]);
  doc.__parityStableNativeFocus = current;
  return !!stable;
}

export function detailReadyPredicate({ workId: expectedWorkId, kindHeading: expectedKindHeading, needsAction }) {
  const detail = document.querySelector(".tv-detail");
  const copy = detail?.querySelector(".tv-detail-copy");
  if (!copy || copy.classList.contains("is-resolving") || copy.getAttribute("aria-busy") === "true") return false;
  if (detail.querySelector(".is-resolving, [aria-busy='true'], .tv-detail-play-pending")) return false;
  const heading = detail.querySelector(".page-header-title-block h1")?.textContent?.trim().replace(/\s+/g, " ");
  if (heading !== expectedKindHeading) return false;
  const title = copy.querySelector(".tv-detail-title")?.textContent?.trim().replace(/\s+/g, " ");
  if (!title || detail.getAttribute("aria-label")?.trim().replace(/\s+/g, " ") !== title) return false;
  if (![...detail.querySelectorAll("[data-navigation-focus-key]")].some((node) =>
    node.getAttribute("data-navigation-focus-key")?.startsWith(`detail:${expectedWorkId}:`))) return false;
  const artImages = [...(detail.querySelector(".tv-key-art")?.querySelectorAll("img") ?? [])];
  const hasVisibleDecodedArt = artImages.some((image) => {
    if (!image.complete || image.naturalWidth === 0) return false;
    const style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0 || rect.width <= 0 || rect.height <= 0) return false;
    if (typeof image.decode !== "function") return true;
    const src = image.currentSrc || image.src;
    const state = image.__parityDecodeState;
    if (state?.src === src) return state.status === "ready";
    const next = { src, status: "pending" };
    image.__parityDecodeState = next;
    image.decode().then(() => {
      if (image.__parityDecodeState === next) next.status = "ready";
    }, () => {
      if (image.__parityDecodeState === next) next.status = "failed";
    });
    return false;
  });
  if ((needsAction || artImages.length > 0) && !hasVisibleDecodedArt) return false;
  if (!needsAction) return true;
  return [...detail.querySelectorAll(".tv-detail-actions .tv-detail-play")].some((action) => {
    if (!action.matches("button, a, [role='button']") || action.matches(":disabled") || action.classList.contains("is-disabled") ||
        action.getAttribute("aria-disabled") === "true") return false;
    const style = getComputedStyle(action);
    const rect = action.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  });
}

export async function installServerApiBaseUrl(context, serverUrl) {
  if (!serverUrl) return;
  const apiBaseUrl = serverUrl.replace(/\/$/, "");
  await context.addInitScript((baseUrl) => localStorage.setItem("playarr:apiBaseUrl", baseUrl), apiBaseUrl);
}

export function assertNoApiErrors(errors, context = "API request failed") {
  const current = errors.splice(0);
  if (current.length) throw new Error(`${context}: ${current.slice(-4).map((error) => error.message ?? error).join(", ")}`);
}

export function assertWebReady(pageUrl, errors) {
  if (pageUrl.includes("/login")) throw new Error("web readiness failed (signed out)");
  assertNoApiErrors(errors, "web readiness failed");
}

export function isExpectedCredentiallessBootstrapRejection({ status, method, pathname, requestBody, responseBody, beforeManualLogin }) {
  const credentials = requestBody && ["username", "password", "pin", "profile_user_id"].some((key) => requestBody[key] != null && requestBody[key] !== "");
  return beforeManualLogin && status === 400 && method === "POST" && pathname === "/api/v1/auth/login" &&
    !credentials && responseBody?.error === "bad_request" &&
    ["credentials required for full-account login", "a pin is required for managed-profile login"].includes(responseBody?.message);
}

export function clearSuccessfulBootstrapLoginErrors(errors) {
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    if (errors[index]?.expectedBootstrapLogin) errors.splice(index, 1);
  }
}

export function watchApiErrors(page, errors, { manualLoginStarted = () => false, manualLoginSucceeded = () => false } = {}) {
  const bootstrapRequests = new WeakSet();
  const pending = new Set();
  const track = (callback) => {
    let promise;
    promise = Promise.resolve().then(callback).finally(() => pending.delete(promise));
    pending.add(promise);
    return promise;
  };
  page.on("request", (request) => {
    if (!manualLoginStarted()) bootstrapRequests.add(request);
  });
  page.on("response", (response) => track(async () => {
    if (response.status() < 400 || !/\/api\//.test(response.url())) return;
    const pathname = new URL(response.url()).pathname.replace(/[0-9a-f-]{36}/g, ":id");
    const request = response.request();
    let requestBody, responseBody;
    if (pathname === "/api/v1/auth/login" && request.method() === "POST") {
      try { requestBody = request.postDataJSON(); } catch { requestBody = undefined; }
      if (response.status() === 400) {
        try { responseBody = await response.json(); } catch { responseBody = undefined; }
      }
    }
    const error = {
      message: `${response.status()} ${pathname}`,
      expectedBootstrapLogin: isExpectedCredentiallessBootstrapRejection({
        status: response.status(), method: request.method(), pathname, requestBody, responseBody, beforeManualLogin: bootstrapRequests.has(request),
      }),
    };
    // The initial signed-out bootstrap can legitimately be rejected on a server that requires
    // credentials. Defer suppressing that exact credentialless response until manual sign-in
    // succeeds; any credentialed or post-submit rejection remains a readiness failure.
    if (!(error.expectedBootstrapLogin && manualLoginSucceeded())) errors.push(error);
  }));
  return async () => {
    while (pending.size) await Promise.all([...pending]);
  };
}

// Pin visual calendar dates without freezing wall-clock time used by token expiry.
export function installVisualDate(fixedNow, target = globalThis) {
  const NativeDate = target.Date;
  const pinnedMs = new NativeDate(fixedNow).valueOf();
  function VisualDate(...args) {
    if (!new.target) return NativeDate();
    return Reflect.construct(NativeDate, args.length ? args : [pinnedMs], new.target);
  }
  VisualDate.prototype = NativeDate.prototype;
  Object.setPrototypeOf(VisualDate, NativeDate);
  Object.defineProperty(VisualDate, "name", { value: "Date" });
  Object.defineProperty(VisualDate, "now", { value: () => NativeDate.now() });
  target.Date = VisualDate;
}

export function validateParityFixedNow(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match ?? [];
  const daysInMonth = match ? new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate() : 0;
  if (!match || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) || !Number.isFinite(Date.parse(value))) {
    throw new Error("PARITY_FIXED_NOW must be a valid ISO 8601 timestamp");
  }
  return value;
}

export function validateWebTimezone(value) {
  if (typeof value !== "string" || !value || value.length > 100) throw new Error("PLAYARR_WEB_TIMEZONE must be a valid timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value }); }
  catch { throw new Error("PLAYARR_WEB_TIMEZONE must be a valid timezone"); }
  return value;
}

export function searchResultsReadyPredicate() {
  const results = document.querySelector(".tv-search-results");
  if (!results || results.getAttribute("aria-busy") !== "false") return false;
  if (results.querySelector(".tv-empty-state.tone-error")) return true;
  return Boolean(results.querySelector(".tv-search-results-grid, .tv-empty-state.is-rail.graphic-search.tone-empty"));
}

export async function clickIfPresent(locator) {
  if (await locator.count()) await locator.click();
}

export async function createDriver({ playwright = chromium, secrets } = {}) {
  const env = process.env, web = (env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
  const initialFixedNow = env.PARITY_FIXED_NOW === undefined ? null : validateParityFixedNow(env.PARITY_FIXED_NOW);
  const timezoneId = env.PLAYARR_WEB_TIMEZONE === undefined ? "Asia/Bangkok" : validateWebTimezone(env.PLAYARR_WEB_TIMEZONE);
  const allowedUsernames = loadAllowedDeviceTestUsernames({ env, client: env.PARITY_CLIENT, ...(secrets ? { secrets } : {}) });
  const trustedServerUrl = loadTrustedDeviceTestServerUrl({ env, ...(secrets ? { secrets } : {}) });
  if (env.PLAYARR_USERNAME) assertAllowedDeviceTestUsername(env.PLAYARR_USERNAME, allowedUsernames);
  const mobile = env.PLAYARR_WEB_MOBILE === "1";
  const positiveInteger = (name, fallback) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  const positiveNumber = (name, fallback) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
    return value;
  };
  const viewport = {
    width: positiveInteger("PLAYARR_WEB_VIEWPORT_WIDTH", mobile ? 390 : 1920),
    height: positiveInteger("PLAYARR_WEB_VIEWPORT_HEIGHT", mobile ? 844 : 1080),
  };
  const deviceScaleFactor = positiveNumber("PLAYARR_WEB_VIEWPORT_DPR", mobile ? 3 : 1);
  let cdp, browser, ctx, page, theme = "dark", session, detailActionRequired = false, fixedNow = initialFixedNow, disableAnimations = false;
  let manualLoginStarted = false, manualLoginSucceeded = false; // session: this run's own storage state, in memory
  const apiErrors = []; // failing /api/ responses of the current page, named in the error-page failure
  let drainApiErrors = async () => {};
  const ownedDownloads = new Map(); // media files started by this run, keyed to their media metadata
  const detailReadyTimeoutMs = 30000;
  const waitForDetailReady = async ({ requireHeroAction = false } = {}) => {
    const path = new URL(page.url()).pathname;
    const match = /^\/(movies|series)\/([^/]+)\/?$/.exec(path);
    if (!match) return;
    const [kind, workId] = [match[1] === "movies" ? "movie" : "series", match[2]];
    const kindHeading = match[1] === "movies" ? "Movies" : "Series";
    try {
      await page.waitForFunction(detailReadyPredicate, { workId, kindHeading, needsAction: requireHeroAction }, { timeout: detailReadyTimeoutMs, polling: 250 });
    } catch (error) {
      if (error?.name !== "TimeoutError") throw error;
      const missing = await page.evaluate(async ({ workId: expectedWorkId, kindHeading: expectedKindHeading, needsAction }) => {
        const detail = document.querySelector(".tv-detail");
        const copy = detail?.querySelector(".tv-detail-copy");
        const unresolved = !copy ? [".tv-detail-copy"] : [];
        if (copy?.classList.contains("is-resolving") || copy?.getAttribute("aria-busy") === "true") unresolved.push("detail copy still resolving or busy");
        if (detail?.querySelector(".is-resolving, [aria-busy='true']")) unresolved.push("detail contains a resolving or busy element");
        if (detail?.querySelector(".tv-detail-play-pending")) unresolved.push(".tv-detail-play-pending");
        const heading = detail?.querySelector(".page-header-title-block h1")?.textContent?.trim().replace(/\s+/g, " ");
        if (heading !== expectedKindHeading) unresolved.push(`route kind mismatch: expected ${expectedKindHeading} detail`);
        const title = copy?.querySelector(".tv-detail-title")?.textContent?.trim().replace(/\s+/g, " ");
        if (!title) unresolved.push("non-empty .tv-detail-title");
        else if (detail?.getAttribute("aria-label")?.trim().replace(/\s+/g, " ") !== title) unresolved.push("detail title and accessible identity do not match");
        if (![...(detail?.querySelectorAll("[data-navigation-focus-key]") ?? [])].some((node) =>
          node.getAttribute("data-navigation-focus-key")?.startsWith(`detail:${expectedWorkId}:`))) {
          unresolved.push("route identity mismatch: no detail-owned focus key matches the requested work id");
        }
        const artImages = [...(detail?.querySelector(".tv-key-art")?.querySelectorAll("img") ?? [])];
        const hasVisibleDecodedArt = (await Promise.all(artImages.map(async (image) => {
          if (!image.complete || image.naturalWidth === 0) return false;
          try { await image.decode(); } catch { return false; }
          const style = getComputedStyle(image);
          const rect = image.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        }))).some(Boolean);
        if ((needsAction || artImages.length > 0) && !hasVisibleDecodedArt) unresolved.push("visible decoded image in .tv-key-art");
        const action = [...(detail?.querySelectorAll(".tv-detail-actions .tv-detail-play") ?? [])].some((candidate) => {
          if (!candidate.matches("button, a, [role='button']") || candidate.matches(":disabled") || candidate.classList.contains("is-disabled") ||
              candidate.getAttribute("aria-disabled") === "true") return false;
          const style = getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        });
        if (needsAction && !action) unresolved.push("visible enabled hero action in .tv-detail-actions");
        return unresolved.length ? unresolved : ["readiness condition changed before timeout diagnostic"];
      }, { workId, kindHeading, needsAction: requireHeroAction });
      throw new Error(`Timed out after ${detailReadyTimeoutMs}ms waiting for ${kind} detail readiness: ${missing.join(", ")}`);
    }
  };
  const settle = async () => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    }).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector(".skeleton, [class*=skeleton-], .tv-mini-loader, [class*=spinner], [role=progressbar], [aria-busy=true]"), null, { timeout: 20000 });
    await drainApiErrors();
    assertNoApiErrors(apiErrors);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const open = async (keep = true) => {
    if (page) await guard();
    // Refresh tokens rotate: carry this run's live session into the next context (theme switch), or it comes up signed out.
    if (ctx && keep) session = await ctx.storageState();
    cdp = undefined; await ctx?.close();
    ctx = await browser.newContext({ viewport, deviceScaleFactor, userAgent: env.PLAYARR_WEB_USER_AGENT ?? (mobile ? MOBILE_UA : UA), colorScheme: theme, locale: "en-GB", timezoneId,
      ...(mobile ? { isMobile: true, hasTouch: true } : {}),
      ...(session ? { storageState: session } : {}) });
    await ctx.addInitScript((t) => localStorage.setItem("playarr-theme", t), theme);
    if (fixedNow) await ctx.addInitScript(installVisualDate, fixedNow);
    if (disableAnimations) await ctx.addInitScript(() => {
      const css = "*,*::before,*::after{animation:none!important;scroll-behavior:auto!important;transition:none!important;caret-color:transparent!important}";
      const install = () => { if (!document.head || document.getElementById("parity-motion-off")) return; const style = document.createElement("style"); style.id = "parity-motion-off"; style.textContent = css; document.head.append(style); };
      install(); new MutationObserver(install).observe(document, { childList: true, subtree: true });
      const finish = (element) => { for (const animation of element?.getAnimations?.() ?? []) { try { animation.finish(); } catch { animation.cancel(); } } };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) { const animation = animate.apply(this, args); try { animation.finish(); } catch { animation.cancel(); } return animation; };
      document.addEventListener("animationstart", (event) => finish(event.target), true);
      document.addEventListener("transitionrun", (event) => finish(event.target), true);
    });
    // PLAYARR_WEB_INIT_STORAGE='{"playarr-home-view":"cover"}': extra localStorage keys (poster mode, artwork size) for round-3 reference captures.
    if (env.PLAYARR_WEB_INIT_STORAGE) await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, JSON.parse(env.PLAYARR_WEB_INIT_STORAGE));
    // Set the selected server before the app initializes so discovery and sign-in use the configured API host.
    await installServerApiBaseUrl(ctx, trustedServerUrl);
    // Restored sessionStorage (scroll positions, focus memory) changes what a route shows: every document starts with it empty.
    await ctx.addInitScript(() => { try { sessionStorage.clear(); } catch {} });
    // PLAYARR_WEB_NO_DOWNLOADS=1: a device that cannot store downloads (Roku). The web app hides Downloads when neither OPFS nor
    // IndexedDB exists (detectDownloadStorage), so removing both gives the nav dock such a device shows.
    if (env.PLAYARR_WEB_NO_DOWNLOADS === "1") await ctx.addInitScript(() => {
      try { Object.defineProperty(navigator.storage, "getDirectory", { value: undefined }); } catch {}
      try { Object.defineProperty(window, "indexedDB", { value: undefined }); } catch {}
    });
    await ctx.grantPermissions(["notifications"], { origin: web }).catch(() => {});
    // Records system notifications (Notifications API) and Media Session handlers; kept in localStorage across reloads.
    await ctx.addInitScript(() => {
      const log = (n) => { try { const a = JSON.parse(localStorage.getItem("__notes") || "[]"); a.push({ ...n, at: Date.now() }); localStorage.setItem("__notes", JSON.stringify(a)); } catch {} };
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
    apiErrors.length = 0;
    manualLoginStarted = false;
    manualLoginSucceeded = false;
    drainApiErrors = watchApiErrors(page, apiErrors, { manualLoginStarted: () => manualLoginStarted, manualLoginSucceeded: () => manualLoginSucceeded });
    await page.goto(web + "/", { waitUntil: "load" });
    await page.waitForFunction(() => !!document.querySelector(".app-nav-link") || !!document.querySelector("input[name=password]") || location.pathname.startsWith("/login"), null, { timeout: 30000 });
    if (!(await page.locator(".app-nav-link").count())) {
      assertAllowedDeviceTestUsername(env.PLAYARR_USERNAME, allowedUsernames);
      const loginUsername = trustedLoginUsername(env, allowedUsernames, trustedServerUrl);
      const loginPassword = env.PLAYARR_PASSWORD;
      if (!loginPassword) throw new Error("signed out and PLAYARR_USERNAME/PLAYARR_PASSWORD not set");
      await page.goto(web + "/login", { waitUntil: "load" });
      const manual = page.getByText(/sign in manually|manual/i).first();
      if (await manual.count()) await manual.click();
      await page.fill('input[name="server-url"]', trustedServerUrl);
      await page.fill('input[name="username"]', loginUsername);
      await page.fill('input[name="password"]', loginPassword);
      manualLoginStarted = true;
      await page.locator("button[type=submit]").click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
      await page.waitForSelector(".app-nav-link", { timeout: 30000 });
      manualLoginSucceeded = true;
      clearSuccessfulBootstrapLoginErrors(apiErrors);
    }
    await assertDeviceTestPage({ page, allowedUsernames, expectedServerUrl: trustedServerUrl });
  };
  const guard = () => assertDeviceTestPage({ page, allowedUsernames, expectedServerUrl: trustedServerUrl });
  // "Frames advance": the video has data, then its playhead moves by advanceSeconds.
  const frames = async (expect) => {
    await guard();
    const t0 = Date.now();
    const pos = () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.error && v.readyState >= 2 ? v.currentTime : null; });
    let p0 = null;
    while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) { await guard(); await page.waitForTimeout(500); await guard(); p0 = await pos(); }
    if (p0 === null) return { state: "error", detail: "no frames in time" };
    const startSeconds = (Date.now() - t0) / 1000;
    await page.waitForTimeout((expect.advanceSeconds + 1) * 1000);
    await guard();
    const p1 = await pos();
    await guard();
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
  const waitReady = async ({ screen, phase }) => {
    await guard();
    await drainApiErrors();
    assertWebReady(page.url(), apiErrors);
    const path = new URL(page.url()).pathname;
    if (path === "/profiles") await page.waitForSelector(".profiles-page", { timeout: 30000 });
    else if (!path.startsWith("/player/")) await page.waitForSelector(".app-nav-link", { timeout: 30000 });
    if (screen === "home") await page.waitForSelector(".tv-home-card", { timeout: 30000 });
    if (["movies", "series", "calendar", "search"].includes(screen)) await page.waitForSelector("main", { timeout: 30000 });
    if (["/movies", "/series", "/music"].includes(path)) {
      await page.waitForFunction(() => document.querySelectorAll(".tv-library-grid-panel .tv-title-card").length > 0, null, { timeout: 30000 });
    }
    if (path === "/calendar") await page.waitForSelector(".calendar-page", { timeout: 30000 });
    if (path === "/search") {
      await page.waitForFunction(searchResultsReadyPredicate, null, { timeout: 30000, polling: 250 });
      if (await page.locator(".tv-search-results .tv-empty-state.tone-error").count()) {
        throw new Error("Search readiness failed: results rail rendered an error empty state");
      }
    }
    if (path.startsWith("/movies/") || path.startsWith("/series/")) await waitForDetailReady({ requireHeroAction: detailActionRequired });
    if (path.startsWith("/player/")) await page.waitForFunction(() => !!document.querySelector("video, .player-error, .player-loading"), null, { timeout: 30000 });
    await settle();
    await guard();
    if (phase === "focus") {
      const first = await stableFocus();
      if (!first) throw new Error(`focus readiness failed for ${screen}: document body has focus`);
    }
  };
  async function homeOnce() {
    await guard();
    await page.goto(web + "/", { waitUntil: "load" });
    await guard();
    await waitReady({ screen: "home", phase: "route" });
    await settle();
    if (!mobile) await waitReady({ screen: "home", phase: "focus" });
  }
  // The focused item as { label, position } (see focused() in docs/parity/SUITE.md), or null.
  const focusInfo = () => page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    let label = (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 80) || e.className.toString()).replace(/\s+/g, " ");
    // Resume progress is per account and changes between runs: "Resume X from 2:14" and "Open X" are the same item.
    label = label.replace(/^Resume (.*) from \d+:\d+(?::\d+)?$/i, "Open $1");
    // Some card markup repeats the accessible name in visible and hidden text.
    const half = label.length / 2;
    if (Number.isInteger(half) && half > 0 && label.slice(0, half) === label.slice(half)) label = label.slice(0, half);
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
  const stableFocus = async () => {
    await guard();
    await page.evaluate(() => { document.__parityStableNativeFocus = null; });
    await page.waitForFunction(stableNativeFocus, undefined, { timeout: 5000, polling: "raf" });
    await guard();
    return focusInfo();
  };
  // ---- Downloads page helpers. A TV episode lives under a series group (series > season > episode); a movie is one row.
  const dl = (m) => {
    const series = () => page.locator("li.tv-download-group[data-level='1'] > .tv-download-group-row", { hasText: m.title });
    const season = () => page.locator("li.tv-download-group[data-level='2'] > .tv-download-group-row", { hasText: `Season ${m.season}` /* shortcut: also matches Season 20, fine for the one pinned season */ });
    const row = () => (m.episode ? series() : page.locator(".tv-download-row:not(.tv-download-group-row)", { hasText: m.title }));
    const list = async () => { await guard(); await page.goto(web + "/downloads", { waitUntil: "load" }); await guard(); await page.waitForTimeout(2500); };
    const button = (loc, name) => loc.first().getByRole("button", { name: new RegExp(`^${name}$`, "i") });
    // Delete asks for confirmation in a drawer.
    const del = async (loc) => { await guard(); await button(loc, "delete").click(); await guard(); await page.locator(".download-quality-drawer .is-primary").click(); };
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
      if (!ownedDownloads.has(m.file)) return;
      await list();
      for (let i = 0; i < 5 && (await row().count()); i += 1) { await del(row()); await page.waitForTimeout(1500); }
      if (await gone()) ownedDownloads.delete(m.file);
    };
    const start = async (again = true) => {
      await list();
      if (await row().count()) throw new Error("download already exists; refusing to claim it for this run");
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
      ownedDownloads.set(m.file, m);
    };
    return { row, series, season, list, button, del, gone, expand, status, waitFor, throttle, clean, start };
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
          if (f.state !== "playing" && env.PARITY_DEBUG) { await guard(); await page.screenshot({ path: `${env.PARITY_DEBUG}/${c.id}.png` }); }
          return f.state === "playing" ? ok(`offline frames advanced ${f.advancedSeconds.toFixed(1)}s`) : bad(JSON.stringify(f));
        } finally { await ctx.setOffline(false); }
      }
      case "notification": {
        await r.list();
        const on = page.getByRole("button", { name: /turn on notifications/i });
        await on.waitFor({ timeout: 10000 }).catch(() => {});
        if (!(await on.count())) return bad("no notifications switch on the Downloads page");
        await on.click(); await page.waitForTimeout(1000);
        await page.evaluate(() => localStorage.removeItem("__notes"));
        await r.throttle(true); await r.start();
        const read = async () => JSON.parse((await page.evaluate(() => localStorage.getItem("__notes"))) || "[]");
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
    await guard();
    const info = await page.evaluate(() => { const m = navigator.mediaSession; return { title: m.metadata?.title ?? "", state: m.playbackState, pause: !!window.__mediaHandlers?.pause }; });
    let pausedOk = false;
    if (info.pause) {
      pausedOk = await page.evaluate(async () => { window.__mediaHandlers.pause({ action: "pause" }); await new Promise((r) => setTimeout(r, 800)); return document.querySelector("video")?.paused === true; });
      await guard();
      await page.evaluate(() => document.querySelector("video")?.play());
      await guard();
    }
    return { ...info, pausedOk, ok: !!info.title && info.state === "playing" && pausedOk };
  };
  return {
    supports: { downloads: true, notifications: true, nowPlaying: true, "grouped-downloads": true },
    async setDeterministicCapture({ fixedNow: value, disableAnimations: disable = false } = {}) {
      if (!value || !Number.isFinite(Date.parse(value))) throw new Error("deterministic capture requires a valid fixedNow date string");
      if (disable !== true) throw new Error("deterministic capture requires animation suppression");
      fixedNow = value; disableAnimations = true;
      if (ctx) { await guard(); await ctx.addInitScript(installVisualDate, value); await guard(); }
      if (page) { await guard(); await page.evaluate(installVisualDate, value); await guard(); }
    },
    async captureBuildIdentity() {
      await guard();
      const response = await fetch(`${web}/build-info.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`build identity request returned ${response.status}`);
      const info = await response.json();
      await guard();
      if (!info.sha || !info.builtAt) throw new Error("build identity response lacks sha or builtAt");
      if (env.PARITY_EXPECTED_BUILD_SHA && info.sha !== env.PARITY_EXPECTED_BUILD_SHA) throw new Error(`deployed build ${info.sha} does not match pinned build ${env.PARITY_EXPECTED_BUILD_SHA}`);
      return `${info.sha}@${info.builtAt}`;
    },
    waitReady,
    async start() { browser = await playwright.launch(env.PARITY_CHROME ? { executablePath: env.PARITY_CHROME } : {}); await open(); await guard(); },
    async stop() { await browser?.close(); },
    async setTheme(t) { await guard(); if (t !== theme) { theme = t; await open(); } },
    // TV Home proves first-card focus and the Left/Right nav round trip. Mobile Home waits for populated content and settles without TV focus keys.
    async home() {
      await guard();
      return homeOnce();
    },
    // Known state for the player checks: video playing, controls visible, focus on the play/pause button (waits up to 30 s, else throws).
    async playerReady() {
      await guard();
      await page.waitForFunction(() => {
        const v = document.querySelector("video"), c = document.querySelector(".player-controls");
        if (v && v.paused && v.readyState >= 2) v.play().catch(() => {});
        return !!v && v.readyState >= 2 && !v.paused && v.currentTime > 0.5 && !!c && !c.classList.contains("is-hidden") && !!document.activeElement?.closest("[data-player-default-focus]");
      }, null, { timeout: 30000, polling: 250 });
      await guard();
    },
    async playhead() { await guard(); const value = await page.evaluate(() => document.querySelector("video")?.currentTime ?? null); await guard(); return value; },
    async panelOpen() { await guard(); const value = await page.evaluate(() => [...document.querySelectorAll(".player-quality-menu")].some((m) => m.getBoundingClientRect().width > 0)); await guard(); return value; },
    async route(r, { requireHeroAction = false } = {}) {
      await guard();
      await page.goto(web + r, { waitUntil: "load" });
      await guard();
      detailActionRequired = requireHeroAction && /^\/(?:movies|series)\/[^/]+\/?(?:\?.*)?$/.test(r);
      await waitForDetailReady({ requireHeroAction: detailActionRequired });
      await settle();
    },
    async key(k, { long } = {}) {
      await guard();
      if (long) {
        await page.keyboard.down(KEYS[k]);
        try { await page.waitForTimeout(900); await guard(); }
        finally { await page.keyboard.up(KEYS[k]); }
      } else await page.keyboard.press(KEYS[k]);
      await guard();
      // The app applies directional keys once per animation frame: let two frames pass before anything reads focus.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    },
    async location() { await guard(); const u = new URL(page.url()); await guard(); return u.pathname + u.search; },
    // { label, position } of the focused item, or null when the page body has focus (a check then fails).
    // position: { rail, index } = Home rail number and card number in it, or { rail: "nav", index } for a nav item; null elsewhere.
    async focused() { await guard(); return stableFocus(); },
    async screenshot(file) {
      await guard();
      await waitReady({ screen: new URL(page.url()).pathname.split("/")[1] || "home", phase: "capture" });
      // Every card on screen shows its poster: a card-art without a loaded img is a placeholder (fallback title on grey). Fatal in a stable capture.
      // On timeout the error names what was still unloaded, so a flaky capture can be root-caused from the log.
      const stuck = (what) => async (error) => {
        if (error?.name !== "TimeoutError") throw error;
        const detail = await page.evaluate(() => [...document.querySelectorAll("[class*=card-art]:not([class*=skeleton]) img, .skeleton, [class*=skeleton-], .tv-mini-loader")]
          .filter((e) => e.tagName !== "IMG" || !(e.complete && e.naturalWidth > 0)).slice(0, 6).map((e) => e.tagName === "IMG" ? `img ${e.currentSrc || e.src} complete=${e.complete} loading=${e.loading}` : `${e.tagName}.${e.className}`)).catch(() => []);
        throw new Error(`${what} still present after 20000ms on ${page.url()} (API errors: ${apiErrors.slice(-4).join(", ") || "none seen"}): ${detail.join(" | ") || "none found"}`);
      };
      await page.waitForFunction(PLACEHOLDER_CARDS_GONE, null, { timeout: 20000 }).catch(stuck("card placeholders"));
      // Loading placeholders (skeletons, spinners) must be gone: a half-loaded screen is not a capture.
      await page.waitForFunction(() => !document.querySelector(".skeleton, [class*=skeleton-], .tv-mini-loader"), null, { timeout: 20000 }).catch(stuck("loading placeholders"));
      if (new URL(page.url()).pathname.startsWith("/login") || (await page.getByText("API request failed").count())) throw new Error(`signed out or error page (API errors: ${apiErrors.slice(-4).join(", ") || "none seen"})`);
      await guard();
      const detailRoute = /^\/(movies|series)\/[^/]+\/?$/.test(new URL(page.url()).pathname);
      if (detailRoute) {
        try {
          await page.waitForFunction(() => {
            const detail = document.querySelector(".tv-detail");
            return !!detail && !detail.getAnimations({ subtree: true }).some((animation) =>
              animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
          }, null, { timeout: 8000, polling: 100 });
        } catch (error) {
          if (error?.name !== "TimeoutError") throw error;
          throw new Error("Timed out after 8000ms waiting for finite detail animations to finish");
        }
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      if (disableAnimations) {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await guard();
        writeFileSync(file, await page.screenshot({ animations: "disabled" }));
        return;
      }
      await guard();
      await page.screenshot({ path: file });
    },
    // Facts about the page as it is now, for the reference verifier: theme, the title on detail pages and action drawers, loading
    // placeholders, open dialogs, broken images, fonts.
    async inspect() {
      await guard();
      const result = await page.evaluate(() => {
        const t = (e) => e?.textContent?.trim().replace(/\s+/g, " ") ?? null;
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          url: location.pathname + location.search,
          theme: document.documentElement.getAttribute("data-theme") ?? localStorage.getItem("playarr-theme"),
          detailTitle: t(document.querySelector(".tv-detail-title")),
          drawerTitle: t(document.querySelector(".media-context-drawer h2, .media-context-drawer h1, .media-context-drawer [class*=title]")),
          resumeState: /\bresume\b|ask again/i.test(document.querySelector(".tv-detail")?.innerText ?? ""),
          skeletons: [...document.querySelectorAll(".skeleton, [class*=skeleton-], .tv-mini-loader, [class*=spinner], [role=progressbar], [aria-busy=true], .is-resolving")].filter(vis).length,
          dialogs: [...document.querySelectorAll("[role=dialog], dialog[open], .media-context-drawer, .download-quality-drawer, [class*=filters-panel], [class*=drawer]")].filter(vis).length,
          brokenSrc: [...document.images].filter((i) => { const r = i.getBoundingClientRect(), x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1); return vis(i) && document.elementsFromPoint(x, y).includes(i) && !(i.complete && i.naturalWidth > 0); }).map((i) => (i.currentSrc || i.src).replace(/^https?:\/\/[^/]+/, "").slice(0, 90)),
          placeholderCards: [...document.querySelectorAll("[class*=card-art]:not([class*=skeleton])")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 && ![...e.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 0); }).length,
          fontsReady: document.fonts.status === "loaded",
          signedOut: !!document.querySelector("input[name=password]") || location.pathname.startsWith("/login"),
        };
      });
      await guard();
      return result;
    },
    // Phone layout: long-press on a card is a context-menu event; opens the title-actions drawer of the first library card.
    async openActions() {
      await guard();
      await page.locator("a[href^='/movies/']").first().dispatchEvent("contextmenu");
      await guard();
      await page.waitForSelector(".media-context-drawer", { timeout: 10000 });
      await guard();
      await settle();
    },
    // Plays media file `c.file` (a deep link on web; devices open it by their own means), returns {state, startSeconds, advancedSeconds, proxied}.
    async play(c, expect) {
      await guard();
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
        await guard();
        const r = await frames(expect);
        if (c.nowPlaying && r.state === "playing") r.nowPlaying = await nowPlaying();
        r.profile = await profile(neg, r);
        await guard();
        return { ...r, proxied };
      } finally { page.off("request", onReq); page.off("response", onRes); }
    },
    // Downloads cases (docs/parity/SUITE.md). Returns { state: "ok" | "failed", detail }. Cases clean up after themselves.
    async download(c, expect) {
      await guard();
      const m = c.media, limit = expect.withinSeconds * 1000;
      const r = dl(m);
      try {
        await r.list();
        if (await r.row().count()) return { state: "failed", detail: "refusing to replace a pre-existing download" };
        return await dlCase(c, m, r, limit);
      } catch (e) {
        if (env.PARITY_DEBUG) { await guard(); await page.screenshot({ path: `${env.PARITY_DEBUG}/${c.id}.png` }).catch(() => {}); }
        return { state: "failed", detail: e.message.split("\n").filter((l) => !/^\s*$/.test(l)).slice(0, 3).join(" ").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 300) };
      } finally { await guard(); await r.throttle(false).catch(() => {}); await guard(); await r.clean().catch(() => {}); }
    },
    // Safety net for an aborted run: remove downloads started by this run only.
    async cleanupDownloads() { await guard(); for (const media of ownedDownloads.values()) { await guard(); await dl(media).clean().catch(() => {}); } ownedDownloads.clear(); },
  };
}
