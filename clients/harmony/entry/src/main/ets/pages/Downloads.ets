/**
 * Downloads (web `pages/Downloads.tsx`, TV layout): the shell, and on the right three groups (Active, Needs
 * attention, Downloaded) of rows (title, status and size, and for a downloaded one its keep-until), or the "No
 * downloads yet" state. Records come from the download engine through `data/DownloadsRepository.ets`; the page redraws
 * on every engine change (progress included). Row actions as web: Cancel an active one, Retry or Delete one that needs
 * attention, Delete or Edit keep-until on a downloaded one (a few presets in the shared drawer).
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { tv } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import {
  listDownloads,
  subscribeDownloads,
  unsubscribeDownloads,
  cancelDownload,
  retryDownload,
  removeDownload,
  setDownloadKeepUntil,
} from '../data/DownloadsRepository';
import { keepUntilLabel, keepPresets, keepUntilFromPreset } from '../core/DownloadEngine';
import type { KeepPreset } from '../core/DownloadEngine';
import { ROUTES } from '../navigation/Routes';
import type { PlayerRouteParams } from '../navigation/Routes';
import { getNavStack, pushRoute } from '../navigation/NavStack';
import { Drawer } from '../design/components/Drawer';
import { ChoiceSegments } from '../design/components/ChoiceSegments';
import type { Choice } from '../design/components/ChoiceSegments';
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
const PILL_HEIGHT: number = 44;
const PILL_PADDING: number = 17.28;
const PILL_SIZE: number = 12.48;
const PILL_GAP: number = 9.6;
const MESSAGE_LEFT: number = 826;
const MESSAGE_TOP: number = 312;

type DownloadsPhase = 'loading' | 'ready';

@Component
export struct DownloadsScreen {
  @State private phase: DownloadsPhase = 'loading';
  @State private records: DownloadRecord[] = [];
  /** The download whose keep-until is being edited, or '' for none. */
  @State private editingId: string = '';
  /** The engine listener this page registered, so it can be removed again. */
  private listener: (() => void) | null = null;

  aboutToAppear(): void {
    this.load();
    this.listener = (): void => {
      this.load();
    };
    subscribeDownloads(this.listener);
  }

  aboutToDisappear(): void {
    if (this.listener !== null) {
      unsubscribeDownloads(this.listener);
      this.listener = null;
    }
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
  private pill(label: string, onTap: () => void): void {
    Text(label)
      .fontSize(tv(PILL_SIZE))
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(PILL_HEIGHT))
      .padding({ left: tv(PILL_PADDING), right: tv(PILL_PADDING) })
      .borderRadius(tv(PILL_HEIGHT / 2))
      .backgroundColor(toResourceColor(activeColors().surfaceSoft))
      .focusable(true)
      .onClick(onTap)
  }

  @Builder
  private row(record: DownloadRecord): void {
    Row({ space: tv(PILL_GAP) }) {
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
          if (record.status === 'ready') {
            Text(keepUntilLabel(record.keepUntil))
              .fontSize(tv(META_SIZE))
              .fontColor(toResourceColor(activeColors().inkMuted))
          }
        }
        if (record.errorMessage !== undefined && record.errorMessage !== null && record.errorMessage.length > 0 &&
          (record.status === 'failed' || record.status === 'expired')) {
          Text(record.errorMessage)
            .fontSize(tv(META_SIZE))
            .fontColor(toResourceColor(activeColors().danger))
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      if (record.status === 'queued' || record.status === 'processing' || record.status === 'downloading') {
        this.pill('Cancel', (): void => {
          cancelDownload(record.id);
        })
      }
      if (record.status === 'failed' || record.status === 'canceled' || record.status === 'expired') {
        this.pill('Retry', (): void => {
          retryDownload(record.id);
        })
      }
      if (record.status === 'ready' && record.filePath !== undefined && record.filePath.length > 0) {
        this.pill('Play', (): void => {
          this.playOffline(record);
        })
      }
      if (record.status === 'ready') {
        this.pill('Edit', (): void => {
          this.editingId = record.id;
        })
      }
      if (record.status !== 'queued' && record.status !== 'processing' && record.status !== 'downloading') {
        this.pill('Delete', (): void => {
          removeDownload(record.id);
        })
      }
    }
    .width(tv(LIST_WIDTH))
    .padding(tv(ROW_PADDING))
    .borderRadius(tv(ROW_RADIUS))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, ROW_BG_ALPHA))
    .alignItems(VerticalAlign.Center)
  }

  /** Plays the saved file with no server (web's offline playback). */
  private playOffline(record: DownloadRecord): void {
    const params: PlayerRouteParams = {
      mediaFileId: record.mediaFileId !== undefined ? record.mediaFileId : '',
      workId: record.workId !== undefined ? record.workId : '',
      localPath: record.filePath !== undefined ? record.filePath : '',
    };
    pushRoute(getNavStack(), ROUTES.Player, params);
  }

  private keepChoices(): Choice[] {
    return keepPresets(Date.now()).map((preset: KeepPreset): Choice => ({ value: preset.value, label: preset.label }));
  }

  private chooseKeep(value: string): void {
    setDownloadKeepUntil(this.editingId, keepUntilFromPreset(value, Date.now()));
    this.editingId = '';
  }

  @Builder
  private keepBody(): void {
    ChoiceSegments({
      heading: 'Keep this download',
      choices: this.keepChoices(),
      selected: '',
      sectionWidth: 268,
      onChoose: (value: string): void => {
        this.chooseKeep(value);
      },
    })
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
    if (this.editingId.length > 0) {
      Drawer({
        kicker: 'Downloads',
        title: 'Keep until',
        onClose: (): void => {
          this.editingId = '';
        },
        body: (): void => {
          this.keepBody();
        },
      })
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
