/**
 * Catalogue search, TV layout (web `pages/Search.tsx`): the shell rail, a round Back and "Search", the search
 * pill with its prompt on the left, and on the right either the empty state or a 3-column grid of landscape
 * results. Typing searches after a short pause, as web. Geometry copies the live web TV DOM at 1920x1080.
 *
 * Not yet here (13.10017): the Filters tile and drawer, recent searches.
 */

import { t } from '../core/Language';
import { nunito } from '../design/Typography';
import { image } from '@kit.ImageKit';

import { activeColors, toResourceColor, toResourceColorWithAlpha, tintFilter } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { isTvMetrics, tv, TvGeometry } from '../design/Metrics';
import { TouchIconButton } from '../design/components/TouchIconButton';
import { PageShell } from '../design/components/PageShell';
import { PosterCard } from '../design/components/PosterCard';
import { FeatureCopy } from '../design/components/FeatureCopy';
import { TitleActionsDrawer } from '../design/components/TitleActionsDrawer';
import { resultCountLabel } from '../core/CountFormat';
import { ActionTile } from '../design/components/ActionTile';
import { Drawer } from '../design/components/Drawer';
import { ChoiceSegments } from '../design/components/ChoiceSegments';
import { searchTypeChoices, workMatchesType } from '../core/SearchTypes';
import { BRAND_PINK } from '../core/Tokens';

import { getCatalogKinds, listWatchProgress, searchCatalog } from '../data/CatalogRepository';
import { indexWatchProgressByWork, watchMarkFor } from '../core/WatchState';
import type { WatchMark } from '../core/WatchState';
import type { WatchProgress } from '../core/Types/Playback';
import { fetchWorkArtworkByPriority, LANDSCAPE_ARTWORK_PRIORITY } from '../data/ArtworkRepository';
import type { Work } from '../core/Types/Work';

import { SEARCH_NAV_ID } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams } from '../navigation/Routes';
import { getNavStack, pushRoute } from '../navigation/NavStack';

// Web `.tv-search-form`: a 590x76 pill at (154, 173), surfaceStrong at 0.88, 24 px icon, 17.664 px text.
const FORM_TOP: number = 173;
const FORM_WIDTH: number = 590;
const FORM_HEIGHT: number = 76;
const FORM_BG_ALPHA: number = 0.88;
const FORM_PADDING_LEFT: number = 25;
const ICON_SIZE: number = 24;
const INPUT_SIZE: number = 17.664;
// Web `.tv-search-prompt`: 13.824 px soft ink at y=303, 282 wide.
const PROMPT_TOP: number = 303;
const PROMPT_WIDTH: number = 282;
const PROMPT_SIZE: number = 13.824;
// Web results grid: 327x184 cards from (826, 173), 353 column pitch, 251 row pitch.
const RESULTS_LEFT: number = 826;
const RESULTS_TOP: number = 173;
const CARD_WIDTH: number = 327;
const CARD_HEIGHT: number = 184;
const COLUMN_GAP: number = 26;
const ROW_GAP: number = 38;
const COLUMNS: number = 3;
// Web empty state: a 132 px round art with the pink search glyph, then the message.
const EMPTY_LEFT: number = 1163;
const EMPTY_TOP: number = 312;
const EMPTY_ART_SIZE: number = 132;
const EMPTY_GLYPH_SIZE: number = 54;
const EMPTY_TEXT_SIZE: number = 16.896;
const EMPTY_GAP: number = 42;
const SEARCH_DEBOUNCE_MS: number = 300;
// Web `.tv-search-preview`: the selected result's copy under the form, 154 wide column from y=287.
const PREVIEW_TOP: number = 287;
const PREVIEW_WIDTH: number = 420;
const CLEAR_SIZE: number = 12.288;

function kindLabel(work: Work): string {
  if (work.kind === 'movie') {
    return t('pages.home.workKind.movie', 'Movie');
  }
  if (work.kind === 'series') {
    return t('pages.home.workKind.series', 'Series');
  }
  return work.kind === 'artist' ? t('pages.home.workKind.artist', 'Artist') : 'Title';
}

function resultYear(work: Work): string {
  return work.release_date !== null && work.release_date.length >= 4 ? work.release_date.slice(0, 4) : '';
}

function resultCaption(work: Work): string {
  const year = resultYear(work);
  return year.length > 0 ? `${kindLabel(work)} · ${year}` : kindLabel(work);
}

@Component
struct SearchResultCard {
  work: Work | undefined = undefined;
  /** Web `WatchStateOverlay` (`core/WatchState.ts`). */
  @Prop unseen: boolean = false;
  @Prop progress: number = -1;
  /** Phone: the card's width in vp (one column across the page); 0 on the TV. */
  touchWidth: number = 0;
  onSelect: (workId: string) => void = () => {};
  /** The card took focus: the preview panel follows it (web `selectedId`). */
  onFocused: (workId: string) => void = () => {};
  /** Holding OK on the card (web's long-press menu). */
  onLongPress: (work: Work) => void = () => {};

  @State private artwork: image.PixelMap | undefined = undefined;

  aboutToAppear(): void {
    this.loadArtwork();
  }

  private async loadArtwork(): Promise<void> {
    if (this.work === undefined) {
      return;
    }
    const result = await fetchWorkArtworkByPriority(this.work.id, LANDSCAPE_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      this.artwork = result.value;
    }
  }

  build() {
    PosterCard({
      artwork: this.artwork,
      cardWidth: this.touchWidth > 0 ? this.touchWidth : tv(CARD_WIDTH),
      cardHeight: this.touchWidth > 0 ? this.touchWidth * CARD_HEIGHT / CARD_WIDTH : tv(CARD_HEIGHT),
      title: this.work !== undefined ? this.work.title : '',
      subtitle: this.work !== undefined ? resultCaption(this.work) : '',
      unseen: this.unseen,
      progress: this.progress,
      onSelect: () => {
        if (this.work !== undefined) {
          this.onSelect(this.work.id);
        }
      },
      onFocused: () => {
        if (this.work !== undefined) {
          this.onFocused(this.work.id);
        }
      },
      onLongPress: () => {
        if (this.work !== undefined) {
          this.onLongPress(this.work);
        }
      },
    })
  }
}

@Component
export struct SearchScreen {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private query: string = '';
  @State private results: Work[] = [];
  @State private searched: boolean = false;
  /** Web's Type filter (Filters drawer): 'all' or a work kind. */
  @State private mediaType: string = 'all';
  @State private availableKinds: string[] = [];
  @State private touchWidthVp: number = 328;
  @State private filtersOpen: boolean = false;
  /** The title whose long-press actions are open, or undefined. */
  @State private actionsWork: Work | undefined = undefined;
  /** The result whose details the left panel shows: the focused card, else the first (web `selectedWork`). */
  @State private selectedId: string = '';
  @State private watchIndex: Map<string, WatchProgress> = new Map<string, WatchProgress>();
  @State private watchLoaded: boolean = false;
  private debounce: number = -1;
  /** Only the latest search may set results (an earlier, slower one must not overwrite them). */
  private searchSerial: number = 0;

  aboutToAppear(): void {
    this.loadNav();
    this.loadWatchProgress();
  }

  /** Web Search: the watch list once; until it loads, results draw no marks. */
  private async loadWatchProgress(): Promise<void> {
    const result = await listWatchProgress();
    if (result.kind === 'ok') {
      this.watchIndex = indexWatchProgressByWork(result.value);
      this.watchLoaded = true;
    }
  }

  private markFor(work: Work): WatchMark {
    return watchMarkFor(this.watchIndex.get(work.id), this.watchLoaded);
  }

  aboutToDisappear(): void {
    clearTimeout(this.debounce);
  }

  /** The kinds the server has, for the Type filter (the shell loads its own nav). */
  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.availableKinds = kinds.kind === 'ok' ? kinds.value : [];
  }

  private onQueryChange(value: string): void {
    this.query = value;
    clearTimeout(this.debounce);
    this.debounce = setTimeout((): void => {
      this.runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(value: string): Promise<void> {
    const serial = ++this.searchSerial;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.results = [];
      this.searched = false;
      return;
    }
    const result = await searchCatalog(trimmed);
    if (serial !== this.searchSerial) {
      return;
    }
    this.results = result.kind === 'ok' ? result.value.items : [];
    this.searched = true;
  }

  /** The results that pass the Type filter. */
  private shownResults(): Work[] {
    return this.results.filter((work: Work): boolean => workMatchesType(work.kind, this.mediaType));
  }

  private previewWork(): Work | undefined {
    const shown = this.shownResults();
    for (const work of shown) {
      if (work.id === this.selectedId) {
        return work;
      }
    }
    return shown.length > 0 ? shown[0] : undefined;
  }

  private previewMeta(work: Work): string[] {
    const parts: string[] = [];
    const year = resultYear(work);
    if (year.length > 0) {
      parts.push(year);
    }
    parts.push(work.genres.length > 0 ? work.genres.slice(0, 2).join(' · ') : t('pages.search.availableToPlay', 'Available to play'));
    return [parts.join('    ')];
  }

  private openDetail(workId: string): void {
    const params: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  @Builder
  private emptyState(message: string): void {
    Row({ space: tv(EMPTY_GAP) }) {
      Stack() {
        Image($r('app.media.nav_search'))
          .width(tv(EMPTY_GLYPH_SIZE))
          .height(tv(EMPTY_GLYPH_SIZE))
          .colorFilter(tintFilter(BRAND_PINK))
      }
      .width(tv(EMPTY_ART_SIZE))
      .height(tv(EMPTY_ART_SIZE))
      .borderRadius(tv(EMPTY_ART_SIZE / 2))
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.54))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.115) })
      Text(message).fontFamily(nunito(500))
        .fontSize(tv(EMPTY_TEXT_SIZE))
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColor(activeColors().ink))
    }
    .alignItems(VerticalAlign.Center)
    .position({ x: tv(EMPTY_LEFT), y: tv(EMPTY_TOP) })
  }

  @Builder
  private filtersBody(): void {
    ChoiceSegments({
      heading: 'Type',
      choices: searchTypeChoices(this.availableKinds),
      selected: this.mediaType,
      onChoose: (value: string): void => {
        this.mediaType = value;
      },
    })
  }

  @Builder
  private resultsGrid(): void {
    Grid() {
      ForEach(this.shownResults(), (work: Work) => {
        GridItem() {
          SearchResultCard({
            work: work,
            unseen: this.markFor(work).unseen,
            progress: this.markFor(work).progress,
            onSelect: (workId: string) => {
              this.openDetail(workId);
            },
            onFocused: (workId: string) => {
              this.selectedId = workId;
            },
            onLongPress: (pressed: Work) => {
              this.actionsWork = pressed;
            },
          })
        }
      }, (work: Work): string => work.id)
    }
    .columnsTemplate('1fr 1fr 1fr')
    .columnsGap(tv(COLUMN_GAP))
    .rowsGap(tv(ROW_GAP))
    .width(tv(CARD_WIDTH * COLUMNS + COLUMN_GAP * (COLUMNS - 1)))
    .height('100%')
    .padding({ top: tv(RESULTS_TOP), bottom: tv(RESULTS_TOP) })
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .position({ x: tv(RESULTS_LEFT), y: 0 })
  }

  @Builder
  private pageContent(): void {
    if (this.shownResults().length > 0) {
      this.resultsGrid()
    } else {
      this.emptyState(this.searched ? t('pages.search.noResultsTitle', 'No matching titles or playlists.') : t('pages.search.idleTitle', 'Start typing to search.'))
    }
    Row({ space: tv(12) }) {
      Image($r('app.media.nav_search'))
        .width(tv(ICON_SIZE))
        .height(tv(ICON_SIZE))
        .colorFilter(tintFilter(activeColors().inkSoft))
      TextInput({ text: this.query, placeholder: 'Search your libraries and playlists' })
        .fontSize(tv(INPUT_SIZE))
        .fontColor(toResourceColor(activeColors().ink))
        .placeholderColor(toResourceColor(activeColors().inkMuted))
        .backgroundColor(Color.Transparent)
        // The pill is the field (web): no inner box or focus border on the input itself.
        .border({ width: 0 })
        .borderRadius(0)
        .padding(0)
        .caretColor(toResourceColor(activeColors().ink))
        .layoutWeight(1)
        .defaultFocus(true)
        .onChange((value: string) => {
          this.onQueryChange(value);
        })
      if (this.query.length > 0) {
        Text(t('pages.search.clear', 'Clear')).fontFamily(nunito(700))
          .fontSize(tv(CLEAR_SIZE))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .focusable(true)
          .onClick(() => {
            this.onQueryChange('');
          })
      }
    }
    .width(tv(FORM_WIDTH))
    .height(tv(FORM_HEIGHT))
    .padding({ left: tv(FORM_PADDING_LEFT), right: tv(FORM_PADDING_LEFT) })
    .borderRadius(tv(FORM_HEIGHT / 2))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, FORM_BG_ALPHA))
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.176) })
    .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(FORM_TOP) })
    ActionTile({
      icon: $r('app.media.action_filters'),
      label: t('pages.search.filters', 'Filters'),
      slot: 0,
      onActivate: (): void => {
        this.filtersOpen = true;
      },
    })
    if (this.actionsWork !== undefined) {
      TitleActionsDrawer({
        workId: this.actionsWork.id,
        workTitle: this.actionsWork.title,
        onClose: (): void => {
          this.actionsWork = undefined;
        },
        onPlay: (workId: string): void => {
          this.openDetail(workId);
        },
        onWatchedChanged: (): void => {
          this.loadWatchProgress();
        },
      })
    } else if (this.filtersOpen) {
      Drawer({
        kicker: 'Search controls',
        title: t('pages.search.filters', 'Filters'),
        onClose: (): void => {
          this.filtersOpen = false;
        },
        body: (): void => {
          this.filtersBody();
        },
      })
    }
    if (this.previewWork() !== undefined) {
      // Web `.tv-search-preview`: the selected result's kind and year, title, meta and overview.
      FeatureCopy({
        kicker: resultCaption(this.previewWork() as Work),
        title: (this.previewWork() as Work).title,
        metaLines: this.previewMeta(this.previewWork() as Work),
        synopsis: (this.previewWork() as Work).overview !== null ? ((this.previewWork() as Work).overview as string) : 'No synopsis available.',
      })
        .width(tv(PREVIEW_WIDTH))
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(PREVIEW_TOP) })
    } else {
      Text(t('pages.search.emptyPrompt', 'Find any available movie, series, artist or playlist.')).fontFamily(nunito(400))
        .fontSize(tv(PROMPT_SIZE))
        .fontColor(toResourceColor(activeColors().inkSoft))
        .width(tv(PROMPT_WIDTH))
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(PROMPT_TOP) })
    }
  }

  @Builder
  private touchFiltersButton(): void {
    TouchIconButton({
      icon: $r('app.media.action_filters'),
      onTap: (): void => {
        this.filtersOpen = true;
      },
    })
  }

  /** Phone: the search pill, then the results in one column (or the prompt). */
  @Builder
  private touchContentBody(): void {
    Column({ space: 16 }) {
      Row({ space: 12 }) {
        Image($r('app.media.nav_search'))
          .width(20)
          .height(20)
          .colorFilter(tintFilter(activeColors().inkSoft))
        TextInput({ text: this.query, placeholder: 'Search your libraries and playlists' })
          .fontSize(16)
          .fontColor(toResourceColor(activeColors().ink))
          .placeholderColor(toResourceColor(activeColors().inkMuted))
          .backgroundColor(Color.Transparent)
          .border({ width: 0 })
          .borderRadius(0)
          .padding(0)
          .caretColor(toResourceColor(activeColors().ink))
          .layoutWeight(1)
          .onChange((value: string) => {
            this.onQueryChange(value);
          })
      }
      .width('100%')
      .height(56)
      .padding({ left: 20, right: 20 })
      .borderRadius(28)
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, FORM_BG_ALPHA))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.176) })
      if (this.shownResults().length > 0) {
        Grid() {
          ForEach(this.shownResults(), (work: Work) => {
            GridItem() {
              SearchResultCard({
                work: work,
                touchWidth: this.touchWidthVp,
                unseen: this.markFor(work).unseen,
                progress: this.markFor(work).progress,
                onSelect: (workId: string) => {
                  this.openDetail(workId);
                },
                onLongPress: (pressed: Work) => {
                  this.actionsWork = pressed;
                },
              })
            }
          }, (work: Work): string => work.id)
        }
        .columnsTemplate('1fr')
        .rowsGap(20)
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.None)
        .onAreaChange((_old: Area, area: Area) => {
          this.touchWidthVp = Number(area.width);
        })
      } else {
        Row({ space: 20 }) {
          Stack() {
            Image($r('app.media.nav_search'))
              .width(30)
              .height(30)
              .colorFilter(tintFilter(BRAND_PINK))
          }
          .width(72)
          .height(72)
          .borderRadius(36)
          .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.54))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.115) })
          Text(this.searched ? t('pages.search.noResultsTitle', 'No matching titles or playlists.') : t('pages.search.idleTitle', 'Start typing to search.')).fontFamily(nunito(500))
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(toResourceColor(activeColors().ink))
        }
        .padding({ top: 12 })
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private touchActionsOverlay(): void {
    if (this.actionsWork !== undefined) {
      TitleActionsDrawer({
        workId: this.actionsWork.id,
        workTitle: this.actionsWork.title,
        onClose: (): void => {
          this.actionsWork = undefined;
        },
        onPlay: (workId: string): void => {
          this.openDetail(workId);
        },
        onWatchedChanged: (): void => {
          this.loadWatchProgress();
        },
      })
    }
  }

  @Builder
  private touchFiltersOverlay(): void {
    if (this.filtersOpen && this.actionsWork === undefined) {
      Drawer({
        kicker: 'Search controls',
        title: t('pages.search.filters', 'Filters'),
        onClose: (): void => {
          this.filtersOpen = false;
        },
        body: (): void => {
          this.filtersBody();
        },
      })
    }
  }

  build() {
    NavDestination() {
      Stack() {
      PageShell({
        title: t('pages.search.title', 'Search'),
        touch: true,
        touchContent: (): void => {
          this.touchContentBody();
        },
        touchActions: (): void => {
          this.touchFiltersButton();
        },
        touchOverlay: (): void => {
          this.touchFiltersOverlay();
        },
        touchForegroundOverlay: (): void => {
          this.touchActionsOverlay();
        },
        selectedId: SEARCH_NAV_ID,
        kicker: this.previewWork() !== undefined ? resultCountLabel(this.shownResults().length) : '',
        content: (): void => {
          this.pageContent();
        },
      })
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Search` route's `buildFunction`. */
@Builder
export function SearchBuilder(): void {
  SearchScreen()
}
