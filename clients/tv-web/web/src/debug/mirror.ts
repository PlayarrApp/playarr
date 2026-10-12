// DEBUG BUILD ONLY (vite --mode debug-mirror). Never ship this in playarr.app or any released client.
//
// Posts a downscaled JPEG of the app plus layout/focus facts to the local dev receiver that serves this
// build, every ~2 s and on every focus change. The receiver origin is the page's own origin and the
// token comes from the launch URL (?mirrorToken=...), so nothing about the environment is baked in.
import { focusInfo, visibleText } from "./mirrorSnapshot";

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
    const now = Date.now();
    keyLog.push(`${type} ${e.key}/${e.keyCode}${e.repeat ? " rep" : ""} +${lastKeyAt ? now - lastKeyAt : 0}`);
    lastKeyAt = now;
    if (keyLog.length > 12) keyLog.shift();
  }, true);
}

function layoutEnv(): Record<string, unknown> {
  const root = document.documentElement;
  const mq = (q: string) => window.matchMedia(q).matches;
  return {
    zoom: root.style.getPropertyValue("zoom"),
    vw: root.style.getPropertyValue("--vw"),
    viewportUnit: root.style.getPropertyValue("--viewport-unit"),
    artwork: root.dataset.artworkSize ?? null,
    theme: root.dataset.theme ?? null,
    platform: root.dataset.platform ?? null,
    fontPx: window.getComputedStyle(root).fontSize,
    video: (() => {
      const v = document.querySelector("video");
      return v
        ? { t: Math.round(v.currentTime * 10) / 10, ready: v.readyState, net: v.networkState, paused: v.paused, err: v.error ? `${v.error.code} ${v.error.message}`.slice(0, 120) : null, w: v.videoWidth, h: v.videoHeight, src: v.currentSrc ? v.currentSrc.replace(/^(\w+:\/\/[^/]*\/[^?]{0,60}).*$/, "$1").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>") : "", buffered: v.buffered.length ? Math.round(v.buffered.end(v.buffered.length - 1)) : 0 }
        : null;
    })(),
    keys: keyLog.slice(),
    mq: { w1100: mq("(max-width: 1100px)"), h700: mq("(max-height: 700px)"), w760: mq("(max-width: 760px)"), w920: mq("(max-width: 920px)") },
  };
}

export function startDebugMirror(): void {
  const token = readToken();
  if (!token) return;
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

  async function snapshot(reason: string): Promise<void> {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    const started = Date.now();
    let image: string | null = null;
    let captureError: string | null = null;
    try {
      const { toJpeg, toPng, getFontEmbedCSS } = await withTimeout(import("html-to-image"), 10000, "html-to-image import");
      // The TV stage scale (tvStageScale.ts) zooms <html>, which html-to-image does not see (it clones
      // <body> with computed styles in stage units): render the stage size, not the zoomed viewport.
      const zoom = parseFloat(document.documentElement.style.getPropertyValue("zoom")) || 1;
      const stageW = Math.round(window.innerWidth / zoom);
      const stageH = Math.round(window.innerHeight / zoom);
      const scale = Math.min(1, TARGET_WIDTH / Math.max(1, stageW));
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
      image = await withTimeout(
        (usePng ? toPng : toJpeg)(document.body, {
          // The clone loses ::-webkit-scrollbar rules (pseudo-elements are not copied), so overflow containers would draw
          // native scrollbars the TV does not show: hide them in the rendered copy.
          fontEmbedCSS: `${fontCss}\n*::-webkit-scrollbar{display:none}*{scrollbar-width:none}`,
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
          pixelRatio: scale,
          quality: 0.92,
          width: stageW,
          height: stageH,
          backgroundColor: bg,
          cacheBust: false,
          imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
        }),
        60000,
        "html-to-image render",
      );
    } catch (err) {
      captureError = String((err && (err as Error).message) || err).slice(0, 300);
    }
    const body = {
      sentinel: MIRROR_SENTINEL,
      seq: ++seq,
      reason,
      at: Date.now(),
      captureMs: Date.now() - started,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      screen: { w: window.screen.width, h: window.screen.height },
      env: layoutEnv(),
      route: routeWithQuery(),
      focus: focusInfo(),
      text: visibleText(),
      userAgent: navigator.userAgent,
      errors,
      captureError,
      image,
    };
    try {
      await fetch(`${endpoint}?t=${encodeURIComponent(token as string)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // receiver unreachable: try again on the next tick
    }
    busy = false;
    if (pending) {
      pending = false;
      void snapshot("queued");
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
