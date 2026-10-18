/**
 * The TV library A-Z rail (web `.tv-alphabet`): a natively scrollable column of 44 px round letter
 * buttons on the right edge; the current letter is filled with ink. Geometry from the live web TV DOM.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv } from '../Metrics';
import { BRAND_PINK } from '../../core/Tokens';

const RAIL_LEFT: number = 1852;
const RAIL_TOP: number = 270;
const RAIL_WIDTH: number = 56;
const RAIL_HEIGHT: number = 810;
const RAIL_PADDING_TOP: number = 8;
const BUTTON_SIZE: number = 44;
const LETTER_SIZE: number = 9.216;
const TV_DISC: number = 24;
const RING_GAP: number = 2;
const RING_WIDTH: number = 2;
// Phone (web `.tv-directory .tv-alphabet` under 760 px): fixed on the right edge, 52 wide, from 88 below the top to 82 above the bottom
// (clear of the floating nav bar); the letters share that height, each 44 wide, 8.96 px bold.
const TOUCH_RAIL_WIDTH: number = 52;
const TOUCH_RAIL_TOP: number = 88;
const TOUCH_RAIL_BOTTOM: number = 82;
const TOUCH_LETTER_WIDTH: number = 44;
const TOUCH_LETTER_SIZE: number = 8.96;
const TOUCH_DISC: number = 22;

@Component
export struct AlphabetRail {
  /** Phone: the right safe-area inset; the rail's right edge sits at it. */
  @Prop rightInset: number = 0;
  @Prop letters: string[] = [];
  @Prop activeLetter: string = '';
  /** Called with the chosen letter. Plain callback field (functions are not observable state). */
  onJump: (letter: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @Builder
  private touchRail(): void {
    Column() {
      ForEach(this.letters, (letter: string) => {
        // a 44 vp target around web's 22 vp letter disc
        Column() {
          Text(letter).fontFamily(nunito(700))
            .width(TOUCH_DISC)
            .height(TOUCH_DISC)
            .textAlign(TextAlign.Center)
            .fontSize(TOUCH_LETTER_SIZE)
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(letter === this.activeLetter ? activeColors().bg : activeColors().inkMuted))
            .backgroundColor(letter === this.activeLetter ? toResourceColorWithAlpha(activeColors().ink, 0.78) : Color.Transparent)
            .borderRadius(TOUCH_DISC / 2)
        }
        .width(TOUCH_LETTER_WIDTH)
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          this.onJump(letter);
        })
      }, (letter: string): string => letter)
    }
    .width(TOUCH_RAIL_WIDTH)
    .height(`calc(100% - ${TOUCH_RAIL_TOP + TOUCH_RAIL_BOTTOM}vp)`)
    .alignItems(HorizontalAlign.Center)
    .position({ x: '100%', y: TOUCH_RAIL_TOP })
    .markAnchor({ x: TOUCH_RAIL_WIDTH + this.rightInset, y: 0 })
  }

  build() {
    if (!isTvMetrics()) {
      this.touchRail()
    } else {
      this.tvRail()
    }
  }

  /** Web's current letter wears the page focus ring: a brand ring a 2 px gap outside the 24 px disc. */
  @Builder
  private tvLetter(letter: string): void {
    Column() {
      Text(letter).fontFamily(nunito(400))
        .width(tv(letter === this.activeLetter ? TV_DISC : BUTTON_SIZE))
        .height(tv(letter === this.activeLetter ? TV_DISC : BUTTON_SIZE))
        .textAlign(TextAlign.Center)
        .fontSize(tv(LETTER_SIZE))
        .fontColor(toResourceColor(letter === this.activeLetter ? activeColors().bg : activeColors().inkSoft))
        .backgroundColor(letter === this.activeLetter ? toResourceColorWithAlpha(activeColors().ink, 0.78) : Color.Transparent)
        .borderRadius(tv(TV_DISC / 2))
        .translate({ y: -tv(1.5) })
    }
    .width(letter === this.activeLetter ? tv(TV_DISC + 2 * RING_GAP + 2 * RING_WIDTH) : tv(BUTTON_SIZE))
    .height(letter === this.activeLetter ? tv(TV_DISC + 2 * RING_GAP + 2 * RING_WIDTH) : tv(BUTTON_SIZE))
    .justifyContent(FlexAlign.Center)
    .borderRadius(tv((TV_DISC + 2 * RING_GAP + 2 * RING_WIDTH) / 2))
    .border({ width: letter === this.activeLetter ? tv(RING_WIDTH) : 0, color: toResourceColor(BRAND_PINK) })
  }

  @Builder
  private tvRail(): void {
    Scroll() {
      Column() {
        ForEach(this.letters, (letter: string) => {
          Column() {
            // Web's current letter is a 24 px disc in ink-soft (not the 44 px hit area), the letters sit ~1.5 px high.
            this.tvLetter(letter)
          }
          .width(tv(BUTTON_SIZE))
          .height(tv(BUTTON_SIZE))
          .justifyContent(FlexAlign.Center)
          .focusable(true)
          .onClick(() => {
            this.onJump(letter);
          })
        }, (letter: string): string => letter)
      }
      .padding({ top: tv(RAIL_PADDING_TOP) })
      .width('100%')
    }
    .width(tv(RAIL_WIDTH))
    .height(tv(RAIL_HEIGHT))
    .align(Alignment.Top)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .position({ x: tv(RAIL_LEFT), y: tv(RAIL_TOP) })
  }
}
