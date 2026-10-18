import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";
import { DownloadsProvider } from "./lib/DownloadsProvider";
import { HomeViewProvider } from "./lib/homeView";
import { ArtworkSizeProvider } from "./lib/artworkSize";
import { LanguageProvider } from "./lib/i18n/LanguageProvider";
import { LiveEventsRoot } from "./lib/liveEvents/LiveEventsRoot";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import {
  IS_PACKAGED_TV,
  IS_TIZEN,
  IS_VIDAA,
  IS_WEBOS,
  PLAYARR_CLIENT_PLATFORM,
} from "./lib/clientPlatform";
import { syncInstalledAppHint } from "./lib/signedInHint";
import { installTvStageScale } from "./lib/tvStageScale";
import { installVidaaLongPress } from "./lib/vidaaLongPress";
import { installScrollEdgeFades } from "./lib/scrollEdgeFade";
import {
  bootstrapParityMode,
  installParityApplyHook,
  readParityMode,
  readTvCrossEngine,
} from "./lib/parityMode";
import { installCrossEngineHook } from "./lib/crossEngineAssets";
import "./styles/fonts.css";
import "./styles/global.css";
import "./styles/page-layout.css";

// Debug builds only (`--mode debug-mirror`): the constant is false in every other build, so the
// bundler drops this branch and the mirror module never reaches a production bundle.
if (__PLAYARR_DEBUG_MIRROR__) {
  // Capture the token from the launch URL now: the router may rewrite the query before the chunk loads.
  try {
    const launchToken = new URLSearchParams(window.location.search).get("mirrorToken");
    if (launchToken) window.sessionStorage.setItem("playarr.debugMirrorToken", launchToken);
    const flags: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => { if (key.startsWith("mirror") && key !== "mirrorToken") flags[key] = value; });
    window.sessionStorage.setItem("playarr.debugMirrorFlags", JSON.stringify(flags));
    const probeParam = new URLSearchParams(window.location.search).get("mirrorProbe");
    if (probeParam) window.sessionStorage.setItem("playarr.debugMirrorProbe", probeParam);
    if (new URLSearchParams(window.location.search).get("mirrorPointer") === "1") window.sessionStorage.setItem("playarr.debugMirrorPointer", "1");
  } catch {
    // sessionStorage unavailable: the mirror falls back to the URL
  }
  // ?mirrorNow=<ISO date-time> freezes Date so a capture shows the same day and time as its web reference.
  // shortcut: frozen time never advances, so timers keyed on it stall; fine for the short capture sessions this debug build serves.
  try {
    const nowParam = new URLSearchParams(window.location.search).get("mirrorNow");
    const fixed = nowParam ? Date.parse(nowParam) : NaN;
    if (Number.isFinite(fixed)) {
      (window as unknown as { __mirrorRealNow: () => number }).__mirrorRealNow = Date.now.bind(Date);
      const RealDate = Date;
      class FrozenDate extends RealDate {
        constructor(...args: unknown[]) {
          super(...((args.length ? args : [fixed]) as [number]));
        }
        static override now(): number {
          return fixed;
        }
      }
      window.Date = FrozenDate as DateConstructor;
    }
  } catch {
    // leave the real clock
  }
  void import("./debug/mirror").then((m) => m.startDebugMirror());
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

document.documentElement.dataset.platform = PLAYARR_CLIENT_PLATFORM;

// One edge fade for every scroll container no component manages (drawers, dialogs, menus, panels).
installScrollEdgeFades();

// Smart-TV browsers report assorted viewports and cannot scroll: fit the 1920x1080 TV stage to them.
if (IS_VIDAA || IS_WEBOS || IS_TIZEN) {
  installTvStageScale(window, IS_VIDAA ? "transform" : "zoom");
}

// VIDAA's remote service sends a long press of OK as an instant burst: make it a real hold (VIDAA only).
if (IS_VIDAA) {
  installVidaaLongPress();
}

// Product TV cross-engine assets: identical text/media, live layout (no solidify).
const tvCrossEngine = readTvCrossEngine();
if (tvCrossEngine) {
  document.documentElement.dataset.tvCrossEngine = "1";
  installCrossEngineHook();
}

// Legacy solidify modes only when explicitly requested (not tvCrossEngine).
const parityMode = readParityMode();
if (parityMode !== "off" && !tvCrossEngine) {
  document.documentElement.dataset.parity = parityMode;
  installParityApplyHook();
}

// Installed apps are never shown the marketing site, signed in or not (see worker.js and appSignal.js).
syncInstalledAppHint(PLAYARR_CLIENT_PLATFORM !== "web");

const Router = IS_PACKAGED_TV ? HashRouter : BrowserRouter;

createRoot(container).render(
  <StrictMode>
    <Router basename={IS_PACKAGED_TV ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <LanguageProvider>
        <ThemeProvider>
          <HomeViewProvider>
            <ArtworkSizeProvider>
            <ApiClientProvider>
              <ToastProvider>
                <LiveEventsRoot>
                  <DownloadsProvider>
                    <App />
                  </DownloadsProvider>
                </LiveEventsRoot>
              </ToastProvider>
            </ApiClientProvider>
            </ArtworkSizeProvider>
          </HomeViewProvider>
        </ThemeProvider>
      </LanguageProvider>
    </Router>
  </StrictMode>
);

// Cross-engine assets are applied by the AE gate after catalogue is ready
// (window.__playarrApplyCrossEngineAssets). Avoid racing partial DOM here.
if (parityMode !== "off" && !tvCrossEngine) {
  const run = () => {
    void bootstrapParityMode(parityMode);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setTimeout(run, parityMode === "raster" ? 1200 : 0);
      }),
    );
  }
  window.addEventListener("popstate", () => {
    setTimeout(run, 400);
  });
}
