/**
 * The shared single-select (web `components/ui/Select.tsx`; named SelectField because ArkUI reserves `Select`): a trigger showing the chosen option and a chevron, which
 * opens a list of options (a check on the chosen one, the highlighted one filled with ink). Choosing closes the list.
 * Use it for any "pick one from many" choice; `ChoiceSegments` is for two to four short choices. Sizes are web's at
 * 1920x1080 (1rem = 19.2 px). shortcut: the list scrolls under a fixed max height but has no edge fade, and Home/End
 * keys are not wired; add both with the shared scroll-fade work.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import type { Choice } from './ChoiceSegments';

/** The colour theme choices, shared by Settings > Appearance and the profile picker's theme select. */
export const THEME_CHOICES: Choice[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const MIN_HEIGHT: number = 56;
const GAP: number = 11.52;
const PADDING_V: number = 10.56;
const PADDING_H: number = 15.36;
const RADIUS: number = 12;
const FONT: number = 13.44;
const LIST_GAP: number = 6.72;
const STACK_GAP: number = 7.68;
const LIST_MAX_HEIGHT: number = 422;
const LINE_ALPHA: number = 0.76;
const BG_ALPHA: number = 0.64;

@Component
export struct SelectField {
  @Prop options: Choice[] = [];
  @Prop value: string = '';
  @Prop selectWidth: number = 268;
  /** Trigger height; the phone's selects are shorter than the TV's. */
  @Prop minHeight: number = MIN_HEIGHT;
  /** Corner radius; the phone picker's selects are square-cornered as on web. */
  @Prop radius: number = RADIUS;
  @Prop disabled: boolean = false;
  /** Phone profile picker: 'sun' or 'globe' glyph before the label, as web's theme and language selects. */
  @Prop lead: string = '';
  @Prop labelWeight: number = 700;
  @Prop labelSize: number = FONT;
  onChange: (value: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private open: boolean = false;
  @State private highlighted: string = '';

  private labelOf(value: string): string {
    const found = this.options.find((option: Choice) => option.value === value);
    return found !== undefined ? found.label : '';
  }

  private fill(active: boolean): ResourceColor {
    return active ? toResourceColor(activeColors().ink) : toResourceColorWithAlpha(activeColors().surfaceSoft, BG_ALPHA);
  }

  private textColor(active: boolean): ResourceColor {
    return toResourceColor(active ? activeColors().bg : activeColors().ink);
  }

  build() {
    Column({ space: tv(STACK_GAP) }) {
      Row({ space: tv(GAP) }) {
        if (this.lead.length > 0) {
          Image(this.lead === 'sun' ? $r('app.media.select_sun') : $r('app.media.select_globe'))
            .width(this.labelSize * 1.5)
            .height(this.labelSize * 1.5)
            .fillColor(this.textColor(this.highlighted === '#trigger'))
        }
        Text(this.labelOf(this.value)).fontFamily(nunito(this.labelWeight))
          .fontSize(tv(this.labelSize))
          .fontWeight(this.labelWeight >= 700 ? FontWeight.Bold : FontWeight.Medium)
          .fontColor(this.textColor(this.highlighted === '#trigger'))
          .layoutWeight(1)
        Text('⌄').fontFamily(nunito(400))
          .fontSize(tv(FONT))
          .fontColor(this.textColor(this.highlighted === '#trigger'))
          .rotate({ angle: this.open ? 180 : 0 })
      }
      .width(tv(this.selectWidth))
      .constraintSize({ minHeight: tv(this.minHeight) })
      .padding({ left: tv(PADDING_H), right: tv(PADDING_H), top: tv(PADDING_V), bottom: tv(PADDING_V) })
      .borderRadius(tv(this.radius))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, LINE_ALPHA * 0.3) })
      .backgroundColor(this.fill(this.highlighted === '#trigger'))
      .opacity(this.disabled ? 0.5 : 1)
      .focusable(!this.disabled)
      .onFocus(() => {
        this.highlighted = '#trigger';
      })
      .onBlur(() => {
        this.highlighted = '';
      })
      .onClick(() => {
        if (!this.disabled) {
          this.open = !this.open;
        }
      })

      if (this.open) {
        Scroll() {
          Column({ space: tv(LIST_GAP) }) {
            ForEach(this.options, (option: Choice) => {
              Row({ space: tv(GAP) }) {
                Text(option.label).fontFamily(nunito(700))
                  .fontSize(tv(FONT))
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.textColor(this.highlighted === option.value))
                  .layoutWeight(1)
                Text(option.value === this.value ? '✓' : '').fontFamily(nunito(400))
                  .fontSize(tv(FONT))
                  .fontColor(this.textColor(this.highlighted === option.value))
                  .width(tv(FONT))
                  .textAlign(TextAlign.Center)
              }
              .width('100%')
              .constraintSize({ minHeight: tv(this.minHeight) })
              .padding({ left: tv(PADDING_H), right: tv(PADDING_H), top: tv(PADDING_V), bottom: tv(PADDING_V) })
              .borderRadius(tv(this.radius))
              .border({ width: 1, color: option.value === this.value ? toResourceColor(activeColors().ink) :
                toResourceColorWithAlpha(activeColors().ink, LINE_ALPHA * 0.3) })
              .backgroundColor(this.fill(this.highlighted === option.value))
              .focusable(true)
              .onFocus(() => {
                this.highlighted = option.value;
              })
              .onBlur(() => {
                this.highlighted = '';
              })
              .onClick(() => {
                this.open = false;
                this.onChange(option.value);
              })
            }, (option: Choice): string => `${option.value}:${option.value === this.value}`)
          }
          .width('100%')
        }
        .width(tv(this.selectWidth))
        .constraintSize({ maxHeight: tv(LIST_MAX_HEIGHT) })
        .scrollBar(BarState.Off)
      }
    }
    .alignItems(HorizontalAlign.Start)
  }
}
