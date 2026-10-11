/**
 * The requests list (web `pages/Requests.tsx`, TV layout): the shell rail, a round Back and "Requests", and on the
 * right one row per request: its title, then year, status and who asked, then the status note. Rows have no action
 * (web: they are focusable so the D-pad can step down a long list). Empty, loading and error states as web.
 * Not here: the live-updates revalidation web does.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, TvGeometry } from '../design/Metrics';
import { NavRail } from '../design/components/NavRail';
import type { NavRailItem } from '../design/components/NavRail';
import { PlayarrLogo } from '../design/components/PlayarrLogo';
import { Clock } from '../design/components/Clock';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { getCatalogKinds } from '../data/CatalogRepository';
import { listRequests } from '../data/RequestsRepository';
import { requestMetaParts } from '../core/Requests';
import type { RequestView } from '../core/Types/Requests';

import { REQUESTS_NAV_ID, buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../navigation/NavItems';
import { getNavStack, popRoute } from '../navigation/NavStack';

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
// Web back button and title (shared header look).
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 17.28;
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
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
  @State private navItems: NavRailItem[] = [];

  aboutToAppear(): void {
    this.loadNav();
    this.load();
  }

  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.navItems = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
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

  build() {
    NavDestination() {
      Stack() {
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
        if (this.navItems.length > 0) {
          NavRail({
            items: this.navItems,
            primaryItems: buildPrimaryNavItems(),
            secondaryItems: buildSecondaryNavItems(),
            selectedId: REQUESTS_NAV_ID,
            onSelect: (id: string): void => {
              navigateFromRail(id, REQUESTS_NAV_ID);
            },
          })
        }
        PlayarrLogo({ logoSize: tv(TvGeometry.logoSize) })
          .position({ x: tv(TvGeometry.logoLeft), y: tv(TvGeometry.logoTop) })
        Row() {
          Clock()
        }
        .height(tv(TvGeometry.utilityRowHeight))
        .alignItems(VerticalAlign.Center)
        .position({ x: tv(TvGeometry.clockLeft), y: tv(TvGeometry.utilityRowTop) })
        Row({ space: tv(HEADER_GAP) }) {
          Text('←')
            .fontSize(tv(BACK_GLYPH_SIZE))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .textAlign(TextAlign.Center)
            .width(tv(HEADER_SIZE))
            .height(tv(HEADER_SIZE))
            .borderRadius(tv(HEADER_SIZE / 2))
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .focusable(true)
            .onClick(() => {
              popRoute(getNavStack());
            })
          Text('Requests')
            .fontSize(tv(TITLE_SIZE))
            .fontWeight(FontWeight.Medium)
            .letterSpacing(tv(TITLE_LETTER_SPACING))
            .fontColor(toResourceColor(activeColors().ink))
        }
        .height(tv(HEADER_SIZE))
        .alignItems(VerticalAlign.Center)
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Requests` route's `buildFunction`. */
@Builder
export function RequestsBuilder(): void {
  RequestsScreen()
}
