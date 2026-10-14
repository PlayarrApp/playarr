import { describe, expect, it, vi } from "vitest";
import { applyTvStageScale, computeTvStageScale } from "./tvStageScale";

describe("computeTvStageScale", () => {
  it("leaves a 1920x1080 viewport untouched", () => {
    expect(computeTvStageScale(1920, 1080)).toEqual({ zoom: 1, vw: 19.2, vh: 10.8 });
  });

  it("scales a 1280x720 VIDAA viewport to a 1920x1080 stage", () => {
    const scale = computeTvStageScale(1280, 720);
    expect(scale.zoom).toBeCloseTo(2 / 3, 5);
    expect(scale.vw * 100).toBeCloseTo(1920, 3);
    expect(scale.vh * 100).toBeCloseTo(1080, 3);
  });

  it("scales a 960x540 viewport (devicePixelRatio 2) the same way", () => {
    const scale = computeTvStageScale(960, 540);
    expect(scale.zoom).toBeCloseTo(0.5, 5);
    expect(scale.vw * 100).toBeCloseTo(1920, 3);
  });

  it("scales a 3840x2160 viewport down to the stage", () => {
    const scale = computeTvStageScale(3840, 2160);
    expect(scale.zoom).toBeCloseTo(2, 5);
    expect(scale.vh * 100).toBeCloseTo(1080, 3);
  });

  it("keeps the stage height fixed and lets the width follow the aspect ratio", () => {
    const scale = computeTvStageScale(1366, 768);
    expect(scale.vh * 100).toBeCloseTo(1080, 3);
    expect(scale.vw * 100).toBeCloseTo(1366 / (768 / 1080), 3);
  });

  it("ignores an unusable viewport", () => {
    expect(computeTvStageScale(0, 0).zoom).toBe(1);
  });
});

describe("applyTvStageScale", () => {
  function fakeRoot() {
    const values = new Map<string, string>();
    const style = {
      setProperty: (name: string, value: string) => void values.set(name, value),
      removeProperty: (name: string) => void values.delete(name),
    };
    // Root and body share one map: the tests only care which properties are set after a call.
    const root = { style, ownerDocument: { body: { style } } } as unknown as HTMLElement;
    return { root, values };
  }

  it("writes the root zoom and the stage-pixel viewport units", () => {
    const { root, values } = fakeRoot();
    applyTvStageScale(root, 1280, 720);
    expect(Number(values.get("zoom"))).toBeCloseTo(2 / 3, 5);
    expect(values.get("--vw")).toMatch(/px$/);
    expect(values.get("--viewport-unit")).toMatch(/px$/);
  });

  it("transform mode lays the root out at stage size and scales it, with no zoom", () => {
    const { root, values } = fakeRoot();
    applyTvStageScale(root, 1280, 720, "transform");
    expect(values.has("zoom")).toBe(false);
    expect(parseFloat(values.get("width") ?? "")).toBeCloseTo(1920, 3);
    expect(parseFloat(values.get("height") ?? "")).toBeCloseTo(1080, 3);
    expect(values.get("transform-origin")).toBe("0 0");
    expect(values.get("transform")).toMatch(/^scale\(0\.666/);
    expect(Number(values.get("--stage-zoom"))).toBeCloseTo(2 / 3, 5);
  });

  it("switching mode or returning to the stage size clears the other mode's properties", () => {
    const { root, values } = fakeRoot();
    applyTvStageScale(root, 1280, 720, "transform");
    applyTvStageScale(root, 1280, 720, "zoom");
    expect(values.has("transform")).toBe(false);
    expect(values.has("width")).toBe(false);
    expect(Number(values.get("zoom"))).toBeCloseTo(2 / 3, 5);
  });

  it("clears them again once the viewport is the stage", () => {
    const { root, values } = fakeRoot();
    applyTvStageScale(root, 1280, 720);
    applyTvStageScale(root, 1920, 1080);
    expect(values.size).toBe(0);
  });
});

describe("patchStageGeometry", () => {
  it("reports rects and the window size in stage pixels, and follows a changed scale", async () => {
    class Rect { constructor(public x: number, public y: number, public width: number, public height: number) {} }
    (globalThis as unknown as { DOMRect: unknown }).DOMRect = Rect;
    class El { getBoundingClientRect() { return new Rect(300, 200, 150, 100); } getClientRects() { return [new Rect(30, 20, 15, 10)]; } }
    const win = { Element: El } as unknown as Window;
    Object.defineProperty(win, "innerWidth", { configurable: true, get: () => 1280 });
    Object.defineProperty(win, "innerHeight", { configurable: true, get: () => 720 });
    const { patchStageGeometry } = await import("./tvStageScale");
    patchStageGeometry(win, 2 / 3);
    const r = new El().getBoundingClientRect();
    expect([r.x, r.y, r.width, r.height].map(Math.round)).toEqual([450, 300, 225, 150]);
    expect(Math.round(new El().getClientRects()[0]?.x ?? 0)).toBe(45);
    expect([win.innerWidth, win.innerHeight]).toEqual([1920, 1080]);
    patchStageGeometry(win, 0.5);
    expect(Math.round(new El().getBoundingClientRect().x)).toBe(600);
    expect(win.innerWidth).toBe(2560);
  });
});

describe("rewriteMediaForStage", () => {
  it("evaluates px width and height clauses against the stage and keeps the rest", async () => {
    const { rewriteMediaForStage: r } = await import("./tvStageScale");
    expect(r("(max-height: 800px)", 1920, 1080)).toBe("not all");
    expect(r("(max-height: 800px)", 1280, 720)).toBe("all");
    expect(r("(min-width: 761px)", 1920, 1080)).toBe("all");
    expect(r("(max-width: 920px) and (max-height: 500px) and (pointer: coarse)", 1920, 1080)).toBe("not all");
    expect(r("(max-width: 2000px) and (pointer: coarse)", 1920, 1080)).toBe("(pointer: coarse)");
    expect(r("(max-width: 760px), (prefers-reduced-motion: reduce)", 1920, 1080)).toBe("(prefers-reduced-motion: reduce)");
    expect(r("(orientation: portrait)", 1920, 1080)).toBe("(orientation: portrait)");
  });

  it("handles not queries", async () => {
    const { rewriteMediaForStage: r } = await import("./tvStageScale");
    expect(r("not all and (max-height: 800px)", 1920, 1080)).toBe("all"); // not (false) is true
    expect(r("not (min-width: 761px)", 1920, 1080)).toBe("not all"); // not (true) never matches
    expect(r("not (min-width: 761px) and (pointer: coarse)", 1920, 1080)).toBe("not (pointer: coarse)");
  });
});

// A minimal browser: enough of window, Element, Range and document for the stage patches.
async function fakeBrowser(rawW: number, rawH: number) {
  vi.resetModules();
  class Rect { constructor(public x: number, public y: number, public width: number, public height: number) {} }
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = Rect;
  class El { getBoundingClientRect() { return new Rect(300, 200, 150, 100); } getClientRects() { return [new Rect(30, 20, 15, 10)]; } }
  class Rng { getBoundingClientRect() { return new Rect(600, 400, 30, 20); } getClientRects() { return []; } }
  const sheetReads = { n: 0 };
  const listeners: Record<string, ((e: { target: unknown }) => void)[]> = {};
  const mqCalls: string[] = [];
  const doc = {
    head: {},
    body: { style: { setProperty() {}, removeProperty() {} } },
    get styleSheets() { sheetReads.n++; return []; },
    addEventListener: (t: string, h: (e: { target: unknown }) => void) => (listeners[t] ??= []).push(h),
  };
  const win = { Element: El, Range: Rng, document: doc, matchMedia: (q: string) => { mqCalls.push(q); return { matches: true }; } } as unknown as Window & { matchMedia: (q: string) => unknown };
  Object.defineProperty(win, "innerWidth", { configurable: true, get: () => rawW });
  Object.defineProperty(win, "innerHeight", { configurable: true, get: () => rawH });
  (doc as unknown as { defaultView: unknown }).defaultView = win;
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class { observe() {} };
  const props = new Map<string, string>();
  const style = { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) };
  const root = { style, ownerDocument: doc } as unknown as HTMLElement;
  (doc.body as unknown as { style: unknown }).style = style;
  return { El, Rng, win, root, sheetReads, listeners, mqCalls, doc };
}

describe("stage geometry patches", () => {
  it("a poster image load does not re-walk the stylesheets; a stylesheet load does", async () => {
    const b = await fakeBrowser(1280, 720);
    const { applyTvStageScale } = await import("./tvStageScale");
    applyTvStageScale(b.root, 1280, 720, "transform");
    const before = b.sheetReads.n;
    for (const h of b.listeners.load ?? []) h({ target: { tagName: "IMG" } });
    expect(b.sheetReads.n).toBe(before);
    for (const h of b.listeners.load ?? []) h({ target: { tagName: "LINK" } });
    expect(b.sheetReads.n).toBeGreaterThan(before);
  });

  it("applying 1280x720 then 1920x1080 gives unscaled rects, window size and media again", async () => {
    const b = await fakeBrowser(1280, 720);
    const { applyTvStageScale } = await import("./tvStageScale");
    applyTvStageScale(b.root, 1280, 720, "transform");
    expect(Math.round(new b.El().getBoundingClientRect().x)).toBe(450);
    expect(Math.round(new b.Rng().getBoundingClientRect().x)).toBe(900);
    expect(b.win.innerWidth).toBe(1920);
    applyTvStageScale(b.root, 1920, 1080, "transform");
    expect(new b.El().getBoundingClientRect().x).toBe(300);
    expect(new b.Rng().getBoundingClientRect().x).toBe(600);
    b.win.matchMedia("(max-height: 800px)");
    expect(b.mqCalls.at(-1)).toBe("(max-height: 800px)");
  });

  it("zoom mode leaves the window size, Element.prototype and matchMedia untouched", async () => {
    const b = await fakeBrowser(1280, 720);
    const rectBefore = b.El.prototype.getBoundingClientRect;
    const mqBefore = b.win.matchMedia;
    const { applyTvStageScale } = await import("./tvStageScale");
    applyTvStageScale(b.root, 1280, 720, "zoom");
    expect(b.El.prototype.getBoundingClientRect).toBe(rectBefore);
    expect(b.win.matchMedia).toBe(mqBefore);
    expect(b.win.innerWidth).toBe(1280);
  });

  it("maps a pointer to the stage space of the reported rects", async () => {
    const b = await fakeBrowser(1280, 720);
    const { applyTvStageScale, stageClientX } = await import("./tvStageScale");
    expect(stageClientX(640)).toBe(640);
    applyTvStageScale(b.root, 1280, 720, "transform");
    // the middle of a 1920-wide stage element is clientX 640 on a 1280 screen
    const rect = { left: 0, width: 1920 };
    expect((stageClientX(640) - rect.left) / rect.width).toBeCloseTo(0.5, 5);
    applyTvStageScale(b.root, 1920, 1080, "transform");
    expect(stageClientX(640)).toBe(640);
  });
});
