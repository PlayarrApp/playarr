/**
 * Layout exporter for the parity layout score (docs/parity/LAYOUT.md). Parity builds only (PLAYARR_PARITY_CONTROL=1).
 * A class component sits in the tree; its React fiber leads to the root, and the walk reads every host view, text and image with
 * its resolved style and window rect. `cmd=layout` logs the document in chunks the driver reassembles.
 */
import React from 'react';
import {sansWeight} from '../theme/fonts';
import {Dimensions, StyleSheet} from 'react-native';

export interface TextInfo {
  /** `heading` for the web's h1 to h3 text; `text` otherwise. */
  role?: string;
  /** Text views of one web element (a balanced title is one Text per line) share a group; the export merges them. */
  group?: string;
  /** The element's own corner radius on the web (a pill with a text-only box). */
  radius?: number;
  /** The web rect is the element's line box (lh), not the content area. */
  exact?: boolean;
  /** A deliberate vertical nudge of this run (CSS px), reported as the glyph run's offset. */
  dy?: number;
  /** The CSS line height the screen asked for. */
  lh?: number;
  /** The CSS size, requested weight and letter spacing the screen asked for (the font file is snapped to a static instance). */
  size: number;
  weight: number;
}

const textInfo = new WeakMap<object, TextInfo>();
const textLines = new WeakMap<object, Array<{x: number; y: number; width: number; height: number}>>();

/** Called by the `T` text component from its ref and onTextLayout. */
export function registerText(instance: object | null, info: TextInfo): void {
  if (instance) textInfo.set(instance, info);
}
export function registerLines(instance: object | null, lines: Array<{x: number; y: number; width: number; height: number}>): void {
  if (instance) textLines.set(instance, lines);
}

export class LayoutProbe extends React.Component {
  render(): null {
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

/** Walks the fiber tree from the root and returns the document's elements in tree order. */
export async function exportLayout(probe: LayoutProbe, bg: string, debug: boolean): Promise<LayoutElement[]> {
  let root: Fiber = probe.fiber();
  while (root.return) root = root.return;
  const hosts: Array<{fiber: Fiber; bg: string; opacity: number; path: string[]}> = [];
  const visit = (fiber: Fiber, under: string, opacity: number): void => {
    for (let f = fiber.child; f; f = f.sibling) {
      // A navigator keeps the screens under the focused one mounted: they are not on screen.
      const nav = f.memoizedProps?.navigation;
      if (f.tag !== 5 && f.memoizedProps?.route && nav && typeof nav.isFocused === 'function' && !nav.isFocused()) continue;
      if (f.tag === 5 && f.memoizedProps?.parityRole === 'skip') continue;
      let nextBg = under;
      let nextOpacity = opacity;
      if (f.tag === 5) {
        // Ancestor backgrounds composite as the web exporter does; the shell's rail and clock sit outside the page section there, on
        // the app shell's colour.
        if (f.memoizedProps?.nativeID === 'parity-shell') nextBg = bg;
        const style = StyleSheet.flatten(f.memoizedProps?.style) ?? {};
        const own = hex(style.backgroundColor);
        if (own && own !== '#f2f2f2' && own !== '#00000000') nextBg = over(own, under);
        if (typeof style.opacity === 'number') nextOpacity *= style.opacity;
        hosts.push({fiber: f, bg: nextBg, opacity: nextOpacity, path: []});
      }
      visit(f, nextBg, nextOpacity);
    }
  };
  visit(root, bg, 1);
  const scale = Dimensions.get('window').width / 1920;
  const out: LayoutElement[] = [];
  const rects = await Promise.all(hosts.map((h) => measure(publicInstance(h.fiber))));
  hosts.forEach((h, i) => {
    const r = rects[i];
    if (!r || r[2] < 0.5 || r[3] < 0.5) return;
    if (r[0] > 1920 * scale || r[1] > 1080 * scale || r[0] + r[2] < 0 || r[1] + r[3] < 0) return;
    const f = h.fiber;
    const type = String(f.type);
    const props = f.memoizedProps ?? {};
    const style = StyleSheet.flatten(props.style) ?? {};
    const rect = {x: round2(r[0] / scale), y: round2(r[1] / scale), w: round2(r[2] / scale), h: round2(r[3] / scale)};
    const radius = typeof style.borderRadius === 'number' ? round2(style.borderRadius / scale) : 0;
    const base: Partial<LayoutElement> = {
      background: h.bg,
      ...(radius ? {radius} : {}),
      ...(h.opacity < 0.999 ? {opacity: round2(h.opacity)} : {}),
    };
    if (props.parityRole) {
      if (props.parityRole === 'skip' || props.parityRole === 'none') return;
      const pt = props.parityText as {size: number; weight: number; color: string} | undefined;
      out.push({...(base as LayoutElement), ...(typeof props.parityRadius === 'number' ? {radius: props.parityRadius} : null), text: String(props.parityLabel ?? ''), role: String(props.parityRole), rect, color: pt?.color ?? null, fontSize: pt?.size ?? null, fontWeight: pt?.weight ?? null});
      return;
    }
    const src = debug ? `${type} ${JSON.stringify({label: props.accessibilityLabel, role: props.accessibilityRole, op: style.opacity, disp: (style as any).display, pos: style.position, ev: props.pointerEvents, hid: props.importantForAccessibility ?? props['aria-hidden']})}` : undefined;
    if (type === 'RCTText') {
      const inst = publicInstance(f);
      const info = textInfo.get(inst) ?? (props.parityFont as TextInfo | undefined);
      const lines = textLines.get(inst);
      const text = textOf(f);
      if (!text) return;
      // One export entry per laid-out line, from the native line boxes: x and width are the renderer's own line extents, and the glyph
      // run is the shipped font's ascent plus descent (Nunito Sans hhea: 1.011 and 0.353 em, each rounded) centred in the native line
      // box (Vega draws the glyphs centred in `lineHeight`). The font weight is the static font file the app actually loads.
      const size = info?.size ?? round2((style.fontSize ?? 0) / scale);
      const lh = info?.lh ?? (style.lineHeight ? style.lineHeight / scale : 1.364 * size);
      const runH = Math.round(1.011 * size) + Math.round(0.353 * size);
      const upper = style.textTransform === 'uppercase';
      const weight = sansWeight(info?.weight ?? 400);
      const native = lines && lines.length ? lines : [{x: 0, y: 0, width: rect.w * scale, height: lh * scale, text}];
      native.forEach((line, index) => {
        const lineText = ((line as {text?: string}).text ?? (native.length === 1 ? text : '')).replace(/\s+/g, ' ').trim();
        if (!lineText) return;
        const lineH = line.height / scale;
        const element: LayoutElement = {
          ...(base as LayoutElement),
          text: upper ? lineText.toUpperCase() : lineText,
          role: info?.role ?? 'text',
          ...(info?.radius ? {radius: info.radius} : null),
          rect: {
            x: round2(rect.x + line.x / scale),
            y: round2(info?.exact ? rect.y + (rect.h - lh) / 2 : rect.y + line.y / scale + (lineH - runH) / 2),
            w: round2(line.width / scale),
            h: info?.exact ? lh : runH,
          },
          color: hex(style.color),
          fontSize: round2(size),
          fontWeight: weight,
          ...(debug && index === 0 ? {src: JSON.stringify({view: rect, size, lines, lh, top: style.top})} : null),
        };
        out.push(element);
      });
      return;
    }
    if (debug && !['RCTView', 'RCTText', 'RCTImageView', 'RCTVirtualText'].includes(type)) out.push({text: type, role: 'system', rect, color: null, background: h.bg, fontSize: null, fontWeight: null, src: JSON.stringify(Object.keys(props))});
    if (type === 'RCTImageView' || type === 'Image' || type === 'RNSVGSvgView') {
      out.push({...(base as LayoutElement), text: '', role: 'image', rect, color: null, fontSize: null, fontWeight: null, src});
      return;
    }
    // Full-screen layers are exported only where a screen marks them (the app root, the stage and its wash).
    if (rect.w >= 1919 && rect.h >= 1079 && !props.accessibilityRole && !props.focusable) return;
    const role = props.accessibilityRole;
    const pressable = typeof props.onClick === 'function' || props.focusable === true || role === 'button' || role === 'link' || role === 'tab';
    const painted = hex(style.backgroundColor) !== null || (style.borderWidth ?? 0) > 0;
    if (!pressable && !painted) return;
    out.push({
      ...(base as LayoutElement),
      text: pressable ? String(props.accessibilityLabel ?? '') : '',
      role: pressable ? (role === 'link' || role === 'tab' ? role : 'button') : 'container',
      rect,
      color: null,
      fontSize: null,
      fontWeight: null,
      src,
    });
  });
  return out;
}
