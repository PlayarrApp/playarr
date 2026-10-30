/**
 * Building blocks for the web-parity screens. Every measurement is the web TV layout's CSS pixel at 1920x1080, scaled by
 * `u()` so a panel of another resolution keeps the proportions. Text always goes through `T`, which picks the static
 * Nunito Sans instance for the weight (Vega ignores `fontWeight` for variable fonts).
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View, type NativeSyntheticEvent, type StyleProp, type TextLayoutEventData, type TextStyle, type ViewStyle} from 'react-native';
import {Dimensions} from 'react-native';
import {contentHeight, textRun} from '../theme/fonts';
import {useTheme} from '../theme/ThemeProvider';
import {PARITY_CONTROL} from '../debug/parityControl';
import {registerLines} from '../debug/layoutExport';

/** One web CSS pixel in device pixels. */
export function u(value: number): number {
  const scale = Dimensions.get('window').width / 1920;
  return value * scale;
}

/** One web CSS pixel in device pixels without snapping to the pixel grid: font sizes, letter spacing and line heights stay fractional. */
export function uf(value: number): number {
  return value * (Dimensions.get('window').width / 1920);
}

export interface BoxProps {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  bg?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

/** An absolutely positioned box in web pixels. */
export function Box({x = 0, y = 0, w, h, r, bg, style, children, pointerEvents}: BoxProps): React.ReactElement {
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        {
          position: 'absolute',
          left: u(x),
          top: u(y),
          width: w === undefined ? undefined : u(w),
          height: h === undefined ? undefined : u(h),
          borderRadius: r === undefined ? undefined : u(r),
          backgroundColor: bg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface TProps {
  /** CSS font size in px. */
  size: number;
  /** CSS font weight. */
  weight?: number;
  /** Letter spacing in px. */
  ls?: number;
  /** Line height in px. */
  lh?: number;
  /** A vertical nudge in web px, for glyphs the device font places differently from the web's. */
  dy?: number;
  color: string;
  upper?: boolean;
  mono?: boolean;
  lines?: number;
  /** Parity layout export only: the web element is a heading (h1 to h3). */
  heading?: boolean;
  /** Parity layout export only: the web element is a generic box with its own text (a div), not a span. */
  generic?: boolean;
  /** Parity layout export only: Text views with the same group are one web element. */
  group?: string;
  style?: StyleProp<TextStyle>;
  onTextLayout?: (event: NativeSyntheticEvent<TextLayoutEventData>) => void;
  children?: React.ReactNode;
}

/**
 * Where a browser puts the glyphs inside a line box: the extra line height splits evenly above and below the font's content area.
 * Vega draws the first line's glyphs from the top of the view, so a run taller than its content area is moved down by that
 * half-leading. A single line is instead given a view exactly as tall as its content area, with the half-leading as margins
 * above and below: the view box is then the glyph run. A run with a line height under its content area (squashed) always
 * takes that form, because Vega does not centre such a run in its box.
 */
export function T({size, weight = 400, ls, lh, dy = 0, color, upper, mono, lines, heading, generic, group, style, onTextLayout, children}: TProps): React.ReactElement {
  const content = contentHeight(size, mono);
  const single = lh !== undefined && (lines === 1 || lh < content);
  const run = textRun(uf(size), weight, {letterSpacing: ls === undefined ? undefined : uf(ls), lineHeight: lh === undefined ? undefined : uf(single ? content : lh), mono});
  const lead = lh === undefined ? 0 : (lh - content) / 2;
  // Parity builds record the laid-out lines of every run for the layout exporter. A run that wraps is then drawn as one real Text
  // per line (the renderer reports one box per Text, not per wrapped line), so every line's own bounds are measured. The last
  // line keeps the rest of the source, so a run that was cut short with an ellipsis is still cut short.
  const node = React.useRef<object | null>(null);
  const [pieces, setPieces] = useState<string[] | null>(null);
  React.useEffect(() => setPieces(null), [children]);
  const parity = PARITY_CONTROL
    ? {
        ref: (instance: object | null) => {
          node.current = instance;
        },
        onTextLayout: (event: NativeSyntheticEvent<TextLayoutEventData>) => {
          registerLines(node.current, event.nativeEvent.lines);
          onTextLayout?.(event);
          const found = event.nativeEvent.lines;
          if (lines !== 1 && typeof children === 'string' && found.length > 1 && !pieces) {
            const out: string[] = [];
            let at = 0;
            found.forEach((line, index) => {
              if (index === found.length - 1) {
                out.push(children.slice(at).trim());
                return;
              }
              const text = (line as {text?: string}).text ?? '';
              const hit = text ? children.indexOf(text.trim(), at) : -1;
              if (hit < 0) return;
              out.push(text.trim());
              at = hit + text.trim().length;
            });
            if (out.length === found.length) setPieces(out);
          }
        },
      }
    : {onTextLayout};
  if (pieces) {
    return (
      <>
        {pieces.map((piece, index) => (
          <T key={index} size={size} weight={weight} ls={ls} lh={lh} dy={dy} color={color} upper={upper} mono={mono} lines={1} heading={heading} generic={generic} group={group} style={style}>
            {piece}
          </T>
        ))}
      </>
    );
  }
  return (
    <Text
      numberOfLines={lines}
      {...(heading ? {accessibilityRole: 'header' as const} : null)}
      {...(generic ? {accessibilityRole: 'none' as const} : null)}
      {...parity}
      allowFontScaling={false}
      style={[run, {color, includeFontPadding: false, position: 'relative', top: u((single ? 0 : Math.max(lead, 0)) + dy), ...(single ? {marginTop: uf(lead), marginBottom: uf(lead)} : null), left: ls && ls < 0 && size >= 30 ? uf(-ls / 2) : 0}, upper ? {textTransform: 'uppercase'} : null, style]}
    >
      {children}
    </Text>
  );
}

export function Fill({style, children}: {style?: StyleProp<ViewStyle>; children?: React.ReactNode}): React.ReactElement {
  return <View style={[StyleSheet.absoluteFill, style]}>{children}</View>;
}

export function useColours(): ReturnType<typeof useTheme> {
  return useTheme();
}

/**
 * Text that wraps the way Chrome's CSS `text-wrap: balance` does (the web balances its big titles). Vega has no balancing and
 * no text-measuring API, so each word is measured in a hidden Text, then the break set is chosen as Chrome does (rule fitted on
 * 400 random titles, 97% match; Android TV's WebHeroTitle): keep the greedy line count, take the break set with that many
 * lines and the least sum of squared line widths, and add a penalty when the last line is a single word ("2 Fast 2 Furious"
 * breaks as "2 Fast / 2 Furious"). Breaks fall after spaces and hyphens.
 */
export function titleTokens(source: string): string[] {
  return source.match(/[^\s-]*(?:-+\s*|\s+)|[^\s-]+$/g) ?? [];
}

const ORPHAN_PENALTY = 5000;

/** Line ends (exclusive token indices) for tokens of the given trimmed widths in a box; null when the title fits on one line. */
export function balanceLines(tokens: readonly string[], widths: readonly number[], space: number, box: number): number[] | null {
  const n = tokens.length;
  const lineWidth = (from: number, to: number): number => {
    let w = 0;
    for (let k = from; k < to; k += 1) w += widths[k] + (k < to - 1 && /\s$/.test(tokens[k]) ? space : 0);
    return w;
  };
  let lineCount = 1;
  for (let from = 0, to = 1; to < n; to += 1) {
    if (lineWidth(from, to + 1) > box && to > from) {
      lineCount += 1;
      from = to;
    }
  }
  if (lineCount < 2) return null;
  const memo = new Map<number, {cost: number; next: number} | null>();
  const solve = (from: number, left: number): {cost: number; next: number} | null => {
    const key = from * 100 + left;
    if (memo.has(key)) return memo.get(key) ?? null;
    let pick: {cost: number; next: number} | null = null;
    if (from === n) pick = left === 0 ? {cost: 0, next: n} : null;
    else if (left > 0) {
      for (let to = from + 1; to <= n; to += 1) {
        const w = lineWidth(from, to);
        if (w > box && to > from + 1) break;
        const rest = solve(to, left - 1);
        if (!rest) continue;
        const orphan = to === n && !tokens.slice(from, to).join('').trim().includes(' ') ? ORPHAN_PENALTY : 0;
        const cost = w * w + rest.cost + orphan;
        if (!pick || cost < pick.cost) pick = {cost, next: to};
      }
    }
    memo.set(key, pick);
    return pick;
  };
  if (!solve(0, lineCount)) return null;
  const ends: number[] = [];
  for (let at = 0, left = lineCount; at < n && left > 0; left -= 1) {
    at = solve(at, left)!.next;
    ends.push(at);
  }
  return ends;
}

export function BalancedT({width, children, heading = true, ...text}: Omit<TProps, 'onTextLayout'> & {width: number}): React.ReactElement {
  const group = React.useRef(`bt${Math.random().toString(36).slice(2)}`).current;
  const source = typeof children === 'string' ? children : '';
  const tokens = React.useMemo(() => titleTokens(source), [source]);
  // Probes: every trimmed token, then "a a" and "aa" (their difference is one space; Vega may trim a measured trailing space).
  const probes = React.useMemo(() => [...tokens.map((token) => token.trim()), 'a a', 'aa'], [tokens]);
  const [measured, setMeasured] = useState<Record<number, number>>({});
  const unit = Dimensions.get('window').width / 1920;
  const onProbe = (index: number) => (event: NativeSyntheticEvent<TextLayoutEventData>): void => {
    const w = (event.nativeEvent.lines[0]?.width ?? 0) / unit;
    setMeasured((current) => (current[index] === w ? current : {...current, [index]: w}));
  };
  const ready = tokens.length > 1 && probes.every((_, index) => measured[index] !== undefined);
  const ends = ready ? balanceLines(tokens, tokens.map((_, index) => measured[index]), measured[probes.length - 2] - measured[probes.length - 1], width) : null;
  if (ends) {
    let from = 0;
    return (
      <View>
        {ends.map((to) => {
          const line = tokens.slice(from, to).join('').trim();
          from = to;
          return (
            <T key={from} heading={heading} {...text} group={group} lines={1} style={[text.style, {width: u(width * 2)}]}>
              {line}
            </T>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{width: u(width)}}>
      <T heading={heading} {...text} group={group}>{children}</T>
      {tokens.length > 1 && !ready ? (
        <View pointerEvents="none" style={{position: 'absolute', opacity: 0, width: u(width * 4)}}>
          {probes.map((probe, index) => (
            <T key={index} {...text} lines={1} onTextLayout={onProbe(index)}>
              {probe}
            </T>
          ))}
        </View>
      ) : null}
    </View>
  );
}
