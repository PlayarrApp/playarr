/**
 * Layout exporter for the parity layout score (docs/parity/LAYOUT.md). Parity builds only (PLAYARR_PARITY_CONTROL=1).
 * A class component sits in the tree; its React fiber leads to the root, and the walk reads every host view, text and image with
 * its resolved style and window rect. `cmd=layout` logs the document in chunks the driver reassembles.
 */
import React from 'react';
import {Dimensions, StyleSheet} from 'react-native';

const textLines = new WeakMap<object, Array<{x: number; y: number; width: number; height: number}>>();

export function registerLines(instance: object | null, lines: Array<{x: number; y: number; width: number; height: number}>): void {
  if (instance) textLines.set(instance, lines);
}

/** Anchors the exporter in the React tree: its fiber leads to the root. It renders nothing. */
export class LayoutProbe extends React.Component {
  render(): React.ReactNode {
    return null;
  }
  fiber(): any {
    return (this as any)._reactInternals;
  }
}

type Fiber = any;

const publicInstance = (fiber: Fiber): any => fiber.stateNode?.canonical ?? fiber.stateNode;
const measure = (inst: any): Promise<[number, number, number, number] | null> =>
  new Promise((resolve) => {
    if (!inst || typeof inst.measureInWindow !== 'function') return resolve(null);
    const timer = setTimeout(() => resolve(null), 1500);
    inst.measureInWindow((x: number, y: number, w: number, h: number) => {
      clearTimeout(timer);
      resolve([x, y, w, h]);
    });
  });

function hex(color: unknown): string | null {
  if (typeof color === 'number') {
    // RN processed colour: 0xAARRGGBB
    const n = color >>> 0;
    const a = (n >>> 24) & 255;
    const h = (v: number): string => v.toString(16).padStart(2, '0');
    return `#${h((n >> 16) & 255)}${h((n >> 8) & 255)}${h(n & 255)}${a === 255 ? '' : h(a)}`;
  }
  if (typeof color !== 'string') return null;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (m) return `#${m[1]!.toLowerCase()}${m[2] ? m[2].toLowerCase() : ''}`;
  const c = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (c) {
    const h = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
    const a = c[4] === undefined ? 1 : Number(c[4]);
    return `#${h(+c[1]!)}${h(+c[2]!)}${h(+c[3]!)}${a >= 0.999 ? '' : h(a * 255)}`;
  }
  return null;
}

function over(top: string, under: string): string {
  const p = (s: string): number[] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), s.length > 7 ? parseInt(s.slice(7, 9), 16) / 255 : 1];
  const [t, u] = [p(top), p(under)];
  const a = t[3]!;
  const h = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
  return `#${[0, 1, 2].map((i) => h(t[i]! * a + u[i]! * (1 - a))).join('')}`;
}

const hasBorder = (style: Record<string, unknown>): boolean =>
  ['borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'].some((key) => typeof style[key] === 'number' && (style[key] as number) > 0);

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface LayoutElement {
  text: string;
  role: string;
  rect: {x: number; y: number; w: number; h: number};
  color: string | null;
  background: string;
  fontSize: number | null;
  fontWeight: number | null;
  radius?: number;
  opacity?: number;
  /** A later opaque view covers the whole box; the driver confirms against the screen and drops it. Not published. */
  covered?: boolean;
  /** Debug only: the host type and key style entries, to map unnamed views. */
  src?: string;
}

function textOf(fiber: Fiber): string {
  const out: string[] = [];
  const walk = (f: Fiber | null): void => {
    for (let c = f?.child; c; c = c.sibling) {
      if (c.tag === 6) out.push(String(c.memoizedProps));
      else if (c.tag === 5 && c.type === 'RCTVirtualText') walk(c);
      else if (c.tag !== 5) walk(c);
    }
  };
  walk(fiber);
  return out.join('').replace(/\s+/g, ' ').trim();
}

type Box = [number, number, number, number];

/**
 * Vega's measureInWindow puts a child at its parent's measured origin plus the child's untransformed layout offset, applies the
 * child's own scale about its own centre, and scales only the size by every ancestor's scale. A child of a scaled view (a focused
 * card) therefore reports its origin where an unscaled parent would put it, while the screen draws it at the scaled position.
 * This rebuilds each box the screen draws: the layout offsets come from the measured origins with each view's own transform taken
 * out (its style's scale and translate), then the transforms of the view and every ancestor are applied, each about its box centre.
 */
function drawnRects(hosts: Array<{fiber: Fiber; parent: number}>, measured: Array<Box | null>): {boxes: Array<Box | null>; scale: number[]} {
  const own = hosts.map((h) => {
    const style = StyleSheet.flatten(h.fiber.memoizedProps?.style) ?? {};
    let s = 1;
    let tx = 0;
    let ty = 0;
    for (const t of Array.isArray(style.transform) ? (style.transform as Array<Record<string, number>>) : []) {
      if (typeof t.scale === 'number') s *= t.scale;
      if (typeof t.translateX === 'number') tx += t.translateX;
      if (typeof t.translateY === 'number') ty += t.translateY;
    }
    return {s, tx, ty};
  });
  const scale: number[] = [];
  const layout: Array<Box | null> = [];
  const out: Array<Box | null> = [];
  hosts.forEach((h, i) => {
    const m = measured[i];
    const p = h.parent;
    scale[i] = (p >= 0 ? scale[p]! : 1) * own[i]!.s;
    const pm = p >= 0 ? measured[p] : [0, 0, 0, 0];
    const pl = p >= 0 ? layout[p] : [0, 0, 0, 0];
    layout[i] = null;
    out[i] = m;
    if (!m || !pm || !pl) return;
    const w = m[2] / scale[i]!;
    const hh = m[3] / scale[i]!;
    const o = own[i]!;
    const x = pl[0] + (m[0] - w / 2 * (1 - o.s) - o.tx - pm[0]);
    const y = pl[1] + (m[1] - hh / 2 * (1 - o.s) - o.ty - pm[1]);
    layout[i] = [x, y, w, hh];
    let [x0, y0, x1, y1] = [x, y, x + w, y + hh];
    for (let n = i; n >= 0; n = hosts[n]!.parent) {
      const l = layout[n];
      if (!l) return;
      const [cx, cy] = [l[0] + l[2] / 2, l[1] + l[3] / 2];
      const t = own[n]!;
      x0 = cx + t.s * (x0 - cx) + t.tx;
      x1 = cx + t.s * (x1 - cx) + t.tx;
      y0 = cy + t.s * (y0 - cy) + t.ty;
      y1 = cy + t.s * (y1 - cy) + t.ty;
    }
    out[i] = [x0, y0, x1 - x0, y1 - y0];
  });
  return {boxes: out, scale};
}
/** Walks the fiber tree from the root and returns the document's elements in tree order. */
let coverViews: Array<{fiber: Fiber; opacity: number}> = [];

/** cmd=cover: hides (or restores) the views that cover flagged elements, so the driver can see what lies under them. */
export function setCover(on: boolean): void {
  for (const v of coverViews) publicInstance(v.fiber)?.setNativeProps?.({style: {opacity: on ? 0 : v.opacity}});
}

export async function exportLayout(probe: LayoutProbe, bg: string, level: string): Promise<LayoutElement[]> {
  const debug = level !== '0';
  let root: Fiber = probe.fiber();
  while (root.return) root = root.return;
  const hosts: Array<{fiber: Fiber; bg: string; opacity: number; parent: number}> = [];
  const visit = (fiber: Fiber, under: string, opacity: number, parent: number): void => {
    for (let f = fiber.child; f; f = f.sibling) {
      // A navigator keeps the screens under the focused one mounted: they are not on screen.
      const nav = f.memoizedProps?.navigation;
      if (f.stateNode === probe) continue;
      if (f.tag !== 5 && f.memoizedProps?.route && nav && typeof nav.isFocused === 'function' && !nav.isFocused()) continue;
      let nextBg = under;
      let nextOpacity = opacity;
      let nextParent = parent;
      if (f.tag === 5) {
        const style = StyleSheet.flatten(f.memoizedProps?.style) ?? {};
        const own = hex(style.backgroundColor);
        if (own) nextBg = over(own, under);
        if (typeof style.opacity === 'number') nextOpacity *= style.opacity;
        hosts.push({fiber: f, bg: nextBg, opacity: nextOpacity, parent});
        nextParent = hosts.length - 1;
      }
      visit(f, nextBg, nextOpacity, nextParent);
    }
  };
  visit(root, bg, 1, -1);
  const scale = Dimensions.get('window').width / 1920;
  const out: LayoutElement[] = [];
  const {boxes: rects, scale: drawnScale} = drawnRects(hosts, await Promise.all(hosts.map((h) => measure(publicInstance(h.fiber)))));
  const isAncestor = (a: number, b: number): boolean => {
    for (let k = hosts[b]!.parent; k >= 0; k = hosts[k]!.parent) if (k === a) return true;
    return false;
  };
  const styleOf = (i: number): Record<string, any> => StyleSheet.flatten(hosts[i]!.fiber.memoizedProps?.style) ?? {};
  // A view is a candidate for being hidden when a later, unrelated view paints an opaque background over its whole box (a drawer
  // over the page). It is exported flagged `covered`; the driver confirms on the real screen (cmd=cover hides these covering
  // views, the screen is captured again, and a box whose pixels changed was covered) and drops the confirmed ones.
  coverViews = [];
  const covered = hosts.map((_, i) => {
    const r = rects[i];
    if (!r) return false;
    for (let j = i + 1; j < hosts.length; j++) {
      const c = rects[j];
      const bg = hex(styleOf(j).backgroundColor);
      if (!c || !bg || bg.length > 7 || hosts[j]!.opacity < 0.999 || isAncestor(i, j) || isAncestor(j, i)) continue;
      if (r[0] >= c[0] - 0.5 && r[1] >= c[1] - 0.5 && r[0] + r[2] <= c[0] + c[2] + 0.5 && r[1] + r[3] <= c[1] + c[3] + 0.5) {
        if (!coverViews.some((v) => v.fiber === hosts[j]!.fiber)) coverViews.push({fiber: hosts[j]!.fiber, opacity: typeof styleOf(j).opacity === 'number' ? (styleOf(j).opacity as number) : 1});
        return true;
      }
    }
    return false;
  });
  // A view is clipped away when it lies wholly outside the box of an ancestor that clips its children.
  const clippedAway = hosts.map((_, i) => {
    const r = rects[i];
    if (!r) return false;
    for (let k = hosts[i]!.parent; k >= 0; k = hosts[k]!.parent) {
      const c = rects[k];
      if (c && styleOf(k).overflow === 'hidden' && (r[0] >= c[0] + c[2] || r[0] + r[2] <= c[0] || r[1] >= c[1] + c[3] || r[1] + r[3] <= c[1])) return true;
    }
    return false;
  });
  hosts.forEach((h, i) => {
    const r = rects[i];
    if (!r || r[2] < 0.5 || r[3] < 0.5) return;
    if (r[0] > 1920 * scale || r[1] > 1080 * scale || r[0] + r[2] < 0 || r[1] + r[3] < 0) return;
    // Nothing is drawn at zero opacity (the web export drops it too).
    if (h.opacity <= 0.001 || clippedAway[i]) return;
    const emit = (element: LayoutElement): void => void out.push(covered[i] ? {...element, covered: true} : element);
    const f = h.fiber;
    const type = String(f.type);
    const props = f.memoizedProps ?? {};
    const style = StyleSheet.flatten(props.style) ?? {};
    const rect = {x: round2(r[0] / scale), y: round2(r[1] / scale), w: round2(r[2] / scale), h: round2(r[3] / scale)};
    // A radius larger than half the box is drawn as half the box.
    const radius = typeof style.borderRadius === 'number' ? round2(Math.min((style.borderRadius * drawnScale[i]!) / scale, rect.w / 2, rect.h / 2)) : 0;
    const base: Partial<LayoutElement> = {
      background: h.bg,
      ...(radius ? {radius} : {}),
      ...(h.opacity < 0.999 ? {opacity: round2(h.opacity)} : {}),
    };
    const role = props.accessibilityRole as string | undefined;
    const webRole = role === 'header' ? 'heading' : role === 'adjustable' ? 'slider' : role;
    const label = typeof props.accessibilityLabel === 'string' ? props.accessibilityLabel : undefined;
    const src = debug ? `${type} ${JSON.stringify({label, role})}` : undefined;
    if (type === 'RCTText') {
      const inst = publicInstance(f);
      const lines = textLines.get(inst);
      // No laid-out lines were reported (an unregistered Text): nothing is exported rather than a line made from the box.
      if (!lines || !lines.length) {
        if (debug) emit({...(base as LayoutElement), text: textOf(f), role: 'debug-no-lines', rect, color: null, fontSize: null, fontWeight: null, src});
        return;
      }
      // The app draws one real Text per line (T splits a wrapped run), so a Text with a single reported line is measured whole: the
      // view box is the measured line box and onTextLayout gives the glyph run's own x and width. A Text still holding several
      // lines has no per-line bounds to read and is not exported.
      if (lines.length !== 1) {
        if (debug) emit({...(base as LayoutElement), text: textOf(f), role: 'debug-multi-line', rect, color: null, fontSize: null, fontWeight: null, src});
        return;
      }
      const line = lines[0]!;
      const lineText = ((line as {text?: string}).text ?? '').replace(/\s+/g, ' ').trim();
      if (!lineText) return;
      const family = String(style.fontFamily ?? '');
      const m = /-w(\d+)$/.exec(family);
      // The renderer draws the transformed text; onTextLayout reports the source text.
      const transform = (value: string): string =>
        style.textTransform === 'uppercase'
          ? value.toUpperCase()
          : style.textTransform === 'lowercase'
            ? value.toLowerCase()
            : style.textTransform === 'capitalize'
              ? value.replace(/(^|\s)(\S)/g, (_m, space: string, letter: string) => `${space}${letter.toUpperCase()}`)
              : value;
      const k = drawnScale[i]!;
      emit({
        ...(base as LayoutElement),
        text: transform(lineText),
        role: webRole && webRole !== 'text' && webRole !== 'none' ? webRole : 'text',
        rect: {x: round2(rect.x + (line.x * k) / scale), y: rect.y, w: round2((line.width * k) / scale), h: rect.h},
        color: hex(style.color),
        fontSize: round2((style.fontSize ?? 0) / scale),
        fontWeight: m ? Number(m[1]) : 400,
        ...(debug ? {src: JSON.stringify({view: rect, lines, family})} : null),
      });
      return;
    }
    if (type === 'RCTImageView' || type === 'Image' || type === 'RNSVGSvgView') {
      emit({...(base as LayoutElement), text: label ?? '', role: webRole ?? 'image', rect, color: null, fontSize: null, fontWeight: null, src});
      return;
    }
    // A gradient view paints its box without a background colour.
    const painted = hex(style.backgroundColor) !== null || hasBorder(style) || /LinearGradient/.test(type);
    if (!role && !painted) {
      // Debug builds list the unexported views too (role `debug-view`), to see how the renderer placed a wrapper.
      if (level === '2') emit({...(base as LayoutElement), text: '', role: 'debug-view', rect, color: null, fontSize: null, fontWeight: null, src: `${type} ${JSON.stringify({l: style.left, t: style.top, w: style.width, h: style.height, m: [style.marginLeft, style.marginTop], tr: style.transform, pos: style.position})}`});
      return;
    }
    emit({
      ...(base as LayoutElement),
      text: role ? label ?? '' : '',
      role: webRole ?? 'container',
      rect,
      color: null,
      fontSize: null,
      fontWeight: null,
      src,
    });
  });
  return out;
}
