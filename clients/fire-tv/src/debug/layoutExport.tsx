/**
 * Layout exporter for the parity layout score (docs/parity/LAYOUT.md). Parity builds only (PLAYARR_PARITY_CONTROL=1).
 * A class component sits in the tree; its React fiber leads to the root, and the walk reads every host view, text and image with
 * its resolved style and window rect. `cmd=layout` logs the document in chunks the driver reassembles.
 */
import React from 'react';
import {Dimensions, StyleSheet, Text} from 'react-native';

const textLines = new WeakMap<object, Array<{x: number; y: number; width: number; height: number}>>();

export function registerLines(instance: object | null, lines: Array<{x: number; y: number; width: number; height: number}>): void {
  if (instance) textLines.set(instance, lines);
}

export interface FontExtent {
  ascender: number;
  descender: number;
}

/**
 * Hosts invisible probe Texts. The renderer reports the font's real ascender and descender (device px) for a Text without a line
 * height; the exporter asks for one per font file and size, so text bounds are measured and not computed from a metrics table.
 */
export class LayoutProbe extends React.Component<unknown, {wanted: string[]}> {
  state = {wanted: [] as string[]};
  private extents = new Map<string, FontExtent>();
  private waiting = new Map<string, Array<(e: FontExtent) => void>>();
  render(): React.ReactNode {
    return this.state.wanted.map((key) => {
      const [family, size] = key.split('|');
      return (
        <Text
          key={key}
          allowFontScaling={false}
          style={{position: 'absolute', left: -4000, top: 0, opacity: 0, fontFamily: family, fontSize: Number(size), includeFontPadding: false}}
          onTextLayout={(event) => {
            const line = event.nativeEvent.lines[0] as {ascender?: number; descender?: number} | undefined;
            if (!line || typeof line.ascender !== 'number' || typeof line.descender !== 'number') return;
            // RN reports the descender as a positive distance below the baseline on some renderers and negative on others.
            const extent = {ascender: Math.abs(line.ascender), descender: Math.abs(line.descender)};
            this.extents.set(key, extent);
            this.waiting.get(key)?.forEach((done) => done(extent));
            this.waiting.delete(key);
          }}
        >
          Hxg
        </Text>
      );
    });
  }
  fiber(): any {
    return (this as any)._reactInternals;
  }
  /** The renderer's ascender and descender of a font file at a size (device px). */
  extent(family: string, size: number): Promise<FontExtent | null> {
    const key = `${family}|${size}`;
    const known = this.extents.get(key);
    if (known) return Promise.resolve(known);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 15000);
      this.waiting.set(key, [...(this.waiting.get(key) ?? []), (e) => {
        clearTimeout(timer);
        resolve(e);
      }]);
      if (!this.state.wanted.includes(key)) this.setState((s) => ({wanted: [...s.wanted, key]}));
    });
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
  const extents = new Map<string, FontExtent | null>();
  const wanted = new Map<string, [string, number]>();
  for (const h of hosts) {
    if (String(h.fiber.type) !== 'RCTText') continue;
    const st = StyleSheet.flatten(h.fiber.memoizedProps?.style) ?? {};
    if (st.fontFamily && st.fontSize) wanted.set(`${st.fontFamily}|${st.fontSize}`, [String(st.fontFamily), st.fontSize]);
  }
  await Promise.all([...wanted].map(async ([key, [family, size]]) => extents.set(key, await probe.extent(family, size))));
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
      const text = textOf(f);
      if (!text) return;
      // One export entry per laid-out line, everything read from the renderer: the font file (family name) gives the weight, a probe
      // Text of that file and size gives the real ascender and descender (the glyph run's height), the style gives size and colour,
      // measureInWindow gives the view box and onTextLayout gives each line's x, width and height. Vega draws the first line's glyphs
      // from the top of the view (the app keeps every line height at or above the content area, checked against screenshot ink),
      // and each further line one laid-out line height lower.
      const family = String(style.fontFamily ?? '');
      const extent = extents.get(`${family}|${style.fontSize}`);
      const size = round2((style.fontSize ?? 0) / scale);
      const m = /-w(\d+)$/.exec(family);
      // Glyph runs sit on whole device pixels: the ascent and descent each count in whole pixels.
      // The glyph run's height: the probe's ascender and descender for this font file and size; where the probe could not lay out
      // (it never does while the player is up), each line's own reported ascender and descender.
      const runHeight = (line: unknown): number | null => {
        const own = line as {ascender?: number; descender?: number};
        if (extent) return Math.round(extent.ascender / scale) + Math.round(extent.descender / scale);
        return typeof own.ascender === 'number' && typeof own.descender === 'number' ? Math.round(Math.abs(own.ascender) / scale) + Math.round(Math.abs(own.descender) / scale) : null;
      };
      // The renderer draws the transformed text; onTextLayout reports the source text.
      const transform = (value: string): string =>
        style.textTransform === 'uppercase'
          ? value.toUpperCase()
          : style.textTransform === 'lowercase'
            ? value.toLowerCase()
            : style.textTransform === 'capitalize'
              ? value.replace(/(^|\s)(\S)/g, (_m, space: string, letter: string) => `${space}${letter.toUpperCase()}`)
              : value;
      const native = lines;
      // The view box is measured with the transforms of its ancestors, the line geometry of onTextLayout is not: the ratio of the
      // measured height to the laid-out line heights is the scale the text is drawn at (a card scaled on focus).
      let laidOut = 0;
      for (const l of native) laidOut += l.height;
      const k = laidOut > 0 && Math.abs(r[3] / laidOut - 1) > 0.01 && Math.abs(r[3] / laidOut - 1) < 0.25 ? r[3] / laidOut : 1;
      let above = 0;
      native.forEach((line, index) => {
        const lineTop = above;
        above += (line.height * k) / scale;
        const lineText = ((line as {text?: string}).text ?? '').replace(/\s+/g, ' ').trim();
        if (!lineText) return;
        const runH = runHeight(line);
        if (runH === null) return;
        emit({
          ...(base as LayoutElement),
          text: transform(lineText),
          role: webRole && webRole !== 'text' && webRole !== 'none' ? webRole : 'text',
          rect: {x: round2(rect.x + (line.x * k) / scale), y: round2(rect.y + lineTop), w: round2((line.width * k) / scale), h: round2(runH * k)},
          color: hex(style.color),
          fontSize: size,
          fontWeight: m ? Number(m[1]) : 400,
          ...(debug && index === 0 ? {src: JSON.stringify({view: rect, size, lines, top: style.top, probe: extent, family})} : null),
        });
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
