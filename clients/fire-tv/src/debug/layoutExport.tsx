/**
 * Layout exporter for the parity layout score (docs/parity/LAYOUT.md). Parity builds only (PLAYARR_PARITY_CONTROL=1).
 *
 * It reads the laid-out app and nothing else: a class component sits in the tree, its React fiber leads to the root, and the walk
 * reads every host view, text and image with its window rect (`measureInWindow`), its resolved style (colour, background, opacity,
 * radius, font file and size) and its accessibility props (`accessibilityRole`, `accessibilityLabel`). Text comes from the renderer's
 * own line layout (`onTextLayout`: x, width and height per line) and the font metrics the renderer reports for the font file the
 * Text uses (a probe Text without a line height reports the font's natural ascender and descender). Nothing is taken from the web:
 * no names, roles, rects or coefficients. It only translates units (device px to CSS px) and role names (React Native's `header`
 * is the schema's `heading`).
 */
import React from 'react';
import {Dimensions, StyleSheet, Text, View} from 'react-native';

export interface Line {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  ascender?: number;
  descender?: number;
  capHeight?: number;
  xHeight?: number;
}

const textLines = new WeakMap<object, Line[]>();

/** Called from a Text's ref and onTextLayout (`measured()` in layoutMarks). */
export function registerLines(instance: object | null, lines: Line[]): void {
  if (instance) textLines.set(instance, lines);
}

interface Natural {
  ascent: number;
  descent: number;
}

/**
 * Renders (off screen) one Text per font file and size without a line height, and reports the font metrics the renderer gives
 * it: with no line height the line's ascender and descender are the font's own ascent and descent.
 */
export class LayoutProbe extends React.Component<object, {fonts: Array<{family: string; size: number}>}> {
  state = {fonts: [] as Array<{family: string; size: number}>};
  private seen = new Map<string, Natural>();
  private waiting: Array<() => void> = [];

  fiber(): any {
    return (this as any)._reactInternals;
  }

  /** The natural metrics of each (family, size) in device px, measured by the renderer. */
  async natural(fonts: Array<{family: string; size: number}>): Promise<Map<string, Natural>> {
    const need = fonts.filter((f) => !this.seen.has(`${f.family}@${f.size}`));
    if (need.length) {
      this.setState({fonts: need});
      const t0 = Date.now();
      while (need.some((f) => !this.seen.has(`${f.family}@${f.size}`)) && Date.now() - t0 < 8000) await new Promise<void>((r) => setTimeout(r, 100));
    }
    return this.seen;
  }

  render(): React.ReactElement {
    return (
      <View nativeID="parity-probe" pointerEvents="none" style={{position: 'absolute', left: -6000, top: 0, opacity: 0}}>
        {this.state.fonts.map((f) => (
          <Text
            key={`${f.family}@${f.size}`}
            allowFontScaling={false}
            style={{fontFamily: f.family, fontWeight: 'normal', fontSize: f.size, includeFontPadding: false}}
            onTextLayout={(e) => {
              const line = e.nativeEvent.lines[0] as Line | undefined;
              if (line?.ascender !== undefined && line.descender !== undefined) this.seen.set(`${f.family}@${f.size}`, {ascent: line.ascender, descent: line.descender});
            }}
          >
            Hxg
          </Text>
        ))}
      </View>
    );
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

/** `top` painted over `under` (both #rrggbb or #rrggbbaa; `under` is opaque). */
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
  /** Debug only: the raw renderer numbers behind a text run. */
  src?: string;
}

/** The text a node displays (its descendants' strings), whitespace collapsed. */
function textOf(fiber: Fiber): string {
  const out: string[] = [];
  const walk = (f: Fiber | null): void => {
    for (let c = f?.child; c; c = c.sibling) {
      if (c.tag === 6) out.push(String(c.memoizedProps));
      else walk(c);
    }
  };
  walk(fiber);
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** React Native's role names to the schema's (the ARIA names the web uses). */
const ROLE: Record<string, string> = {header: 'heading', img: 'image', imagebutton: 'button', adjustable: 'slider', togglebutton: 'switch'};
const roleOf = (props: any): string | undefined => {
  const role = props.accessibilityRole ?? props.role;
  return role && role !== 'none' ? (ROLE[role] ?? role) : undefined;
};
const labelOf = (props: any): string | undefined => props.accessibilityLabel ?? props['aria-label'];

/** The font file a Text draws with names its weight (`NunitoSans-w640`, `JetBrainsMono-w400`); a system font has the style's weight. */
function weightOf(style: any): number {
  const m = /-w(\d+)$/.exec(String(style.fontFamily ?? ''));
  if (m) return Number(m[1]);
  const w = style.fontWeight;
  return w === 'bold' ? 700 : typeof w === 'number' ? w : Number(w) || 400;
}

/** Walks the fiber tree from the root and returns the document's elements in tree order. */
export async function exportLayout(probe: LayoutProbe, debug: boolean): Promise<LayoutElement[]> {
  let root: Fiber = probe.fiber();
  while (root.return) root = root.return;
  interface Host {
    fiber: Fiber;
    bg: string;
    under: string;
    opacity: number;
    clips: number[];
  }
  const hosts: Host[] = [];
  const visit = (fiber: Fiber, under: string, opacity: number, clips: number[]): void => {
    for (let f = fiber.child; f; f = f.sibling) {
      // A navigator keeps the screens under the focused one mounted: they are not on screen.
      const nav = f.memoizedProps?.navigation;
      if (f.tag !== 5 && f.memoizedProps?.route && nav && typeof nav.isFocused === 'function' && !nav.isFocused()) continue;
      let nextBg = under;
      let nextOpacity = opacity;
      let nextClips = clips;
      if (f.tag === 5) {
        if (f.memoizedProps?.nativeID === 'parity-probe') continue;
        const style = StyleSheet.flatten(f.memoizedProps?.style) ?? {};
        const own = hex(style.backgroundColor);
        if (own && own !== '#00000000') nextBg = over(own, under);
        if (typeof style.opacity === 'number') nextOpacity *= style.opacity;
        if (style.overflow === 'hidden' || style.overflow === 'scroll') nextClips = [...clips, hosts.length];
        hosts.push({fiber: f, bg: nextBg, under, opacity: nextOpacity, clips});
      }
      visit(f, nextBg, nextOpacity, nextClips);
    }
  };
  // The window colour behind everything is white, as the web's backdrop is.
  visit(root, '#ffffff', 1, []);
  const scale = Dimensions.get('window').width / 1920;
  const rects = await Promise.all(hosts.map((h) => measure(publicInstance(h.fiber))));

  // The renderer's font metrics for every font file and size in the document.
  const fonts = new Map<string, {family: string; size: number}>();
  hosts.forEach((h) => {
    if (String(h.fiber.type) !== 'RCTText') return;
    const style = StyleSheet.flatten(h.fiber.memoizedProps?.style) ?? {};
    if (style.fontFamily && style.fontSize) fonts.set(`${style.fontFamily}@${style.fontSize}`, {family: String(style.fontFamily), size: Number(style.fontSize)});
  });
  const natural = await probe.natural([...fonts.values()]);

  const out: LayoutElement[] = [];
  hosts.forEach((h, i) => {
    const r = rects[i];
    if (!r || r[2] < 0.5 || r[3] < 0.5) return;
    if (r[0] > 1920 * scale || r[1] > 1080 * scale || r[0] + r[2] < 0 || r[1] + r[3] < 0) return;
    // A box clipped away by an overflow ancestor is not on screen.
    for (const c of h.clips) {
      const a = rects[c];
      if (a && (r[0] >= a[0] + a[2] || r[0] + r[2] <= a[0] || r[1] >= a[1] + a[3] || r[1] + r[3] <= a[1])) return;
    }
    const f = h.fiber;
    const type = String(f.type);
    const props = f.memoizedProps ?? {};
    const style = StyleSheet.flatten(props.style) ?? {};
    const rect = {x: round2(r[0] / scale), y: round2(r[1] / scale), w: round2(r[2] / scale), h: round2(r[3] / scale)};
    const radius = typeof style.borderRadius === 'number' ? round2(style.borderRadius / scale) : 0;
    const base = {
      background: h.bg,
      ...(radius ? {radius} : {}),
      ...(h.opacity < 0.999 ? {opacity: round2(h.opacity)} : {}),
    };
    const role = roleOf(props);
    if (type === 'RCTText') {
      const inst = publicInstance(f);
      const lines = textLines.get(inst);
      const text = textOf(f);
      if (!text) return;
      const size = round2(Number(style.fontSize ?? 0) / scale);
      const nat = natural.get(`${style.fontFamily}@${style.fontSize}`);
      const upper = style.textTransform === 'uppercase';
      const native: Line[] = lines && lines.length ? lines : [{x: 0, y: 0, width: r[2], height: r[3], text}];
      const runs = native.flatMap((line) => {
        const lineText = (line.text ?? (native.length === 1 ? text : '')).replace(/\s+/g, ' ').trim();
        if (!lineText) return [];
        // The glyph run is the font's ascent plus descent (each rounded, as the browser's line boxes do) around the baseline the
        // renderer drew the line on; x and width are the renderer's own extents for the line.
        const ascent = nat ? Math.round(nat.ascent / scale) : 0;
        const descent = nat ? Math.round(nat.descent / scale) : 0;
        const baseline = baselineOf(r[1] / scale, line, nat, scale, style);
        return [{text: upper ? lineText.toUpperCase() : lineText, x: r[0] / scale + line.x / scale, w: line.width / scale, y: baseline - ascent, h: ascent + descent, line}];
      });
      const make = (text: string, x: number, y: number, w: number, hgt: number, src?: unknown): LayoutElement => ({
        ...(base as LayoutElement),
        text,
        role: role ?? 'text',
        rect: {x: round2(x), y: round2(y), w: round2(w), h: round2(hgt)},
        color: hex(style.color),
        fontSize: size,
        fontWeight: weightOf(style),
        ...(debug ? {src: JSON.stringify(src)} : null),
      });
      const raw = {view: r, size: style.fontSize, lh: style.lineHeight, top: style.top, nat, lines: native};
      runs.forEach((run, index) => out.push(make(run.text, run.x, run.y, run.w, run.h, index === 0 ? raw : undefined)));
      if (runs.length > 1) {
        // One entry for the whole element, as a browser reports a wrapped text node: the union of its line runs.
        const x0 = Math.min(...runs.map((x) => x.x));
        const y0 = Math.min(...runs.map((x) => x.y));
        const x1 = Math.max(...runs.map((x) => x.x + x.w));
        const y1 = Math.max(...runs.map((x) => x.y + x.h));
        out.push(make(runs.map((x) => x.text).join(' '), x0, y0, x1 - x0, y1 - y0));
      }
      return;
    }
    if (type === 'RCTImageView' || type === 'Image' || type === 'RNSVGSvgView') {
      out.push({...(base as LayoutElement), text: labelOf(props) ?? '', role: role ?? 'image', rect, color: null, fontSize: null, fontWeight: null});
      return;
    }
    const pressable = typeof props.onClick === 'function' || typeof props.onPress === 'function' || props.focusable === true || role === 'button' || role === 'link' || role === 'tab';
    const painted = hex(style.backgroundColor) !== null || (style.borderWidth ?? 0) > 0;
    if (!pressable && !painted && !role) return;
    // A fill identical to the colour already behind it is not a fill (the web exporter's rule).
    if (!pressable && !role && h.bg === h.under && (style.borderWidth ?? 0) <= 0) return;
    out.push({
      ...(base as LayoutElement),
      text: pressable || role ? (labelOf(props) ?? textOf(f)) : '',
      role: role ?? (pressable ? 'button' : 'container'),
      rect,
      color: null,
      fontSize: null,
      fontWeight: null,
    });
  });
  return out;
}

/**
 * Where the renderer drew a line's baseline, in CSS px from the top of the window: calibrated against the device's pixels
 * (docs/parity/DEVICES.md, "Fire TV (Vega OS): how the run works").
 */
function baselineOf(viewTop: number, line: Line, nat: Natural | undefined, scale: number, style: any): number {
  const a = nat ? nat.ascent / scale : 0;
  return viewTop + a;
}
