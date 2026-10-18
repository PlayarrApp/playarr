// DEBUG BUILD ONLY (vite --mode debug-mirror). Never ship this in playarr.app or any released client.
//
// Posts a downscaled JPEG of the app plus layout/focus facts to the local dev receiver that serves this
// build, every ~2 s and on every focus change. The receiver origin is the page's own origin and the
// token comes from the launch URL (?mirrorToken=...), so nothing about the environment is baked in.
import { focusInfo, selectorFor, visibleText } from "./mirrorSnapshot";
import { mirrorCaptureGeometry } from "./mirrorCaptureGeometry";
import { withCollapsingTrackHeights } from "./mirrorTrackHeights";
import { inlineArtwork } from "./mirrorArtwork";
import { localeTagFor } from "../lib/i18n/languages";
import {
  mirrorFramePayload,
  realNow,
  MIRROR_ACTIVE_PROFILE_KEY,
  LIVE_SESSION_KEY,
  MIRROR_PROFILE_SESSIONS_KEY,
  readMirrorIdentity,
  readSelectedSession,
  reportMirrorIdentityStatus,
  revalidateMirrorIdentity,
  type MirrorIdentity,
} from "./mirrorIdentity";

// The production-bundle guard and test look for this string, so it must survive minification.
const MIRROR_SENTINEL = "PLAYARR_DEBUG_MIRROR_SENTINEL";
const TOKEN_KEY = "playarr.debugMirrorToken";
const INTERVAL_MS = 2000;
// Full TV viewport width (1280): the frame is the picture the parity suite scores, so no downscale. Override with ?mirrorWidth=.
// ?mirrorPng=1: lossless frames (about 1 MB each) instead of JPEG, for pixel-exact parity scoring.
const usePng = new URLSearchParams(window.location.search).get("mirrorPng") === "1";
const TARGET_WIDTH = Number(new URLSearchParams(window.location.search).get("mirrorWidth")) || 1280;

function readToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("mirrorToken");
    if (fromUrl) {
      window.sessionStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return new URLSearchParams(window.location.search).get("mirrorToken");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

// Launch flags (?mirrorPointer=1, ?mirrorGeo=1, ?mirrorNoArt=1 ...) kept in sessionStorage because the router may rewrite the query.
function mirrorFlag(name: string): boolean {
  if (new URLSearchParams(window.location.search).get(name) === "1") return true;
  try {
    return (JSON.parse(window.sessionStorage.getItem("playarr.debugMirrorFlags") ?? "{}") as Record<string, string>)[name] === "1";
  } catch {
    return false;
  }
}

// Path plus the page's own query (a calendar view, say), without the launch parameters or the token.
function routeWithQuery(): string {
  const q = new URLSearchParams(window.location.search);
  for (const k of ["mirrorToken", "platform", "r"]) q.delete(k);
  const qs = q.toString();
  return window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
}

// Facts that decide the TV layout (stage zoom, artwork size, theme, the width and height media queries).
// The last few key events the page saw (key, keyCode, repeat, ms since the previous one): shows how the TV delivers a long press.
const keyLog: string[] = [];
let lastKeyAt = 0;
for (const type of ["keydown", "keyup"] as const) {
  window.addEventListener(type, (e) => {
    const now = realNow();
    keyLog.push(`${type} ${e.key}/${e.keyCode}${e.repeat ? " rep" : ""} +${lastKeyAt ? now - lastKeyAt : 0}`);
    lastKeyAt = now;
    if (keyLog.length > 12) keyLog.shift();
  }, true);
}

function layoutEnv(): Record<string, unknown> {
  const root = document.documentElement;
  const mq = (q: string) => window.matchMedia(q).matches;
  const clockDate = document.querySelector<HTMLElement>(".app-clock-date");
  const clockLocale = localeTagFor(root.lang);
  const clockDateFormatter = new Intl.DateTimeFormat(clockLocale, { weekday: "short", day: "numeric", month: "long" });
  const clockDateRect = clockDate?.getBoundingClientRect();
  const clockDateStyle = clockDate ? window.getComputedStyle(clockDate) : null;
  return {
    zoom: root.style.getPropertyValue("--stage-zoom") || root.style.getPropertyValue("zoom"),
    vw: root.style.getPropertyValue("--vw"),
    viewportUnit: root.style.getPropertyValue("--viewport-unit"),
    artwork: root.dataset.artworkSize ?? null,
    theme: root.dataset.theme ?? null,
    platform: root.dataset.platform ?? null,
    fontPx: window.getComputedStyle(root).fontSize,
    clockDebug: {
      documentLanguage: root.lang,
      navigatorLanguage: navigator.language,
      uiLocale: clockLocale,
      intlDate: clockDateFormatter.format(new Date()),
      intlDateParts: clockDateFormatter.formatToParts(new Date()).map(({ type, value }) => ({ type, value })),
      elementText: clockDate?.textContent ?? null,
      elementRect: clockDateRect ? [clockDateRect.x, clockDateRect.y, clockDateRect.width, clockDateRect.height] : null,
      elementClientWidth: clockDate?.clientWidth ?? null,
      elementScrollWidth: clockDate?.scrollWidth ?? null,
      elementDisplay: clockDateStyle?.display ?? null,
      elementOverflow: clockDateStyle?.overflow ?? null,
      elementTextOverflow: clockDateStyle?.textOverflow ?? null,
    },
    video: (() => {
      const v = document.querySelector("video");
      return v
        ? { t: Math.round(v.currentTime * 10) / 10, ready: v.readyState, net: v.networkState, paused: v.paused, err: v.error ? `${v.error.code} ${v.error.message}`.slice(0, 120) : null, w: v.videoWidth, h: v.videoHeight, src: v.currentSrc ? v.currentSrc.replace(/^(\w+:\/\/[^/]*\/[^?]{0,60}).*$/, "$1").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>") : "", buffered: v.buffered.length ? Math.round(v.buffered.end(v.buffered.length - 1)) : 0 }
        : null;
    })(),
    keys: keyLog.slice(),
    scrolled: Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter((e) => e.scrollTop > 0 || e.scrollLeft > 0).map((e) => `${selectorFor(e)} ${Math.round(e.scrollLeft)},${Math.round(e.scrollTop)}`).slice(0, 6),
    // Rects the TV browser reports (stage scale debugging): first Home card and the nav items, plus scroll offsets.
    geo: (() => {
      const r4 = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
      const main = document.querySelector(".app-main");
      return {
        card: r4(document.querySelector(".tv-home-card")),
        nav: Array.from(document.querySelectorAll(".app-nav-link")).map(r4),
        // Track headings and scrollers: the live gap between rails, to tell real layout from a capture artefact.
        tracks: Array.from(document.querySelectorAll(".tv-media-track")).slice(0, 6).map((t) => [r4(t.querySelector("h2")), r4(t.querySelector(".tv-media-track-scroll"))]),
        scroll: [window.scrollY, main ? (main as HTMLElement).scrollTop : null, document.documentElement.scrollTop],
        vv: window.visualViewport ? [window.visualViewport.width, window.visualViewport.height, window.visualViewport.scale] : null,
      };
    })(),
    mq: { w1100: mq("(max-width: 1100px)"), h700: mq("(max-height: 700px)"), w760: mq("(max-width: 760px)"), w920: mq("(max-width: 920px)") },
  };
}

// ?mirrorProbe=<selector>%2C<selector>: report computed font size, box and text width of the first match, to compare the TV with the web.
function probeFontSizes(): unknown[] {
  const raw = new URLSearchParams(window.location.search).get("mirrorProbe") ?? window.sessionStorage.getItem("playarr.debugMirrorProbe");
  if (!raw) return [];
  return raw.split(",").slice(0, 8).map((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return { selector, found: false };
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return { selector, fontSize: cs.fontSize, fontFamily: cs.fontFamily.slice(0, 40), letterSpacing: cs.letterSpacing, w: r.width, h: r.height };
  });
}

export function startDebugMirror(): void {
  const maybeToken = readToken();
  if (!maybeToken) return;
  const token: string = maybeToken; // a declared type survives hoisted function declarations, narrowing does not
  const endpoint = `${window.location.origin}/__mirror/frame`;
  const errors: string[] = [];
  window.addEventListener("error", (e) => {
    errors.push(String(e.message).slice(0, 300));
    if (errors.length > 20) errors.shift();
  });
  window.addEventListener("unhandledrejection", (e) => {
    errors.push("rejection: " + String((e.reason && e.reason.message) || e.reason).slice(0, 300));
    if (errors.length > 20) errors.shift();
  });

  let fontCss: string | null = null;
  const artworkCache = new Map<string, string | null>();
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      errors.push(`${level}: ${args.map((a) => String((a && (a as Error).message) || a)).join(" ").slice(0, 300)}`);
      if (errors.length > 20) errors.shift();
      original(...args);
    };
  }
  let busy = false;
  let pending = false;
  let timer = 0;
  let seq = 0;

  // Identity heartbeat from a Web Worker, so rendering (which blocks this thread for seconds) cannot starve it. The page re-verifies the
  // identity every 2 s and hands the worker the result; the worker asks the server who is current every 2 s and reports that to the
  // receiver, or reports the failed status. The guard judges the signed-in account by the newest heartbeat.
  const heartbeatWorker = new Worker(URL.createObjectURL(new Blob([`
    let cfg = null;
    let previous = null; // the credentials before the last rotation, tried when the server has not accepted the new ones yet
    onmessage = (e) => {
      const m = e.data;
      if (m.type === "creds") {
        if (cfg && cfg.auth && cfg.auth !== m.auth) previous = { auth: cfg.auth, userId: cfg.userId };
        cfg = { ...(cfg || {}), status: "ok", auth: m.auth, userId: m.userId, serverUrl: m.serverUrl, profiles: m.profiles, beatUrl: m.beatUrl };
      } else {
        cfg = { ...(cfg || {}), status: m.status, beatUrl: m.beatUrl, serverUrl: m.serverUrl ?? (cfg && cfg.serverUrl) ?? null };
      }
    };
    const ask = async (c, auth) => {
      const list = await (await fetch(c.profiles, { headers: { Authorization: auth } })).json();
      return Array.isArray(list) ? list.filter((p) => p && p.is_current === true) : [];
    };
    setInterval(async () => {
      const c = cfg;
      if (!c) return;
      const base = { serverUrl: c.serverUrl, isCurrentCount: 0, username: null, checkedAt: Date.now(), sessionChanged: c.status === "session_changed" };
      let body = { ...base, status: c.status };
      if (c.status === "ok" && c.auth) {
        try {
          let current = await ask(c, c.auth).catch(() => []);
          let userId = c.userId;
          if (current.length !== 1 && previous) { current = await ask(c, previous.auth).catch(() => []); userId = previous.userId; }
          body = current.length === 1 && current[0].id === userId && typeof current[0].username === "string"
            ? { ...base, checkedAt: Date.now(), status: "ok", isCurrentCount: 1, username: current[0].username }
            : { ...base, status: "identity_unavailable" };
        } catch { return; }
      }
      try { await fetch(c.beatUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch {}
    }, 2000);
  `], { type: "text/javascript" })));
  const beatUrl = `${window.location.origin}/__mirror/heartbeat?t=${encodeURIComponent(token)}`;
  // Hand the worker the selected credentials the moment the app writes them (a token rotation), not on a timer.
  const syncCredentials = (): void => {
    const session = readSelectedSession(window.localStorage);
    if (session) heartbeatWorker.postMessage({ type: "creds", ...session, profiles: `${session.serverUrl}/api/v1/users/profiles`, beatUrl });
  };
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
    nativeSetItem.call(this, key, value);
    if (this === window.localStorage && (key === MIRROR_PROFILE_SESSIONS_KEY || key === MIRROR_ACTIVE_PROFILE_KEY || key === LIVE_SESSION_KEY)) syncCredentials();
  };
  syncCredentials();
  let verifying = false;
  window.setInterval(() => {
    if (verifying) return;
    verifying = true;
    void readMirrorIdentity(token)
      .then((identity) => {
        // A request that timed out while rendering blocked this thread is not an identity change: keep the last good hand-over. The worker
        // still asks the server itself every 2 s, and the guard still compares the server and user the heartbeat reports.
        if (identity.status === "trusted_server_unavailable") return;
        if (identity.status === "ok") syncCredentials();
        else heartbeatWorker.postMessage({ type: "status", status: identity.status, serverUrl: identity.serverUrl, beatUrl });
      })
      .catch(() => undefined)
      .finally(() => { verifying = false; });
  }, 2000);

  async function snapshot(reason: string): Promise<void> {
    // A parity driver on a slow TV pauses the capture loop while it sends keys (window.__mirrorPause), so key handling is not starved.
    if ((window as unknown as { __mirrorPause?: boolean }).__mirrorPause) return;
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      const started = realNow();
      let image: string | null = null;
      let captureError: string | null = null;
      let initialIdentity: MirrorIdentity | null = null;
      let restoreArtwork: () => void = () => undefined;
      let restoreRing: () => void = () => undefined;
      // ?mirrorPointer=1: the web references show no :focus-visible outline on buttons (their sign-in used pointer clicks).
      // Media cards keep their remote marker, as in the references. Computed styles are inlined in the render, so clear it on the element itself.
      const hideFocusRing = mirrorFlag("mirrorPointer");
      try {
        initialIdentity = await readMirrorIdentity(token);
        if (initialIdentity.status !== "ok") throw new Error("mirror identity verification failed");
        const { toJpeg, toPng, getFontEmbedCSS } = await withTimeout(import("html-to-image"), 10000, "html-to-image import");
        // The TV stage scale (tvStageScale.ts) zooms <html> on most platforms, which html-to-image does
        // not see. VIDAA instead transforms <body>; clear only that transform on the cloned body so the
        // logical stage is rendered once at the requested output density.
        const zoom = parseFloat(document.documentElement.style.getPropertyValue("--stage-zoom")) || 1;
        const hasStageBodyTransform = Boolean(document.body.style.transform && zoom !== 1);
        const geometry = mirrorCaptureGeometry(
          // With the stage transform window.innerWidth/Height are already stage pixels (tvStageScale.ts); the geometry wants the real viewport.
          hasStageBodyTransform ? window.innerWidth * zoom : window.innerWidth,
          hasStageBodyTransform ? window.innerHeight * zoom : window.innerHeight,
          zoom, TARGET_WIDTH, hasStageBodyTransform);
        const stageW = geometry.width;
        const stageH = geometry.height;
        const bg = window.getComputedStyle(document.body).backgroundColor || "#000";
        // The browser itself renders the SVG foreignObject, so modern CSS (color-mix and so on) is drawn faithfully.
        if (fontCss === null) {
          // Embedding fonts on every frame is what made renders crawl on the TV: do it once.
          try {
            fontCss = await withTimeout(getFontEmbedCSS(document.body), 20000, "font embed");
          } catch (err) {
            fontCss = "";
            errors.push("font embed: " + String((err as Error).message).slice(0, 120));
          }
        }
        const ringEl = document.activeElement;
        if (hideFocusRing && ringEl instanceof HTMLElement && ringEl !== document.body && !ringEl.closest(".media-card")) {
          const previousOutline = ringEl.style.outline;
          ringEl.style.outline = "none";
          restoreRing = () => { ringEl.style.outline = previousOutline; };
        }
        const visibleImages = Array.from(document.body.querySelectorAll<HTMLImageElement>("img")).filter((img) => {
          const r = img.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left < stageW && r.top < stageH && r.right > 0 && r.bottom > 0;
        });
        if (!mirrorFlag("mirrorNoArt")) restoreArtwork = await withTimeout(inlineArtwork(visibleImages, window.location.origin, token, artworkCache), 20000, "artwork inline");
        await Promise.all(visibleImages.map((img) => img.decode().catch(() => undefined)));
        // html-to-image clones without scroll offsets, so a rail the page has scrolled (Home, the library grid) would be drawn
        // unscrolled. Tag every scrolled container and let the embedded CSS translate its children by the offset.
        const scrolled = Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter((e) => e.scrollTop > 0 || e.scrollLeft > 0);
        let scrollCss = "";
        // Engines without the individual `translate` property (Chromium before 104, Tizen 6.5) get a transform per child instead,
        // composed in front of the child's own computed transform.
        const hasTranslateProperty = typeof CSS !== "undefined" && CSS.supports("translate", "1px");
        let childId = 0;
        scrolled.forEach((e, i) => {
          e.setAttribute("data-mirror-scroll", String(i));
          if (hasTranslateProperty) {
            scrollCss += `[data-mirror-scroll="${i}"]>*{translate:${-e.scrollLeft}px ${-e.scrollTop}px !important}\n`;
            return;
          }
          for (const child of Array.from(e.children)) {
            const own = window.getComputedStyle(child).transform;
            child.setAttribute("data-mirror-scroll-child", String(childId));
            scrollCss += `[data-mirror-scroll-child="${childId}"]{transform:translate(${-e.scrollLeft}px,${-e.scrollTop}px)${own && own !== "none" ? ` ${own}` : ""} !important}\n`;
            childId += 1;
          }
        });
        image = await withTimeout(
          withCollapsingTrackHeights(() => (usePng ? toPng : toJpeg)(document.body, {
            // The clone loses ::-webkit-scrollbar rules (pseudo-elements are not copied), so overflow containers would draw
            // native scrollbars the TV does not show: hide them in the rendered copy.
            // ?mirrorGeo=1 turns hinting off (geometricPrecision). Measured on the TV: it scored 0.02 to 0.2 lower than the default on settings, month and agenda.
            fontEmbedCSS: `${fontCss}\n${mirrorFlag("mirrorGeo") ? "*{text-rendering:geometricPrecision!important}\n" : ""}*::-webkit-scrollbar{display:none}*{scrollbar-width:none}\n${scrollCss}`,
            // Cross-origin media (posters, video) would stall or taint the render: leave it out.
            filter: (node) => {
              // Skip what lies past the right or bottom edge (long rails and grids): the TV needs far
              // less time to render, and nothing visible moves because earlier siblings stay put.
              if (node instanceof HTMLElement && node !== document.body) {
                const r = node.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && (r.left >= stageW || r.top >= stageH)) return false;
              }
              if (node instanceof HTMLVideoElement) return false;
              if (node instanceof HTMLImageElement && node.src && !node.src.startsWith("data:")) {
                try {
                  return new URL(node.src, window.location.href).origin === window.location.origin;
                } catch {
                  return false;
                }
              }
              return true;
            },
            pixelRatio: geometry.pixelRatio,
            ...(geometry.cloneStyle ? { style: geometry.cloneStyle } : {}),
            quality: 0.92,
            width: stageW,
            height: stageH,
            backgroundColor: bg,
            cacheBust: false,
            imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
          })),
          60000,
          "html-to-image render",
        ).finally(() => scrolled.forEach((e) => e.removeAttribute("data-mirror-scroll")));
      } catch (err) {
        captureError = String((err && (err as Error).message) || err).slice(0, 300);
      } finally {
        restoreArtwork();
        restoreRing();
      }
      const body: Record<string, unknown> = {
        sentinel: MIRROR_SENTINEL,
        seq: ++seq,
        reason,
        at: realNow(),
        captureMs: realNow() - started,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        screen: { w: window.screen.width, h: window.screen.height },
        env: layoutEnv(),
        route: routeWithQuery(),
        focus: focusInfo(),
        text: visibleText(),
        userAgent: navigator.userAgent,
        errors,
        captureError,
        probe: probeFontSizes(),
        image,
      };
      let currentIdentity = initialIdentity;
      if (initialIdentity?.status === "ok") {
        try {
          const fresh = await readMirrorIdentity(token);
          currentIdentity = revalidateMirrorIdentity(initialIdentity, fresh);
          // A token rotation while the frame rendered changes the credentials, not the account: the same selected identity still posts.
          if (currentIdentity.status === "session_changed" && !currentIdentity.selectedIdentityChanged && fresh.status === "ok") currentIdentity = fresh;
        } catch {
          currentIdentity = null;
        }
      }
      if (!currentIdentity || currentIdentity.status !== "ok") {
        if (currentIdentity) {
          await reportMirrorIdentityStatus(currentIdentity, token).catch(() => undefined);
        }
      } else {
        // Keep this allow-list explicit. The internal selected profile and credentials never enter a frame.
        const payload = mirrorFramePayload(body, currentIdentity);
        try {
          await fetchWithTimeout(`${endpoint}?t=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }, 5000);
        } catch {
          // receiver unreachable: try again on the next tick
        }
      }
    } catch {
      // Keep the mirror loop alive after unexpected capture or diagnostic failures.
    } finally {
      busy = false;
      if (pending) {
        pending = false;
        void snapshot("queued");
      }
    }
  }

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      await snapshot("interval");
      schedule();
    }, INTERVAL_MS);
  };
  document.addEventListener("focusin", () => void snapshot("focus"), true);
  void snapshot("start");
  schedule();
}
