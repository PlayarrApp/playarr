/**
 * The TV library A-Z rail (web `.tv-alphabet`): a natively scrollable column of 44 px round letter
 * buttons on the right edge; the current letter is filled with ink. Geometry from the live web TV DOM.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv } from '../Metrics';

const RAIL_LEFT: number = 1852;
const RAIL_TOP: number = 270;
const RAIL_WIDTH: number = 56;
const RAIL_HEIGHT: number = 810;
const RAIL_PADDING_TOP: number = 8;
const BUTTON_SIZE: number = 44;
const LETTER_SIZE: number = 9.216;
// Phone (web `.tv-directory .tv-alphabet` under 760 px): fixed on the right edge, 52 wide, from 88 below the top to 82 above the bottom
// (clear of the floating nav bar); the letters share that height, each 44 wide, 9 px bold.
const TOUCH_RAIL_WIDTH: number = 52;
const TOUCH_RAIL_TOP: number = 88;
const TOUCH_RAIL_BOTTOM: number = 82;
const TOUCH_LETTER_WIDTH: number = 44;
const TOUCH_LETTER_SIZE: number = 8.5;

@Component
export struct AlphabetRail {
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
        Text(letter).fontFamily(nunito(500))
          .width(TOUCH_LETTER_WIDTH)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)
          .fontSize(TOUCH_LETTER_SIZE)
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(letter === this.activeLetter ? activeColors().bg : activeColors().inkSoft))
          .backgroundColor(letter === this.activeLetter ? toResourceColorWithAlpha(activeColors().ink, 0.82) : Color.Transparent)
          .borderRadius(22)
          .onClick(() => {
            this.onJump(letter);
          })
      }, (letter: string): string => letter)
    }
    .width(TOUCH_RAIL_WIDTH)
    .height(`calc(100% - ${TOUCH_RAIL_TOP + TOUCH_RAIL_BOTTOM}vp)`)
    .alignItems(HorizontalAlign.Center)
    .position({ x: '100%', y: TOUCH_RAIL_TOP })
    .markAnchor({ x: '100%', y: 0 })
  }

  build() {
    if (!isTvMetrics()) {
      this.touchRail()
    } else {
      this.tvRail()
    }
  }

  @Builder
  private tvRail(): void {
    Scroll() {
      Column() {
        ForEach(this.letters, (letter: string) => {
          Text(letter).fontFamily(nunito(400))
            .width(tv(BUTTON_SIZE))
            .height(tv(BUTTON_SIZE))
            .textAlign(TextAlign.Center)
            .fontSize(tv(LETTER_SIZE))
            .fontColor(toResourceColor(letter === this.activeLetter ? activeColors().bg : activeColors().inkSoft))
            .backgroundColor(letter === this.activeLetter ? toResourceColor(activeColors().ink) : Color.Transparent)
            .borderRadius(tv(BUTTON_SIZE / 2))
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
