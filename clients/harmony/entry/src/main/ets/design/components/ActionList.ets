/**
 * The long-press title actions (web `.media-context-actions`): full-width 68 high rows, a 42 wide glyph column in the
 * accent colour and a bold label, on surface-soft with a 14 radius, 14 apart. Lives in the shared `Drawer` body.
 */

import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';

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
const LABEL_SIZE: number = 16;

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
        Row() {
          Text(action.glyph)
            .width(tv(GLYPH_COLUMN))
            .fontSize(tv(GLYPH_SIZE))
            .fontColor(toResourceColor(activeColors().accent))
          Text(action.label)
            .fontSize(tv(LABEL_SIZE))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().ink))
        }
        .width('100%')
        .height(tv(ROW_HEIGHT))
        .padding({ left: tv(ROW_PADDING_H), right: tv(ROW_PADDING_H) })
        .borderRadius(tv(ROW_RADIUS))
        .backgroundColor(toResourceColor(activeColors().surfaceSoft))
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
