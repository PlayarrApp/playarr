/**
 * The web page backdrop (`.tv-key-art` with its `::after` scrims, then `.tv-stage-wash`) for pages that draw their own
 * layout (Detail): the same layers as `Stage`'s key art, in the same order and with the same `core/Tokens.ts` values,
 * without Stage's entry animation. Full-bleed and not hit-testable; place it first in the page's Stack.
 */
import { image } from '@kit.ImageKit';
import { activeColors, toResourceColor, toResourceColorWithAlpha, resolvedThemeMode } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { TvGeometry } from '../../core/Tokens';

const HORIZONTAL_ANGLE: number = 90;
const VERTICAL_ANGLE: number = 0;
const CONTRAST_DARK: number = 0.82;
const CONTRAST_LIGHT: number = 0.88;
const BRIGHTNESS_DARK: number = 0.6;
const BRIGHTNESS_LIGHT: number = 1.1;
const OPACITY_DARK: number = 0.72;
const OPACITY_LIGHT: number = 0.24;

/** Web `.tv-home-rails` / `.tv-library-grid-panel` frost: the colour stops that fade in from transparent at the panel's left edge (shared with Stage). */
export function railFrostColors(): Array<[string, number]> {
  return resolvedThemeMode() === 'dark' ?
    [['rgba(40, 35, 40, 0)', 0], ['rgba(40, 35, 40, 0.72)', 0.12], ['rgba(40, 35, 40, 0.9)', 0.34],
      ['rgba(40, 35, 40, 0.97)', 0.62], ['rgba(40, 35, 40, 1)', 1]] :
    [['rgba(240, 238, 239, 0)', 0], ['rgba(240, 238, 239, 0.68)', 0.12], ['rgba(240, 238, 239, 0.88)', 0.34],
      ['rgba(240, 238, 239, 0.96)', 0.62], ['rgba(240, 238, 239, 1)', 1]];
}

/** The same fade drawn by a box spanning the whole width (web's frost box is full width there): transparent up to `widthPct` from the right edge,
 * then the stops of railFrostColors() squeezed into the rest, so the pixels equal those of a box that is only `widthPct` wide. */
export function railFrostColorsFullWidth(widthPct: number): Array<[string, number]> {
  const start: number = (100 - widthPct) / 100;
  const stops: Array<[string, number]> = railFrostColors();
  const out: Array<[string, number]> = [[stops[0][0], 0]];
  for (const stop of stops) {
    out.push([stop[0], start + stop[1] * (1 - start)]);
  }
  return out;
}

function pct100(pct: number): number {
  return pct / 100;
}

/** Composite alpha of the layers that all paint the page's `surface` colour sideways over the key art and the page: the key-art mask (art only, inside
 * the art's own box), the horizontal scrim (art only), the left stage wash and, optionally, the right one. Layers of one colour composite order-free
 * (1 - the product of their transparencies), so one full-width gradient draws what four stacked boxes did, with a stop every 1/120 of the width
 * plus every layer's own corner, which keeps the piecewise-linear result within a fraction of an 8-bit step of the exact curve. */
export function backdropSideColors(withArt: boolean, withRightWash: boolean): Array<[string, number]> {
  const surface = activeColors().surface;
  const artEnd: number = TvGeometry.keyArtWidthPx / 1920;
  const maskStart: number = artEnd * TvGeometry.keyArtMaskFadeStartPct / 100;
  const seam: number = 0.0001;
  const alphaAt = (x: number): number => {
    let clear: number = 1 - lerpAlpha(x, [[0, pct100(TvGeometry.stageWashLeftOpacityPct)], [pct100(TvGeometry.stageWashLeftMidPct), pct100(TvGeometry.stageWashLeftMidOpacityPct)],
      [pct100(TvGeometry.stageWashLeftFadePct), 0]]);
    if (withRightWash) {
      clear *= 1 - lerpAlpha(1 - x, [[0, pct100(TvGeometry.stageWashRightOpacityPct)], [pct100(TvGeometry.stageWashRightFadePct), 0]]);
    }
    if (withArt) {
      clear *= 1 - lerpAlpha(x, [[0, 1], [pct100(TvGeometry.keyArtScrimHorizontalFadePct), 0]]);
      if (x <= artEnd) {
        clear *= 1 - lerpAlpha(x, [[maskStart, 0], [artEnd, 1]]);
      }
    }
    return 1 - clear;
  };
  const xs: number[] = [0, 1, pct100(TvGeometry.stageWashLeftMidPct), pct100(TvGeometry.stageWashLeftFadePct), 1 - pct100(TvGeometry.stageWashRightFadePct)];
  if (withArt) {
    xs.push(pct100(TvGeometry.keyArtScrimHorizontalFadePct), maskStart, artEnd, artEnd + seam);
  }
  for (let i = 1; i < 120; i++) {
    xs.push(i / 120);
  }
  xs.sort((a: number, b: number): number => a - b);
  const out: Array<[string, number]> = [];
  for (const x of xs) {
    out.push([toResourceColorWithAlpha(surface, Math.round(alphaAt(x) * 10000) / 10000), x]);
  }
  return out;
}

/** The value at `x` of a clamped piecewise-linear curve through `points` (x ascending); 0 before its first point. */
function lerpAlpha(x: number, points: number[][]): number {
  if (x < points[0][0]) {
    return 0;
  }
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const span: number = points[i][0] - points[i - 1][0];
      return span <= 0 ? points[i][1] : points[i - 1][1] + (points[i][1] - points[i - 1][1]) * (x - points[i - 1][0]) / span;
    }
  }
  return points[points.length - 1][1];
}

@Component
export struct KeyArtBackdrop {
  @Prop keyArt: image.PixelMap | undefined = undefined;
  /** Web's detail page sits on the same right-hand frost as the Library grid (65%). */
  @Prop railFrostWidthPct: number = 0;

  // Tracked only to re-render on a theme or TV-scale change (see Theme.ets and Metrics.ets).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    Stack() {
      if (this.keyArt !== undefined) {
        Stack() {
          Image(this.keyArt)
            .width(tv(TvGeometry.keyArtImageWidthPx))
            .height(tv(TvGeometry.keyArtHeightPx))
            .position({ x: tv(TvGeometry.keyArtImageLeft), y: tv(-TvGeometry.keyArtOffsetY) })
            .objectFit(ImageFit.Cover)
            .grayscale(1)
            .contrast(resolvedThemeMode() === 'dark' ? CONTRAST_DARK : CONTRAST_LIGHT)
            .brightness(resolvedThemeMode() === 'dark' ? BRIGHTNESS_DARK : BRIGHTNESS_LIGHT)
            .opacity(resolvedThemeMode() === 'dark' ? OPACITY_DARK : OPACITY_LIGHT)
            .scale({ x: TvGeometry.keyArtScale, y: TvGeometry.keyArtScale })
            .draggable(false)
            .focusable(false)
          // Web's vertical scrim over the art. Everything past the art's box is plain surface, which this colour cannot change, so the box
          // (a clipped child, not a full-page layer) holds it; the page-wide sideways layers are the one Row below.
          Row()
            .width('100%')
            .height(tv(1080))
            .position({ x: 0, y: tv(-TvGeometry.keyArtOffsetY) })
            .linearGradient({
              angle: VERTICAL_ANGLE,
              colors: [
                [toResourceColor(activeColors().surface), 0],
                [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtScrimVerticalFadeInPct)],
                [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtScrimVerticalFadeOutStartPct)],
                [toResourceColor(activeColors().surface), 1],
              ],
            })
        }
        .width(tv(TvGeometry.keyArtWidthPx))
        .height(tv(TvGeometry.keyArtHeightPx))
        .position({ x: 0, y: tv(TvGeometry.keyArtOffsetY) })
        .clip(true)
      }

      // Web's key-art mask, horizontal scrim and the two stage washes: one Row (see backdropSideColors).
      Row()
        .width('100%')
        .height('100%')
        .linearGradient({ angle: HORIZONTAL_ANGLE, colors: backdropSideColors(this.keyArt !== undefined, true) })
      if (this.railFrostWidthPct > 0) {
        Row()
          .width(`${this.railFrostWidthPct}%`)
          .height('100%')
          .position({ x: `${100 - this.railFrostWidthPct}%`, y: 0 })
          .linearGradient({ angle: HORIZONTAL_ANGLE, colors: railFrostColors() })
      }
    }
    .width('100%')
    .height('100%')
    .hitTestBehavior(HitTestMode.Transparent)
  }
}
