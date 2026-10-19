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
const BODY_GAP: number = 35;
// TV: the body's focus rings are drawn outside their rows; the drawer's side padding gives this much to the scroll box and takes it back from the header and the content.
const RING_ROOM: number = 4;
const KICKER_SIZE: number = 9.6;
const KICKER_LETTER_SPACING: number = 0.672;
const TITLE_SIZE: number = 38.4;
const TITLE_LETTER_SPACING: number = -2.112;
const CLOSE_SIZE: number = 48;
const CLOSE_GLYPH_SIZE: number = 26.88;
// Phone (web phone drawer): the full page width, 20 padding, a 24 px title, a 43 round close button.
const TOUCH_PADDING_H: number = 20;
const TOUCH_HEADER_TOP: number = 20.7;
const TOUCH_BODY_GAP: number = 29;
// Web phone: the kicker sits 7.3 above the title; the close button's 3 vp ring is outside it, 2.3 vp clear, and the button 1.4 higher.
const TOUCH_KICKER_GAP: number = 7.3;
const TOUCH_CLOSE_RING_OUTSET: number = 5.3;
const TOUCH_CLOSE_LIFT: number = -0.6; // static web ref: the button is 2 vp lower than the older ref
const TOUCH_TITLE_SIZE: number = 24;
const TOUCH_TITLE_LETTER_SPACING: number = -2.1; // web's title is 12% narrower than this font draws at -0.8
const TOUCH_BODY_RING_ROOM: number = 6;
const TOUCH_CLOSE_SIZE: number = 43;
const TOUCH_CLOSE_GLYPH_SIZE: number = 17;
const SHADOW_COLOR: string = 'rgba(40, 26, 24, 0.24)';

@Component
export struct Drawer {
  @Prop kicker: string = '';
  @Prop title: string = '';
  /** TV: draw the focused close button's ring (web opens most drawers with the close button focused). */
  @Prop closeRing: boolean = true;
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
        Column({ space: isTvMetrics() ? tv(6.5) : TOUCH_KICKER_GAP }) {
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
            .lineHeight(isTvMetrics() ? tv(57) : 0) // web: 1.5 line height, two-line titles keep a 57 px pitch
            .fontColor(toResourceColor(activeColors().ink))
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Stack() {
          Text('×').fontFamily(nunito(isTvMetrics() ? 700 : 500))
            .fontSize(isTvMetrics() ? tv(CLOSE_GLYPH_SIZE) : TOUCH_CLOSE_GLYPH_SIZE)
            .fontWeight(isTvMetrics() ? FontWeight.Bold : FontWeight.Medium)
            .fontColor(toResourceColor(activeColors().ink))
            .textAlign(TextAlign.Center)
            .width(isTvMetrics() ? tv(CLOSE_SIZE) : TOUCH_CLOSE_SIZE)
            .height(isTvMetrics() ? tv(CLOSE_SIZE) : TOUCH_CLOSE_SIZE)
            .borderRadius(isTvMetrics() ? tv(CLOSE_SIZE / 2) : TOUCH_CLOSE_SIZE / 2)
            .backgroundColor(toResourceColor(activeColors().surfaceSoft))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
            .focusable(true)
            .defaultFocus(true)
            .onClick(() => {
              this.onClose();
            })
          if (isTvMetrics() && this.closeRing) {
            // web opens the drawer with its close button focused (ring 5 px out, 3 px wide); the Previewer reports no focus
            Column()
              .width(tv(CLOSE_SIZE + 10))
              .height(tv(CLOSE_SIZE + 10))
              .borderRadius(tv(CLOSE_SIZE / 2 + 5))
              .border({ width: tv(3), color: toResourceColor(activeColors().ink) })
              .hitTestBehavior(HitTestMode.None)
          }
          if (!isTvMetrics() && this.closeRing) {
            // web opens the drawer with its close button focused: on the phone the ring is drawn from the state (the Previewer reports no focus)
            Column()
              .width(TOUCH_CLOSE_SIZE + TOUCH_CLOSE_RING_OUTSET * 2)
              .height(TOUCH_CLOSE_SIZE + TOUCH_CLOSE_RING_OUTSET * 2)
              .borderRadius(TOUCH_CLOSE_SIZE / 2 + TOUCH_CLOSE_RING_OUTSET)
              .border({ width: 3, color: toResourceColor(activeColors().ink) })
              .hitTestBehavior(HitTestMode.None)
          }
        }
        .width(isTvMetrics() ? tv(CLOSE_SIZE) : TOUCH_CLOSE_SIZE)
        .height(isTvMetrics() ? tv(CLOSE_SIZE) : TOUCH_CLOSE_SIZE)
        .margin({ top: isTvMetrics() ? 0 : -TOUCH_CLOSE_LIFT })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .padding({ left: isTvMetrics() ? tv(RING_ROOM) : 0, right: isTvMetrics() ? tv(RING_ROOM) : 0 })
      .margin({ top: isTvMetrics() ? tv(HEADER_TOP) : atLeast(TOUCH_HEADER_TOP, this.safeTop) })
      Scroll() {
        Column() {
          this.body()
        }
        .width('100%')
        .padding(isTvMetrics() ? tv(RING_ROOM) : 0)
        .alignItems(HorizontalAlign.Start)
      }
      .width(isTvMetrics() ? '100%' : `calc(100% + ${TOUCH_BODY_RING_ROOM * 2}vp)`)
      .layoutWeight(1)
      .align(Alignment.Top)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      // phone: room around the body inside the scroll's clip for a focus ring (padding in, the same margin out)
      .padding(isTvMetrics() ? {} : { left: TOUCH_BODY_RING_ROOM, right: TOUCH_BODY_RING_ROOM, top: TOUCH_BODY_RING_ROOM, bottom: TOUCH_BODY_RING_ROOM })
      .margin(isTvMetrics() ? { top: tv(BODY_GAP - RING_ROOM) } : { top: TOUCH_BODY_GAP - TOUCH_BODY_RING_ROOM, left: -TOUCH_BODY_RING_ROOM, right: -TOUCH_BODY_RING_ROOM })
    }
    .width(isTvMetrics() ? tv(DRAWER_WIDTH) : '100%')
    .height('100%')
    .padding({
      left: isTvMetrics() ? tv(PADDING_H - RING_ROOM) : atLeast(TOUCH_PADDING_H, this.safeLeft),
      right: isTvMetrics() ? tv(PADDING_H - RING_ROOM) : atLeast(TOUCH_PADDING_H, this.safeRight),
      bottom: isTvMetrics() ? 0 : 24 + this.safeBottom,
    })
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, isTvMetrics() ? DRAWER_BG_ALPHA : 1))
    .backdropBlur(DRAWER_BACKDROP_BLUR)
    .shadow({ radius: tv(90), offsetX: -tv(32), offsetY: 0, color: SHADOW_COLOR })
    .position({ x: '100%', y: 0 })
    .markAnchor({ x: '100%', y: 0 })
  }
}
