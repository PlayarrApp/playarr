/**
 * The watchlist (web `pages/Watchlist.tsx`, TV layout): the shell rail, a round Back and "Watchlist", and on the
 * right a list of rows, one per saved title: its name, then year and source chips, then the reason a disabled action
 * gives, with an action pill (Open, when the library has a copy) and "Remove from watchlist". Empty, loading and
 * error states as web. Rows follow web's `.tv-download-row` look at 1920x1080.
 *
 * Not here: Request (discovery is not built on HarmonyOS), so a title with no library copy shows no action pill; the
 * live-updates revalidation web does.
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
import { listWatchlist, removeFromWatchlist } from '../data/WatchlistRepository';
import { libraryWorkId, sourceChips, explainedReasons, primaryActionLabel } from '../core/Watchlist';
import type { WatchlistEntry } from '../core/Types/Watchlist';

import { WATCHLIST_NAV_ID, buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams } from '../navigation/Routes';
import { getNavStack, popRoute, pushRoute } from '../navigation/NavStack';

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
const PILL_HEIGHT: number = 44;
const PILL_PADDING: number = 17.28;
const PILL_SIZE: number = 12.48;
const PILL_GAP: number = 9.6;
// Web back button and title (shared header look).
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 17.28;
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
const MESSAGE_LEFT: number = 826;
const MESSAGE_TOP: number = 312;

type WatchlistPhase = 'loading' | 'ready' | 'error';

@Component
export struct WatchlistScreen {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private phase: WatchlistPhase = 'loading';
  @State private entries: WatchlistEntry[] = [];
  @State private removeError: string = '';
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
    const result = await listWatchlist();
    if (result.kind === 'ok') {
      this.entries = result.value.items;
      this.phase = 'ready';
    } else {
      this.phase = 'error';
    }
  }

  private async remove(entry: WatchlistEntry): Promise<void> {
    this.removeError = '';
    const result = await removeFromWatchlist(entry.title.title_key);
    if (result.kind === 'ok') {
      this.entries = this.entries.filter((item: WatchlistEntry): boolean => item.title.title_key !== entry.title.title_key);
    } else {
      this.removeError = 'Could not remove the title. Try again.';
    }
  }

  private open(workId: string): void {
    const params: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, params);
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
  private row(entry: WatchlistEntry): void {
    Row({ space: tv(PILL_GAP) }) {
      Column({ space: tv(COPY_GAP) }) {
        Text(entry.title.title)
          .fontSize(tv(TITLE_SIZE_ROW))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: tv(META_GAP) }) {
          if (entry.title.year !== undefined && entry.title.year !== null) {
            Text(String(entry.title.year))
              .fontSize(tv(META_SIZE))
              .fontColor(toResourceColor(activeColors().inkMuted))
          }
          ForEach(sourceChips(entry.title.sources), (chip: string) => {
            Text(chip)
              .fontSize(tv(META_SIZE))
              .fontColor(toResourceColor(activeColors().inkMuted))
          }, (chip: string): string => chip)
        }
        ForEach(explainedReasons(entry.actions), (line: string) => {
          Text(line)
            .fontSize(tv(META_SIZE))
            .fontColor(toResourceColor(activeColors().inkMuted))
        }, (line: string): string => line)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Row({ space: tv(PILL_GAP) }) {
        if (libraryWorkId(entry.title) !== null && primaryActionLabel(entry.actions) !== null) {
          this.pill(primaryActionLabel(entry.actions) ?? '', (): void => {
            const workId = libraryWorkId(entry.title);
            if (workId !== null) {
              this.open(workId);
            }
          })
        }
        this.pill('Remove from watchlist', (): void => {
          this.remove(entry);
        })
      }
    }
    .width(tv(LIST_WIDTH))
    .padding(tv(ROW_PADDING))
    .borderRadius(tv(ROW_RADIUS))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, ROW_BG_ALPHA))
    .alignItems(VerticalAlign.Center)
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
            message: "Couldn't load your watchlist",
            retryLabel: 'Try again',
            retry: (): void => {
              this.load();
            },
          })
            .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
        } else if (this.entries.length === 0) {
          Column({ space: tv(8) }) {
            Text('Your watchlist is empty')
              .fontSize(tv(26.4))
              .fontWeight(FontWeight.Medium)
              .letterSpacing(tv(-0.924))
              .fontColor(toResourceColor(activeColors().ink))
            Text('Add titles from search or a title page to keep them here on every device.')
              .fontSize(tv(13.824))
              .fontColor(toResourceColor(activeColors().inkSoft))
          }
          .alignItems(HorizontalAlign.Start)
          .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
        } else {
          List({ space: tv(ROW_GAP) }) {
            ForEach(this.entries, (entry: WatchlistEntry) => {
              ListItem() {
                this.row(entry)
              }
            }, (entry: WatchlistEntry): string => entry.title.title_key)
            if (this.removeError.length > 0) {
              ListItem() {
                Text(this.removeError)
                  .fontSize(tv(META_SIZE))
                  .fontColor(toResourceColor(activeColors().danger))
              }
            }
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
            selectedId: WATCHLIST_NAV_ID,
            onSelect: (id: string): void => {
              navigateFromRail(id, WATCHLIST_NAV_ID);
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
          Text('Watchlist')
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

/** Registered in `profile/router_map.json` as the `Watchlist` route's `buildFunction`. */
@Builder
export function WatchlistBuilder(): void {
  WatchlistScreen()
}
