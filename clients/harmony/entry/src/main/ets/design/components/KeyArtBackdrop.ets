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
const WASH_RIGHT_ANGLE: number = 270;
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

function pct100(pct: number): number {
  return pct / 100;
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
            .width(tv(TvGeometry.keyArtWidthPx))
            .height(tv(TvGeometry.keyArtHeightPx))
            .objectFit(ImageFit.Cover)
            .grayscale(1)
            .contrast(resolvedThemeMode() === 'dark' ? CONTRAST_DARK : CONTRAST_LIGHT)
            .brightness(resolvedThemeMode() === 'dark' ? BRIGHTNESS_DARK : BRIGHTNESS_LIGHT)
            .opacity(resolvedThemeMode() === 'dark' ? OPACITY_DARK : OPACITY_LIGHT)
            .scale({ x: TvGeometry.keyArtScale, y: TvGeometry.keyArtScale })
            .draggable(false)
            .focusable(false)
          // Web's `mask-image` fade: clear until 72% of the art's width, then the surface colour.
          Row()
            .width(tv(TvGeometry.keyArtWidthPx))
            .height(tv(TvGeometry.keyArtHeightPx))
            .linearGradient({
              angle: HORIZONTAL_ANGLE,
              colors: [
                [toResourceColorWithAlpha(activeColors().surface, 0), 0],
                [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtMaskFadeStartPct)],
                [toResourceColorWithAlpha(activeColors().surface, 1), 1],
              ],
            })
        }
        .width(tv(TvGeometry.keyArtWidthPx))
        .height(tv(TvGeometry.keyArtHeightPx))
        .position({ x: 0, y: tv(TvGeometry.keyArtOffsetY) })
        .clip(true)

        Row()
          .width('100%')
          .height('100%')
          .linearGradient({
            angle: HORIZONTAL_ANGLE,
            colors: [
              [toResourceColor(activeColors().surface), 0],
              [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtScrimHorizontalFadePct)],
            ],
          })
        Row()
          .width('100%')
          .height('100%')
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

      Row()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: HORIZONTAL_ANGLE,
          colors: [
            [toResourceColorWithAlpha(activeColors().surface, pct100(TvGeometry.stageWashLeftOpacityPct)), 0],
            [toResourceColorWithAlpha(activeColors().surface, pct100(TvGeometry.stageWashLeftMidOpacityPct)), pct100(TvGeometry.stageWashLeftMidPct)],
            [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.stageWashLeftFadePct)],
          ],
        })
      Row()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: WASH_RIGHT_ANGLE,
          colors: [
            [toResourceColorWithAlpha(activeColors().surface, pct100(TvGeometry.stageWashRightOpacityPct)), 0],
            [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.stageWashRightFadePct)],
          ],
        })
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
