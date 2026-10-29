/**
 * One labelled choice section in a drawer (web `FilterSection` + `.tv-filter-choice-grid` / `.tv-segmented`):
 * a small uppercase heading over equal-width choice tiles, the chosen one filled with ink.
 */

import { nunito, nunitoAt, webLineHeight } from '../Typography';
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
const DESCRIPTION_SIZE: number = 13.12;
const SECTION_GAP: number = 30;
// Web phone drawer choices: 46.7 high, 11.5 type, sections 8 vp closer than the TV's.
const TOUCH_CHOICE_HEIGHT: number = 48; // web: 144 px inactive; the selected choice is 1.025 scaled
const TOUCH_CHOICE_LABEL_SIZE: number = 11.52;
const TOUCH_SECTION_GAP: number = 21.9;
const LARGE_HEADING_SIZE: number = 26.4;
const LARGE_HEADING_LETTER_SPACING: number = -0.924;
const LARGE_HEADING_GAP: number = 16;
// Web inactive choice: surface-soft at 0.64.
const INACTIVE_BG_ALPHA: number = 0.64;

/** Web phone: the choice buttons capitalise each word ("Date added" reads "Date Added"). */
function capitalWords(label: string): string {
  let out = '';
  for (let i = 0; i < label.length; i++) {
    out += i === 0 || label.charAt(i - 1) === ' ' ? label.charAt(i).toUpperCase() : label.charAt(i);
  }
  return out;
}

@Component
export struct ChoiceSegments {
  @Prop heading: string = '';
  @Prop choices: Choice[] = [];
  @Prop selected: string = '';
  /** Settings panels (web `.appearance-setting`): a 26.4 px heading over choices across `width`. */
  @Prop large: boolean = false;
  /** Settings panels: one line of copy under the large heading (web `.appearance-setting-heading p`). */
  @Prop description: string = '';
  /** Settings > Colour theme: web's buttons carry the lower-case value, the other settings their label. */
  @Prop lowerLabels: boolean = false;
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

  /** One outlined shape of a phone View button (web draws them as 1 px bordered boxes). */
  @Builder
  private viewShape(w: number, h: number): void {
    Column()
      .width(w)
      .height(h)
      .borderRadius(1)
      .backgroundColor('#05000000') // near-transparent: it is an outline in web, yet a visible box for the layout export
      .border({ width: 1, color: toResourceColor(activeColors().inkMuted) })
  }

  @Builder
  private viewShapes(value: string): void {
    if (value === 'list') {
      Column({ space: 2 }) {
        this.viewShape(20, isTvMetrics() ? 2.94 : 2)
        this.viewShape(20, isTvMetrics() ? 2.94 : 2)
        this.viewShape(20, isTvMetrics() ? 2.94 : 2)
      }
    } else if (value === 'screen') {
      Row({ space: 2.06 }) {
        this.viewShape(5.46, isTvMetrics() ? 13.13 : 3.86)
        this.viewShape(5.46, isTvMetrics() ? 13.13 : 3.86)
        this.viewShape(5.48, isTvMetrics() ? 13.13 : 3.86)
      }
    } else {
      Row({ space: 2 }) {
        this.viewShape(4, 13)
        this.viewShape(4, 13)
        this.viewShape(4, 13)
      }
    }
  }

  build() {
    Column({ space: tv(this.large ? LARGE_HEADING_GAP : HEADING_GAP + (isTvMetrics() ? 1.8 : 0)) }) {
      if (this.large) {
        Text(this.heading).fontFamily(nunitoAt(500, tv(LARGE_HEADING_SIZE)))
          .fontSize(tv(LARGE_HEADING_SIZE)).lineHeight(webLineHeight(tv(LARGE_HEADING_SIZE))).halfLeading(true)
          .fontWeight(FontWeight.Medium)
          .letterSpacing((tv(LARGE_HEADING_LETTER_SPACING)) + (isTvMetrics() ? -0.227 : 0))
          .fontColor(toResourceColor(activeColors().ink))
          
          .margin({ top: -4.5, bottom: this.description === '' ? tv(5) - 1.9 : -1.3 }) // web: 29 px from the heading to the choices without copy, 22 + 21 around it
        if (this.description !== '') {
          Text(this.description).fontFamily(nunitoAt(400, tv(DESCRIPTION_SIZE)))
            .fontSize(tv(DESCRIPTION_SIZE)).letterSpacing((isTvMetrics() ? -0.093 : 0)).lineHeight(webLineHeight(tv(DESCRIPTION_SIZE))).halfLeading(true)
            .fontColor(toResourceColor(activeColors().inkMuted))
            .margin({ top: tv(-5), bottom: tv(1) })
        }
      } else {
        Text(this.heading).fontFamily(nunitoAt(700, isTvMetrics() ? tv(HEADING_SIZE) : TOUCH_HEADING_SIZE))
          .fontSize(isTvMetrics() ? tv(HEADING_SIZE) : TOUCH_HEADING_SIZE).lineHeight(webLineHeight(isTvMetrics() ? tv(HEADING_SIZE) : TOUCH_HEADING_SIZE)).halfLeading(true)
          .fontWeight(FontWeight.Bold)
          .letterSpacing(((tv(HEADING_LETTER_SPACING) - (isTvMetrics() ? 0 : 0.02)) + (isTvMetrics() ? 0.11 : 0)) + (!isTvMetrics() ? -0.179 : 0))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColor(activeColors().inkMuted))
          
      }
      Row({ space: tv(CHOICE_GAP) }) {
        ForEach(this.choices, (choice: Choice) => {
         if (choice.icon !== undefined && choice.icon.length > 0) {
          // phone View buttons: web draws three outlined bars (list, screen, cover) over a lower-case 900-weight word
          Column({ space: isTvMetrics() ? 7.4 : 6.85 }) {
            this.viewShapes(choice.value)
            Text(capitalWords(choice.label)).fontFamily(nunito(900))
              .letterSpacing(((0.4) + (isTvMetrics() ? -0.465 : 0)) + (!isTvMetrics() ? -0.468 : 0)) // web's label run is wider than ArkUI lays it out
              .fontSize(isTvMetrics() ? tv(CHOICE_LABEL_SIZE) : TOUCH_CHOICE_LABEL_SIZE).translate({ y: (isTvMetrics() ? -4.19 : 0) }).lineHeight(webLineHeight(isTvMetrics() ? tv(CHOICE_LABEL_SIZE) : TOUCH_CHOICE_LABEL_SIZE)).halfLeading(true)
              .fontWeight(FontWeight.Bolder)
              .fontColor(toResourceColor(choice.value === this.selected ? activeColors().bg : activeColors().inkMuted))
          }
          .accessibilityText(choice.label).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
          .width(tv(this.choiceWidth()))
          .height(isTvMetrics() ? tv(CHOICE_HEIGHT) : TOUCH_CHOICE_HEIGHT)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(choice.value === this.selected ? toResourceColor(activeColors().ink) :
            toResourceColorWithAlpha(activeColors().surfaceSoft, INACTIVE_BG_ALPHA))
          .borderRadius(CHOICE_RADIUS)
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.083) })
          .scale(choice.value === this.selected ? { x: 1.025, y: 1.025 } : { x: 1, y: 1 })
          .focusable(true)
          .onClick(() => {
            this.onChoose(choice.value);
          })
         } else {
          // web: the choice is a button (fill, border, radius) holding a span with the label, two elements
          Row() {
            Text(capitalWords(choice.label)).fontFamily(isTvMetrics() ? (this.large ? nunito(900) : nunitoAt(700, tv(CHOICE_LABEL_SIZE))) : nunito(680))
              .fontSize(isTvMetrics() ? tv(CHOICE_LABEL_SIZE) : TOUCH_CHOICE_LABEL_SIZE)
              .lineHeight(webLineHeight(isTvMetrics() ? tv(CHOICE_LABEL_SIZE) : TOUCH_CHOICE_LABEL_SIZE)).halfLeading(true)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(((this.large && isTvMetrics() ? 0.43 : 0) + (isTvMetrics() ? -0.247 : 0)) + (!isTvMetrics() ? -0.075 : 0)) // web's run is about 3 wider than ArkUI lays it out
              .fontColor(toResourceColor(choice.value === this.selected ? activeColors().bg : activeColors().inkMuted))
          }
          .accessibilityText(choice.label).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
          .width(tv(this.choiceWidth()))
          .height(isTvMetrics() ? tv(CHOICE_HEIGHT) : TOUCH_CHOICE_HEIGHT)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(choice.value === this.selected ? toResourceColor(activeColors().ink) :
            toResourceColorWithAlpha(activeColors().surfaceSoft, INACTIVE_BG_ALPHA))
          .borderRadius(tv(CHOICE_RADIUS))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.083) })
          .scale((this.large || !isTvMetrics()) && choice.value === this.selected ? { x: 1.025, y: 1.025 } : { x: 1, y: 1 })
          .focusable(true)
          .onClick(() => {
            this.onChoose(choice.value);
          })
         }
        }, (choice: Choice): string => choice.value)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: this.large ? tv(SECTION_GAP) : (isTvMetrics() ? tv(SECTION_GAP + 3) : TOUCH_SECTION_GAP) })
  }
}
