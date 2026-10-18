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

/**
 * Transform mode (VIDAA): the page lays out in 1920x1080 stage pixels (clientHeight, offsets, scrollTop) but the browser
 * reports rects and the viewport size in scaled screen pixels. The navigation and rail-centring code mixes the two, so the
 * first Home card landed 143 stage px lower than on web and Left picked another nav item. In transform mode, rects of
 * elements and ranges and the window size are reported in stage pixels (divided by the scale; the stage origin is 0,0),
 * exactly as at a real 1920x1080 viewport. The patches are installed once, read this state, and pass straight through
 * whenever it is inactive (zoom mode, or a viewport that already is the stage), so a resize back to 1920x1080 is clean.
 * Range.prototype is patched on purpose: text-box measurements (the sign-in code, wrapped text) must agree with element
 * rects. Pointer coordinates stay in screen pixels: use stageClientX() where a pointer is compared with a rect.
 */
interface StageState {
  factor: number;
  width: number;
  height: number;
}
const stage: StageState = { factor: 1, width: 0, height: 0 };
let geometryPatched = false;
const rawViewport: { innerWidth?: () => number; innerHeight?: () => number } = {};

/** A pointer x (event.clientX, screen pixels) in the same space as the rects this module reports. */
export function stageClientX(clientX: number): number {
  return clientX / stage.factor;
}

export function patchStageGeometry(win: Window, zoom: number): void {
  stage.factor = zoom > 0 ? zoom : 1;
  if (geometryPatched || stage.factor === 1) return;
  geometryPatched = true;
  const scaleRect = (r: DOMRect): DOMRect => {
    const f = 1 / stage.factor;
    return new DOMRect(r.x * f, r.y * f, r.width * f, r.height * f);
  };
  const patchRects = (target: { getBoundingClientRect: () => DOMRect; getClientRects: () => DOMRectList }) => {
    const rect = target.getBoundingClientRect;
    const rects = target.getClientRects;
    target.getBoundingClientRect = function (this: unknown): DOMRect {
      return stage.factor === 1 ? rect.call(this) : scaleRect(rect.call(this));
    };
    target.getClientRects = function (this: unknown): DOMRectList {
      const list = rects.call(this);
      if (stage.factor === 1) return list;
      const out = Array.from(list, scaleRect);
      return Object.assign(out, { item: (i: number) => out[i] ?? null }) as unknown as DOMRectList;
    };
  };
  patchRects((win as unknown as { Element: typeof Element }).Element.prototype);
  const rangeProto = (win as unknown as { Range?: { prototype: Range } }).Range?.prototype;
  if (rangeProto) patchRects(rangeProto);
  for (const key of ["innerWidth", "innerHeight"] as const) {
    const raw = Object.getOwnPropertyDescriptor(win, key) ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(win), key);
    const get = raw?.get;
    if (!get) continue;
    Object.defineProperty(win, key, { configurable: true, get: () => Math.round((get.call(win) as number) / stage.factor) });
    rawViewport[key] = () => get.call(win) as number;
  }
}

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
  const win = root.ownerDocument?.defaultView ?? null;
  if (mode !== "transform" || scale.zoom === 1 || scale.vw === 0) {
    stage.factor = 1; // the geometry and media patches, if installed, pass through again
    if (win) installStageMedia(win, 1, viewportWidth, viewportHeight);
  }
  for (const key of ["zoom", "--stage-zoom"]) root.style.removeProperty(key);
  for (const key of ["transform", "transform-origin", "width", "height"]) body?.style.removeProperty(key);
  if (scale.zoom === 1 || scale.vw === 0) {
    root.style.removeProperty("--vw");
    root.style.removeProperty("--viewport-unit");
    return scale;
  }
  root.style.setProperty("--stage-zoom", String(scale.zoom));
  if (mode === "transform") {
    if (win) {
      patchStageGeometry(win, scale.zoom);
      installStageMedia(win, scale.zoom, viewportWidth, viewportHeight);
    }
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

/** True while a text field has focus, i.e. while the on-screen keyboard (IME) may be open. */
function textFieldFocused(doc: Document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "TEXTAREA" || el.isContentEditable === true || (el.tagName === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|image|file)$/i.test((el as HTMLInputElement).type));
}

/**
 * Applies the scale now and again whenever the viewport changes. Returns a disposer.
 * Tizen shrinks the viewport when the IME opens; recomputing then would shrink the whole stage and push the app up. A
 * height-only shrink while a text field is focused is therefore ignored (the stage keeps its last size, behind the
 * keyboard). Width changes and growth still apply, so a real resolution change and the keyboard closing both work.
 */
export function installTvStageScale(win: Window = window, mode: TvStageMode = "zoom"): () => void {
  const root = win.document.documentElement;
  let lastW = 0;
  let lastH = 0;
  const apply = () => {
    // After the geometry patch window.innerWidth is the stage size; the scale needs the real viewport.
    const w = rawViewport.innerWidth?.() ?? win.innerWidth;
    const h = rawViewport.innerHeight?.() ?? win.innerHeight;
    if (lastH > 0 && w === lastW && h < lastH && textFieldFocused(win.document)) return;
    lastW = w;
    lastH = h;
    applyTvStageScale(root, w, h, mode);
  };
  apply();
  win.addEventListener("resize", apply);
  win.addEventListener("orientationchange", apply);
  return () => {
    win.removeEventListener("resize", apply);
    win.removeEventListener("orientationchange", apply);
  };
}

/**
 * Media queries see the real viewport (1280x720 on the TV), not the 1920x1080 stage, so rules such as
 * `(max-height: 800px)` compact the nav rail on the TV but not at a real 1080 stage (rail spacing 68 vs 73.5 px, Left from the
 * first Home card picking another nav item). In transform mode every stylesheet media rule that tests width or height in
 * px is evaluated against the stage size and rewritten to `all` / `not all` (other features are kept), and matchMedia is
 * given the same treatment. Original conditions are remembered, so a resize re-evaluates from them.
 */
const SIZE_CLAUSE = /\(\s*(min|max)-(width|height)\s*:\s*([\d.]+)px\s*\)/gi;

export function rewriteMediaForStage(query: string, stageWidth: number, stageHeight: number): string {
  const out: string[] = [];
  for (const raw of query.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const negated = /^not\s+/i.test(part);
    const body = negated ? part.replace(/^not\s+/i, "") : part;
    let dead = false;
    const rest = body.replace(SIZE_CLAUSE, (_m, kind: string, dim: string, px: string) => {
      const size = dim.toLowerCase() === "width" ? stageWidth : stageHeight;
      const ok = kind.toLowerCase() === "min" ? size >= Number(px) : size <= Number(px);
      if (!ok) dead = true;
      return "\u0000";
    });
    // Drop the satisfied clauses and the "and" joining them.
    const cleaned = rest
      .replace(/\s+and\s+\u0000/g, "")
      .replace(/\u0000\s+and\s+/g, "")
      .replace(/\u0000/g, "")
      .trim();
    const plain = cleaned === "" || /^(only\s+)?(screen|all)$/i.test(cleaned);
    if (dead) {
      if (negated) out.push("all"); // not (something that is false here) is true
      continue;
    }
    if (negated) {
      if (!plain) out.push(`not ${cleaned}`);
      continue; // not (true) is false: the part never matches
    }
    out.push(plain ? "all" : cleaned);
  }
  return out.length ? out.join(", ") : "not all";
}

type MediaRuleLike = { media: { mediaText: string }; cssRules?: ArrayLike<unknown> };
const originalMedia = new WeakMap<object, string>();

function walkRules(rules: ArrayLike<unknown> | undefined, visit: (rule: MediaRuleLike) => void): void {
  if (!rules) return;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as MediaRuleLike & { type?: number };
    if (rule && rule.media) visit(rule);
    if (rule && rule.cssRules) walkRules(rule.cssRules, visit);
  }
}

export function applyStageMedia(doc: Document, stageWidth: number, stageHeight: number): void {
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet: not ours
    }
    walkRules(rules, (rule) => {
      const original = originalMedia.get(rule) ?? rule.media.mediaText;
      originalMedia.set(rule, original);
      const next = rewriteMediaForStage(original, stageWidth, stageHeight);
      if (rule.media.mediaText !== next) rule.media.mediaText = next;
    });
  }
}

const mediaState = { width: 0, height: 0, active: false };
let mediaPatched = false;
const isStyleSource = (t: EventTarget | null): boolean => {
  const tag = (t as { tagName?: string } | null)?.tagName;
  return tag === "LINK" || tag === "STYLE";
};

/** Evaluates the size media rules against the stage (zoom > 1 or < 1) or restores them (zoom === 1). */
export function installStageMedia(win: Window, zoom: number, rawWidth: number, rawHeight: number): void {
  mediaState.active = zoom !== 1;
  mediaState.width = Math.round(rawWidth / zoom);
  mediaState.height = Math.round(rawHeight / zoom);
  const run = () => {
    if (mediaState.active) applyStageMedia(win.document, mediaState.width, mediaState.height);
    else restoreMedia(win.document);
  };
  run();
  if (!mediaPatched && mediaState.active) {
    mediaPatched = true;
    // Stylesheets that arrive later (lazy route chunks) get the same treatment once loaded. Only a stylesheet source
    // counts: a poster image's load event must not re-walk every rule.
    new MutationObserver(run).observe(win.document.head, { childList: true });
    win.document.addEventListener("load", (e) => { if (isStyleSource(e.target)) run(); }, true);
    const original = win.matchMedia.bind(win);
    win.matchMedia = (q: string) =>
      original(mediaState.active ? rewriteMediaForStage(q, mediaState.width, mediaState.height) : q);
  }
}

function restoreMedia(doc: Document): void {
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    walkRules(rules, (rule) => {
      const original = originalMedia.get(rule);
      if (original !== undefined && rule.media.mediaText !== original) rule.media.mediaText = original;
    });
  }
}
