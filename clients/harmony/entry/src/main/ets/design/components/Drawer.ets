/**
 * The one right-side panel (web `.drawer` / `.tv-filter-drawer`): full height from the first frame, 360 wide
 * at the right edge, a kicker and title, a round close button and a body slot. Every side panel (Filters,
 * long-press actions, downloads) uses this. It overlays the page; the page is never rebuilt behind it.
 */

import { atLeast } from '../../core/SafeInsets';
import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv } from '../Metrics';

const DRAWER_WIDTH: number = 360;
const DRAWER_BG_ALPHA: number = 0.94;
const DRAWER_BACKDROP_BLUR: number = 38;
const PADDING_H: number = 46;
const HEADER_TOP: number = 54;
// Web body starts at y=163: 34 below the 75 high header block.
const BODY_GAP: number = 34;
const KICKER_SIZE: number = 9.6;
const KICKER_LETTER_SPACING: number = 0.672;
const TITLE_SIZE: number = 38.4;
const TITLE_LETTER_SPACING: number = -2.112;
const CLOSE_SIZE: number = 48;
const CLOSE_GLYPH_SIZE: number = 26.88;
// Phone (web phone drawer): the full page width, 20 padding, a 24 px title, a 43 round close button.
const TOUCH_PADDING_H: number = 20;
const TOUCH_HEADER_TOP: number = 24;
const TOUCH_BODY_GAP: number = 24;
const TOUCH_TITLE_SIZE: number = 24;
const TOUCH_TITLE_LETTER_SPACING: number = -0.8;
const TOUCH_CLOSE_SIZE: number = 43;
const TOUCH_CLOSE_GLYPH_SIZE: number = 20;
const SHADOW_COLOR: string = 'rgba(40, 26, 24, 0.24)';

@Component
export struct Drawer {
  @Prop kicker: string = '';
  @Prop title: string = '';
  onClose: () => void = () => {};

  @Builder
  private emptyBody(): void {}

  @BuilderParam body: () => void = this.emptyBody;

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;
  @StorageProp('safeTop') private safeTop: number = 0;
  @StorageProp('safeBottom') private safeBottom: number = 0;
  @StorageProp('safeLeft') private safeLeft: number = 0;
  @StorageProp('safeRight') private safeRight: number = 0;

  build() {
    Column() {
      Row() {
        Column({ space: tv(4) }) {
          Text(this.kicker).fontFamily(nunito(700))
            .fontSize(isTvMetrics() ? tv(KICKER_SIZE) : 7.2)
            .fontWeight(FontWeight.Bold)
            .letterSpacing(tv(KICKER_LETTER_SPACING))
            .textCase(TextCase.UpperCase)
            .fontColor(toResourceColor(activeColors().inkSoft))
          Text(this.title).fontFamily(nunito(500))
            .fontSize(isTvMetrics() ? tv(TITLE_SIZE) : TOUCH_TITLE_SIZE)
            .fontWeight(FontWeight.Medium)
            .letterSpacing(isTvMetrics() ? tv(TITLE_LETTER_SPACING) : TOUCH_TITLE_LETTER_SPACING)
            .fontColor(toResourceColor(activeColors().ink))
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text('×').fontFamily(nunito(700))
          .fontSize(isTvMetrics() ? tv(CLOSE_GLYPH_SIZE) : TOUCH_CLOSE_GLYPH_SIZE)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .textAlign(TextAlign.Center)
          .width(isTvMetrics() ? tv(CLOSE_SIZE) : TOUCH_CLOSE_SIZE)
          .height(isTvMetrics() ? tv(CLOSE_SIZE) : TOUCH_CLOSE_SIZE)
          .borderRadius(isTvMetrics() ? tv(CLOSE_SIZE / 2) : TOUCH_CLOSE_SIZE / 2)
          .backgroundColor(toResourceColor(activeColors().surfaceSoft))
          // web opens the drawer with its close button focused: on the phone it carries the focus ring (the Previewer reports no focus)
          .border(isTvMetrics() ? { width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) } : { width: 3, color: toResourceColor(activeColors().ink) })
          .focusable(true)
          .defaultFocus(true)
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ top: isTvMetrics() ? tv(HEADER_TOP) : atLeast(TOUCH_HEADER_TOP, this.safeTop) })
      Scroll() {
        Column() {
          this.body()
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .layoutWeight(1)
      .align(Alignment.Top)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      .margin({ top: isTvMetrics() ? tv(BODY_GAP) : TOUCH_BODY_GAP })
    }
    .width(isTvMetrics() ? tv(DRAWER_WIDTH) : '100%')
    .height('100%')
    .padding({
      left: isTvMetrics() ? tv(PADDING_H) : atLeast(TOUCH_PADDING_H, this.safeLeft),
      right: isTvMetrics() ? tv(PADDING_H) : atLeast(TOUCH_PADDING_H, this.safeRight),
      bottom: isTvMetrics() ? 0 : 24 + this.safeBottom,
    })
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, DRAWER_BG_ALPHA))
    .backdropBlur(DRAWER_BACKDROP_BLUR)
    .shadow({ radius: tv(90), offsetX: -tv(32), offsetY: 0, color: SHADOW_COLOR })
    .position({ x: '100%', y: 0 })
    .markAnchor({ x: '100%', y: 0 })
  }
}
