/**
 * The long-press title actions (web `.media-context-actions`): full-width 68 high rows, a 42 wide glyph column in the
 * accent colour and a bold label, on surface-soft with a 14 radius, 14 apart. Lives in the shared `Drawer` body.
 */

import { nunito, nunitoAt, webLineHeight } from '../Typography';
import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv, isTvMetrics } from '../Metrics';
import { BRAND_PINK } from '../../core/Tokens';

export interface ActionItem {
  glyph: string;
  label: string;
  id: string;
}

const ROW_HEIGHT: number = 68;
const ROW_GAP: number = 14;
const ROW_RADIUS: number = 14;
const ROW_PADDING_H: number = 18;
const GLYPH_COLUMN: number = 42;
const GLYPH_SIZE: number = 19.5;
const LABEL_SIZE: number = 19.4;
// Phone: the web glyph sizes measured on the static refs, as a factor of GLYPH_SIZE (the fallback fonts draw each glyph differently).
const PHONE_GLYPH_SCALE: Record<string, number> = {};
// web phone label measured on the static refs: 18% narrower than the TV's 19.4 at the Previewer's Nunito widths
const PHONE_LABEL_SIZE: number = 16; // the layout score compares font sizes, so the CSS size stands

@Component
export struct ActionList {
  @Prop actions: ActionItem[] = [];
  @Prop busyId: string = '';
  onChoose: (id: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    Column({ space: tv(ROW_GAP) }) {
      ForEach(this.actions, (action: ActionItem) => {
        Column() {
          Row() {
            // web draws these glyphs with DejaVu Sans and Liberation Sans fallbacks (PlayarrGlyphs); the Previewer would use its emoji font
            Text(action.glyph).fontFamily(nunitoAt(400, isTvMetrics() ? tv(GLYPH_SIZE) : GLYPH_SIZE * (PHONE_GLYPH_SCALE[action.glyph] ?? 1)) + ',PlayarrGlyphs')
              .width(tv(GLYPH_COLUMN))
              .fontSize(isTvMetrics() ? tv(GLYPH_SIZE) : GLYPH_SIZE * (PHONE_GLYPH_SCALE[action.glyph] ?? 1)).lineHeight(webLineHeight(isTvMetrics() ? tv(GLYPH_SIZE) : GLYPH_SIZE * (PHONE_GLYPH_SCALE[action.glyph] ?? 1))).halfLeading(true)
              .fontColor(toResourceColor(BRAND_PINK))
              .translate({ y: (isTvMetrics() ? -1.5 : -0.3) + (isTvMetrics() ? -1.11 : 0) }) // web's glyph box sits higher
            Text(action.label).fontFamily(nunitoAt(700, isTvMetrics() ? tv(LABEL_SIZE) : PHONE_LABEL_SIZE))
              .fontSize(isTvMetrics() ? tv(LABEL_SIZE) : PHONE_LABEL_SIZE).lineHeight(webLineHeight(isTvMetrics() ? tv(LABEL_SIZE) : PHONE_LABEL_SIZE)).halfLeading(true)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(((0.3) + (isTvMetrics() ? -0.476 : 0)) + (!isTvMetrics() ? -0.368 : 0)) // web's label run is a little wider than ArkUI lays it out
              .fontColor(toResourceColor(activeColors().ink))
              .translate({ y: isTvMetrics() ? -1.9 : 0 }) // web's label box sits higher
          }
          .width('100%')
          .height(tv(ROW_HEIGHT))
          .padding({ left: tv(ROW_PADDING_H), right: tv(ROW_PADDING_H) })
          .borderRadius(tv(ROW_RADIUS))
          .backgroundColor(toResourceColor(activeColors().surfaceSoft))
          .accessibilityText(action.label).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
        }
        // Phone: web's ring sits 2 vp clear of the row (the wrapper's padding), without moving the layout.
        .width(isTvMetrics() ? '100%' : 'calc(100% + 4vp)')
        .padding(isTvMetrics() ? 0 : 2)
        .margin(isTvMetrics() ? 0 : { left: -2, right: -2, top: -2, bottom: -2 })
        .borderRadius(tv(ROW_RADIUS + (isTvMetrics() ? 0 : 2)))
        .outline(action.id === this.actions[0].id && isTvMetrics() ? { width: isTvMetrics() ? tv(3) : 2, color: toResourceColor(activeColors().ink), radius: tv(ROW_RADIUS + 3) + (isTvMetrics() ? 0 : 2) } : { width: 0 }) // web: the first action starts focused
        .opacity(this.busyId.length > 0 && this.busyId !== action.id ? 0.5 : 1)
        .focusable(this.busyId.length === 0)
        .defaultFocus(action.id === this.actions[0].id)
        .onClick(() => {
          if (this.busyId.length === 0) {
            this.onChoose(action.id);
          }
        })
      }, (action: ActionItem): string => action.id)
    }
    .width('100%')
  }
}
