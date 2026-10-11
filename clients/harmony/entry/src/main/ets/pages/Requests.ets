/**
 * The requests list (web `pages/Requests.tsx`, TV layout): the shell rail, a round Back and "Requests", and on the
 * right one row per request: its title, then year, status and who asked, then the status note. Rows have no action
 * (web: they are focusable so the D-pad can step down a long list). Empty, loading and error states as web.
 * Not here: the live-updates revalidation web does.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { listRequests } from '../data/RequestsRepository';
import { requestMetaParts } from '../core/Requests';
import type { RequestView } from '../core/Types/Requests';

import { REQUESTS_NAV_ID } from '../navigation/NavItems';

// Rows start where Search's results do: (826, 173), 1042 wide.
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
const MESSAGE_LEFT: number = 826;
const MESSAGE_TOP: number = 312;

type RequestsPhase = 'loading' | 'ready' | 'error';

@Component
export struct RequestsScreen {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private phase: RequestsPhase = 'loading';
  @State private requests: RequestView[] = [];

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.phase = 'loading';
    const result = await listRequests();
    if (result.kind === 'ok') {
      this.requests = result.value;
      this.phase = 'ready';
    } else {
      this.phase = 'error';
    }
  }

  @Builder
  private row(request: RequestView): void {
    Column({ space: tv(COPY_GAP) }) {
      Text(request.title)
        .fontSize(tv(TITLE_SIZE_ROW))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Row({ space: tv(META_GAP) }) {
        ForEach(requestMetaParts(request), (part: string) => {
          Text(part)
            .fontSize(tv(META_SIZE))
            .fontColor(toResourceColor(activeColors().inkMuted))
        }, (part: string): string => part)
      }
      if (request.status_note !== undefined && request.status_note !== null && request.status_note.length > 0) {
        Text(request.status_note)
          .fontSize(tv(META_SIZE))
          .fontColor(toResourceColor(activeColors().inkMuted))
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
  private pageContent(): void {
    if (this.phase === 'loading') {
      AsyncState({ kind: AsyncStateKind.Loading })
        .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else if (this.phase === 'error') {
      AsyncState({
        kind: AsyncStateKind.Error,
        message: "Couldn't load your requests",
        retryLabel: 'Try again',
        retry: (): void => {
          this.load();
        },
      })
        .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else if (this.requests.length === 0) {
      Column({ space: tv(8) }) {
        Text('No requests yet')
          .fontSize(tv(26.4))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(-0.924))
          .fontColor(toResourceColor(activeColors().ink))
        Text('Request a title that is not in the library and its progress shows up here.')
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
      }
      .alignItems(HorizontalAlign.Start)
      .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else {
      List({ space: tv(ROW_GAP) }) {
        ForEach(this.requests, (request: RequestView) => {
          ListItem() {
            this.row(request)
          }
        }, (request: RequestView): string => request.id)
      }
      .width(tv(LIST_WIDTH))
      .height(tv(1080))
      .padding({ top: tv(LIST_TOP), bottom: tv(LIST_TOP) })
      .scrollBar(BarState.Off)
      .position({ x: tv(LIST_LEFT), y: 0 })
    }
  }

  build() {
    NavDestination() {
      PageShell({
        title: 'Requests',
        selectedId: REQUESTS_NAV_ID,
        content: (): void => {
          this.pageContent();
        },
      })
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Requests` route's `buildFunction`. */
@Builder
export function RequestsBuilder(): void {
  RequestsScreen()
}
