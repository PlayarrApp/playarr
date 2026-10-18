/**
 * The default-quality picker (web `components/QualityMatrix.tsx`, settings variant): an "Original" choice (best
 * available source) above a grid of tiers (UHD, FHD, HD, SD) by levels (Low, Medium, High), each cell a bitrate with
 * its level. The chosen cell is filled with ink, as the other choice tiles.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { QUALITY_LEVELS, QUALITY_TIERS, ORIGINAL_QUALITY } from '../../core/PlayerDefaults';
import type { QualityTier, QualityOption } from '../../core/PlayerDefaults';
import { t } from '../../core/Language';

const HEADING_COLUMN: number = 120;
const CELL_HEIGHT: number = 60;
const CELL_GAP: number = 8;
const CELL_RADIUS: number = 12;
const LABEL_SIZE: number = 13.44;
const DETAIL_SIZE: number = 10.56;
const HEADING_SIZE: number = 10.56;
const INACTIVE_BG_ALPHA: number = 0.64;

@Component
export struct QualityMatrix {
  @Prop selected: string = ORIGINAL_QUALITY;
  @Prop matrixWidth: number = 1042;
  onChoose: (id: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  private cellWidth(): number {
    return (this.matrixWidth - HEADING_COLUMN - 3 * CELL_GAP) / 3;
  }

  @Builder
  private cell(id: string, label: string, detail: string, cellWidth: number): void {
    Column({ space: tv(2) }) {
      Text(label).fontFamily(nunito(700))
        .fontSize(tv(LABEL_SIZE))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(id === this.selected ? activeColors().bg : activeColors().ink))
      Text(detail).fontFamily(nunito(400))
        .fontSize(tv(DETAIL_SIZE))
        .fontColor(toResourceColor(id === this.selected ? activeColors().bg : activeColors().inkSoft))
    }
    .width(tv(cellWidth))
    .height(tv(CELL_HEIGHT))
    .justifyContent(FlexAlign.Center)
    .borderRadius(tv(CELL_RADIUS))
    .backgroundColor(id === this.selected ? toResourceColor(activeColors().ink) :
      toResourceColorWithAlpha(activeColors().surfaceSoft, INACTIVE_BG_ALPHA))
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.083) })
    .focusable(true)
    .onClick(() => {
      this.onChoose(id);
    })
  }

  build() {
    Column({ space: tv(CELL_GAP) }) {
      this.cell(ORIGINAL_QUALITY, t('quality.original', 'Original'), t('quality.originalDetail', 'Best available source'), this.matrixWidth)
      Row({ space: tv(CELL_GAP) }) {
        Blank().width(tv(HEADING_COLUMN))
        ForEach(QUALITY_LEVELS, (level: string) => {
          Text(level).fontFamily(nunito(700))
            .width(tv(this.cellWidth()))
            .fontSize(tv(HEADING_SIZE))
            .fontWeight(FontWeight.Bold)
            .textCase(TextCase.UpperCase)
            .fontColor(toResourceColor(activeColors().inkSoft))
        }, (level: string): string => level)
      }
      ForEach(QUALITY_TIERS, (tier: QualityTier) => {
        Row({ space: tv(CELL_GAP) }) {
          Column({ space: tv(2) }) {
            Text(tier.label).fontFamily(nunito(700))
              .fontSize(tv(LABEL_SIZE))
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().ink))
            Text(tier.resolution).fontFamily(nunito(400))
              .fontSize(tv(DETAIL_SIZE))
              .fontColor(toResourceColor(activeColors().inkSoft))
          }
          .width(tv(HEADING_COLUMN))
          .alignItems(HorizontalAlign.Start)
          ForEach(tier.options, (option: QualityOption) => {
            this.cell(option.id, String(option.mbps) + ' Mbps', option.level, this.cellWidth())
          }, (option: QualityOption): string => `${option.id}:${option.id === this.selected}`)
        }
      }, (tier: QualityTier): string => tier.id)
    }
    .alignItems(HorizontalAlign.Start)
  }
}
