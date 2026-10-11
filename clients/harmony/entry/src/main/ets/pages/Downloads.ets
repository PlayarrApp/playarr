/**
 * Downloads (web `pages/Downloads.tsx`, TV layout): the shell, and on the right three groups (Active, Needs
 * attention, Downloaded) of rows (title, status and size), or the "No downloads yet" state. Records come from
 * `data/DownloadsRepository.ets`, which has no engine behind it yet, so today the page shows the empty state; the
 * row actions (cancel, retry, delete, edit keep-until) arrive with the engine.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { tv } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { listDownloads } from '../data/DownloadsRepository';
import { downloadSections, downloadMetaParts } from '../core/Downloads';
import type { DownloadRecord, DownloadSections } from '../core/Downloads';

import { DOWNLOADS_NAV_ID } from '../navigation/NavItems';

// Rows start where the other list pages do: (826, 173), 1042 wide.
const LIST_LEFT: number = 826;
const LIST_TOP: number = 173;
const LIST_WIDTH: number = 1042;
const ROW_GAP: number = 11.52;
const ROW_PADDING: number = 19.2;
const ROW_RADIUS: number = 14;
const ROW_BG_ALPHA: number = 0.45;
const TITLE_SIZE_ROW: number = 16.32;
const META_SIZE: number = 13.4;
const META_GAP: number = 9.6;
const COPY_GAP: number = 5.76;
const HEADING_SIZE: number = 10.88;
const MESSAGE_LEFT: number = 826;
const MESSAGE_TOP: number = 312;

type DownloadsPhase = 'loading' | 'ready';

@Component
export struct DownloadsScreen {
  @State private phase: DownloadsPhase = 'loading';
  @State private records: DownloadRecord[] = [];

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.records = await listDownloads();
    this.phase = 'ready';
  }

  @Builder
  private heading(text: string): void {
    Text(text)
      .fontSize(tv(HEADING_SIZE))
      .fontWeight(FontWeight.Bold)
      .letterSpacing(tv(0.76))
      .textCase(TextCase.UpperCase)
      .fontColor(toResourceColor(activeColors().inkMuted))
  }

  @Builder
  private row(record: DownloadRecord): void {
    Column({ space: tv(COPY_GAP) }) {
      Text(record.title)
        .fontSize(tv(TITLE_SIZE_ROW))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Row({ space: tv(META_GAP) }) {
        ForEach(downloadMetaParts(record), (part: string) => {
          Text(part)
            .fontSize(tv(META_SIZE))
            .fontColor(toResourceColor(activeColors().inkMuted))
        }, (part: string): string => part)
      }
      if (record.status === 'failed' && record.errorMessage !== undefined && record.errorMessage !== null) {
        Text(record.errorMessage)
          .fontSize(tv(META_SIZE))
          .fontColor(toResourceColor(activeColors().danger))
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width(tv(LIST_WIDTH))
    .padding(tv(ROW_PADDING))
    .borderRadius(tv(ROW_RADIUS))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, ROW_BG_ALPHA))
    .focusable(true)
  }

  @Builder
  private section(title: string, records: DownloadRecord[]): void {
    if (records.length > 0) {
      ListItem() {
        this.heading(title)
      }
      ForEach(records, (record: DownloadRecord) => {
        ListItem() {
          this.row(record)
        }
      }, (record: DownloadRecord): string => record.id)
    }
  }

  @Builder
  private pageContent(): void {
    if (this.phase === 'loading') {
      AsyncState({ kind: AsyncStateKind.Loading })
        .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else if (this.records.length === 0) {
      Column({ space: tv(8) }) {
        Text('No downloads yet')
          .fontSize(tv(26.4))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(-0.924))
          .fontColor(toResourceColor(activeColors().ink))
        Text('Download a title from its detail page to watch it without a connection.')
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
      }
      .alignItems(HorizontalAlign.Start)
      .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else {
      List({ space: tv(ROW_GAP) }) {
        this.section('Active', this.sections().active)
        this.section('Needs attention', this.sections().needsAttention)
        this.section('Downloaded', this.sections().downloaded)
      }
      .width(tv(LIST_WIDTH))
      .height(tv(1080))
      .padding({ top: tv(LIST_TOP), bottom: tv(LIST_TOP) })
      .scrollBar(BarState.Off)
      .position({ x: tv(LIST_LEFT), y: 0 })
    }
  }

  private sections(): DownloadSections {
    return downloadSections(this.records);
  }

  build() {
    NavDestination() {
      PageShell({
        title: 'Downloads',
        selectedId: DOWNLOADS_NAV_ID,
        content: (): void => {
          this.pageContent();
        },
      })
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Downloads` route's `buildFunction`. */
@Builder
export function DownloadsBuilder(): void {
  DownloadsScreen()
}
