/**
 * The calendar's period jump (web `components/shell/PeriodPicker.tsx`): two scrollable lists, months and years, in a
 * panel under the range button. Choosing a year only changes the year being browsed; choosing a month applies the
 * jump (to the first of that month, in the browsed year) and closes the panel. The chosen month of the current year
 * is filled with ink, as the other choice tiles.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { MONTH_NAMES, periodJumpDay, yearChoices, yearOfDay, monthOfDay } from '../../core/PeriodPicker';

const LIST_WIDTH: number = 150;
const LIST_MAX_HEIGHT: number = 340;
const OPTION_HEIGHT: number = 44;
const OPTION_RADIUS: number = 10;
const OPTION_SIZE: number = 13.44;
const GAP: number = 6;
const PANEL_PADDING: number = 12;
const PANEL_RADIUS: number = 16;

@Component
export struct PeriodPicker {
  /** The current anchor day (`YYYY-MM-DD`). */
  @Prop value: string = '';
  onChange: (day: string) => void = () => {};
  onClose: () => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  /** The year being browsed: starts as the anchor's. */
  @State private draftYear: number = 0;

  aboutToAppear(): void {
    this.draftYear = yearOfDay(this.value);
  }

  @Builder
  private option(label: string, selected: boolean, onTap: () => void): void {
    Text(label).fontFamily(nunito(700))
      .width('100%')
      .height(tv(OPTION_HEIGHT))
      .textAlign(TextAlign.Center)
      .fontSize(tv(OPTION_SIZE))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(selected ? activeColors().bg : activeColors().ink))
      .backgroundColor(selected ? toResourceColor(activeColors().ink) :
        toResourceColorWithAlpha(activeColors().surfaceSoft, 0.64))
      .borderRadius(tv(OPTION_RADIUS))
      .focusable(true)
      .defaultFocus(selected)
      .onClick(onTap)
  }

  build() {
    Row({ space: tv(GAP) }) {
      Scroll() {
        Column({ space: tv(GAP) }) {
          ForEach(MONTH_NAMES, (name: string, index: number) => {
            this.option(name, this.draftYear === yearOfDay(this.value) && index + 1 === monthOfDay(this.value), (): void => {
              this.onChange(periodJumpDay(this.draftYear, index + 1));
              this.onClose();
            })
          }, (name: string): string => name)
        }
      }
      .width(tv(LIST_WIDTH))
      .constraintSize({ maxHeight: tv(LIST_MAX_HEIGHT) })
      .scrollBar(BarState.Off)
      Scroll() {
        Column({ space: tv(GAP) }) {
          ForEach(yearChoices(yearOfDay(this.value)), (year: number) => {
            this.option(String(year), year === this.draftYear, (): void => {
              this.draftYear = year;
            })
          }, (year: number): string => `${year}:${year === this.draftYear}`)
        }
      }
      .width(tv(LIST_WIDTH))
      .constraintSize({ maxHeight: tv(LIST_MAX_HEIGHT) })
      .scrollBar(BarState.Off)
    }
    .padding(tv(PANEL_PADDING))
    .borderRadius(tv(PANEL_RADIUS))
    .backgroundColor(toResourceColor(activeColors().surfaceStrong))
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
    .shadow({ radius: tv(36), offsetX: 0, offsetY: tv(14), color: 'rgba(56, 38, 33, 0.18)' })
  }
}
