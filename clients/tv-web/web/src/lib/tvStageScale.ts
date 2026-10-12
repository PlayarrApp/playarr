/**
 * Fits the TV layout to the CSS viewport the TV browser actually reports.
 *
 * The TV layout is designed on a 1920x1080 stage, but smart-TV browsers
 * report very different CSS viewports: a 4K VIDAA set may report 1280x720 at
 * a devicePixelRatio of 1.5, 960x540 at 2, or a full 3840x2160. TV browsers
 * cannot scroll the page, so a layout that is taller than the viewport is
 * simply cut off (the sign-in link code ended up half off screen).
 *
 * The stage is therefore scaled with CSS `zoom` on the root element so that
 * its height is always 1080 zoomed pixels (its width is whatever the aspect
 * ratio gives, 1920 for 16:9), and the viewport units the stylesheet uses
 * (`--viewport-unit`, `--vw`) are restated in zoomed pixels so every
 * viewport-relative size resolves against the stage, not the raw viewport.
 */
export const TV_STAGE_HEIGHT = 1080;

/** Ignore sub-percent differences so a true 1920x1080 stays untouched. */
const NEUTRAL_TOLERANCE = 0.005;

export interface TvStageScale {
  /** CSS `zoom` for the root element; 1 means the viewport already is the stage. */
  zoom: number;
  /** One percent of the stage width, in zoomed CSS pixels. */
  vw: number;
  /** One percent of the stage height, in zoomed CSS pixels. */
  vh: number;
}

export function computeTvStageScale(viewportWidth: number, viewportHeight: number): TvStageScale {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) {
    return { zoom: 1, vw: 0, vh: 0 };
  }
  const raw = viewportHeight / TV_STAGE_HEIGHT;
  const zoom = Math.abs(raw - 1) < NEUTRAL_TOLERANCE ? 1 : raw;
  return {
    zoom,
    vw: viewportWidth / zoom / 100,
    vh: viewportHeight / zoom / 100,
  };
}

/**
 * How the stage is fitted. "zoom" is CSS `zoom` on the root (webOS, Tizen). "transform" lays the body out at the full
 * stage size and scales it with a transform (VIDAA): old Chromium engines (VIDAA's is Chrome 111) report element rects
 * of a zoomed root in unscaled stage pixels but scroll and viewport values in scaled ones, so the spatial navigation and
 * the rail centring, which mix them, land in the wrong place; with a transform every rect is in the one scaled space.
 */
export type TvStageMode = "zoom" | "transform";

export function applyTvStageScale(
  root: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
  mode: TvStageMode = "zoom"
): TvStageScale {
  const scale = computeTvStageScale(viewportWidth, viewportHeight);
  // The transform goes on <body>, not <html>: the document then still scrolls (and measures) as the real viewport size,
  // because scrollable overflow counts a transformed box at its scaled size.
  const body = root.ownerDocument?.body;
  for (const key of ["zoom", "--stage-zoom"]) root.style.removeProperty(key);
  for (const key of ["transform", "transform-origin", "width", "height"]) body?.style.removeProperty(key);
  if (scale.zoom === 1 || scale.vw === 0) {
    root.style.removeProperty("--vw");
    root.style.removeProperty("--viewport-unit");
    return scale;
  }
  root.style.setProperty("--stage-zoom", String(scale.zoom));
  if (mode === "transform") {
    body?.style.setProperty("width", `${viewportWidth / scale.zoom}px`);
    body?.style.setProperty("height", `${viewportHeight / scale.zoom}px`);
    body?.style.setProperty("transform-origin", "0 0");
    body?.style.setProperty("transform", `scale(${scale.zoom})`);
  } else {
    root.style.setProperty("zoom", String(scale.zoom));
  }
  root.style.setProperty("--vw", `${scale.vw}px`);
  root.style.setProperty("--viewport-unit", `${scale.vh}px`);
  return scale;
}

/** Applies the scale now and again whenever the viewport changes. Returns a disposer. */
export function installTvStageScale(win: Window = window, mode: TvStageMode = "zoom"): () => void {
  const root = win.document.documentElement;
  const apply = () => {
    applyTvStageScale(root, win.innerWidth, win.innerHeight, mode);
  };
  apply();
  win.addEventListener("resize", apply);
  win.addEventListener("orientationchange", apply);
  return () => {
    win.removeEventListener("resize", apply);
    win.removeEventListener("orientationchange", apply);
  };
}
