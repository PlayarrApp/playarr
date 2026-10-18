/**
 * One labelled choice section in a drawer (web `FilterSection` + `.tv-filter-choice-grid` / `.tv-segmented`):
 * a small uppercase heading over equal-width choice tiles, the chosen one filled with ink.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv } from '../Metrics';

export interface Choice {
  value: string;
  label: string;
  /** A glyph drawn above the label (web's View buttons); empty for none. */
  icon?: string;
}

const SECTION_WIDTH: number = 268;
const HEADING_SIZE: number = 9.6;
/** Web's phone drawer section headings (measured on the 360 vp reference: 0.75 of the TV's). */
const TOUCH_HEADING_SIZE: number = 7.2;
const HEADING_LETTER_SPACING: number = 0.672;
const HEADING_GAP: number = 13;
const CHOICE_HEIGHT: number = 56;
const CHOICE_GAP: number = 8;
const TOUCH_DRAWER_SECTION_WIDTH: number = 320;
const CHOICE_RADIUS: number = 12;
const CHOICE_LABEL_SIZE: number = 10.56;
const DESCRIPTION_SIZE: number = 13.824;
const SECTION_GAP: number = 30;
// Web phone drawer choices: 46.7 high, 11.5 type, sections 8 vp closer than the TV's.
const TOUCH_CHOICE_HEIGHT: number = 46.7;
const TOUCH_CHOICE_LABEL_SIZE: number = 11.5;
const TOUCH_SECTION_GAP: number = 22;
const LARGE_HEADING_SIZE: number = 26.4;
const LARGE_HEADING_LETTER_SPACING: number = -0.924;
const LARGE_HEADING_GAP: number = 16;
// Web inactive choice: surface-soft at 0.64.
const INACTIVE_BG_ALPHA: number = 0.64;

@Component
export struct ChoiceSegments {
  @Prop heading: string = '';
  @Prop choices: Choice[] = [];
  @Prop selected: string = '';
  /** Settings panels (web `.appearance-setting`): a 26.4 px heading over choices across `width`. */
  @Prop large: boolean = false;
  /** Settings panels: one line of copy under the large heading (web `.appearance-setting-heading p`). */
  @Prop description: string = '';
  @Prop sectionWidth: number = SECTION_WIDTH;
  onChoose: (value: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  private choiceWidth(): number {
    const count = Math.max(1, this.choices.length);
    // Phone drawers are the page wide (360 vp less 20 padding each side), not the TV's 268.
    const total = !isTvMetrics() && this.sectionWidth === SECTION_WIDTH ? TOUCH_DRAWER_SECTION_WIDTH : this.sectionWidth;
    return (total - CHOICE_GAP * (count - 1)) / count;
  }

  build() {
    Column({ space: tv(this.large ? LARGE_HEADING_GAP : HEADING_GAP) }) {
      if (this.large) {
        Text(this.heading).fontFamily(nunito(500))
          .fontSize(tv(LARGE_HEADING_SIZE))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(LARGE_HEADING_LETTER_SPACING))
          .fontColor(toResourceColor(activeColors().ink))
        if (this.description !== '') {
          Text(this.description).fontFamily(nunito(400))
            .fontSize(tv(DESCRIPTION_SIZE))
            .fontColor(toResourceColor(activeColors().inkSoft))
        }
      } else {
        Text(this.heading).fontFamily(nunito(700))
          .fontSize(isTvMetrics() ? tv(HEADING_SIZE) : TOUCH_HEADING_SIZE)
          .fontWeight(FontWeight.Bold)
          .letterSpacing(tv(HEADING_LETTER_SPACING))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColor(activeColors().inkSoft))
      }
      Row({ space: tv(CHOICE_GAP) }) {
        ForEach(this.choices, (choice: Choice) => {
          Text((choice.icon !== undefined && choice.icon.length > 0 ? choice.icon + '\n' : '') + choice.label).fontFamily(nunito(700))
            .width(tv(this.choiceWidth()))
            .height(isTvMetrics() ? tv(CHOICE_HEIGHT) : TOUCH_CHOICE_HEIGHT)
            .textAlign(TextAlign.Center)
            .fontSize(isTvMetrics() ? tv(CHOICE_LABEL_SIZE) : TOUCH_CHOICE_LABEL_SIZE)
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(choice.value === this.selected ? activeColors().bg : activeColors().inkSoft))
            .backgroundColor(choice.value === this.selected ? toResourceColor(activeColors().ink) :
              toResourceColorWithAlpha(activeColors().surfaceSoft, INACTIVE_BG_ALPHA))
            .borderRadius(tv(CHOICE_RADIUS))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.083) })
            .focusable(true)
            .onClick(() => {
              this.onChoose(choice.value);
            })
        }, (choice: Choice): string => choice.value)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: isTvMetrics() || this.large ? tv(SECTION_GAP) : TOUCH_SECTION_GAP })
  }
}
