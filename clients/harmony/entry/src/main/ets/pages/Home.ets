/**
 * The signed-in home screen (brief section 5.9 "TV stage geometry", section
 * 9 Slice 6 acceptance). Pushed onto the shared `NavPathStack`
 * (`navigation/NavStack.ets`) as the `Home` route (`navigation/Routes.ets`'s
 * `ROUTES.Home`) -- it carries no route parameters, matching that file's own
 * note that Home is one of the five no-parameter routes.
 *
 * ## What this page does
 *
 * Issues, in this order, via `data/CatalogRepository.ets` only (this file
 * never imports `net/`/`auth/` directly, brief section 3.1):
 * 1. `GET /api/v1/playback/progress` (`getContinueWatching()`), hydrated to
 *    up to 10 `part_watched` works.
 * 2. `?kind=movie&sort=recent&limit=12&offset=0`.
 * 3. `?kind=series&sort=recent&limit=12&offset=0`.
 * 4. `?kind=movie&sort=recent&limit=12&offset=12`.
 * 5. `?kind=series&sort=recent&limit=12&offset=12`.
 * 6. `GET /api/v1/catalog/kinds` (`getCatalogKinds()`), driving the nav
 *    destinations (never a hard-coded kind list).
 *
 * These six are fetched CONCURRENTLY (brief risk R14: "a later Home screen
 * issues six rails' worth of concurrent fetches" -- `net/HttpTransport.ets`'s
 * own header comment names this exact count): every `getXxx(...)` call below
 * is invoked and its returned `Promise` captured to a local BEFORE any of
 * them is `await`ed, so every request is already in flight by the time the
 * first `await` below actually suspends this function -- `available_only=true`
 * is attached to every catalogue call by `CatalogRepository.ets` itself, this
 * file never repeats that literal.
 *
 * If every rail (continue-watching plus all four catalogue rails) comes back
 * empty, this page `replaceRoute`s to `ROUTES.Library` rather than rendering
 * a dead page (brief 9's own words), defaulting to the first kind
 * `getCatalogKinds()` reported, or `"movie"` if that call itself failed too.
 * Separately -- and this is a deliberate, documented ADDITION beyond that one
 * line of brief text, not a literal requirement -- if all five of those calls
 * come back as a `network_failure` (a genuine connectivity problem, not
 * merely "the catalogue happens to be empty"), this page shows `AsyncState`'s
 * `Error` state with a retry that re-runs the whole load, rather than
 * silently bouncing to a `Library` screen that would just hit the identical
 * failure again. Both fallbacks read `result.kind` directly (`'ok'` /
 * `'network_failure'` / `'http_failure'`) rather than importing `isApiOk`
 * from `net/ApiResult.ets` -- exactly the "branch structurally, never import
 * the union" discipline `pages/Library.ets`'s own header comment already
 * establishes for this same layering rule.
 *
 * ## Hero (`design/components/Stage.ets`)
 *
 * The hero work is whichever item is FIRST across continue-watching, new
 * movies, new series, more movies, more series, in that order -- i.e. the
 * same item that heads the topmost rendered rail. Its key art is resolved
 * through `data/ArtworkRepository.ets#fetchWorkArtworkByPriority` with
 * `HERO_ARTWORK_PRIORITY` (`[backdrop, poster]`, brief 4.9) and fed to
 * `Stage`'s `keyArt` prop, which this same change widens from `ResourceStr`
 * alone to also accept the resulting `image.PixelMap` -- see that file's own
 * updated doc comment on `keyArt` for why that widening was necessary and
 * safe. As on web TV Home, the hero shows the work's synopsis and there is no
 * play button on the stage: selecting a card opens it.
 *
 * ## Rails (`design/components/MediaRail.ets`) and cards
 * (`design/components/PosterCard.ets`)
 *
 * Card artwork uses `LANDSCAPE_ARTWORK_PRIORITY` (`[backdrop, thumb,
 * poster]`, brief 4.9). Every rail's artwork fetches also run concurrently,
 * fired (not awaited) from `startArtworkLoading()` immediately once the main
 * six-call batch resolves; each card patches its OWN `HomeCardItem` in place
 * (a fresh array, never a mutated one, so `@State` reactivity is guaranteed
 * regardless of `Map`/array mutation-observability nuances the design
 * components elsewhere leave as a documented, unverified assumption) as its
 * own fetch resolves, so a rail's cards reveal their artwork progressively
 * rather than the whole rail waiting on its slowest image.
 *
 * A poster-card tap always pushes `ROUTES.Detail` with `{workId}` (brief 9),
 * on every rail, TV and touch alike.
 *
 * ## Device profile split (brief section 6, 9 Slice 6)
 *
 * TV (`this.deviceProfile.metricsKey === 'tv'`): `Stage` fills the screen,
 * with every non-empty rail stacked into its `railsSlot` (brief 5.9's own
 * `homeRailsColumn*` figures describe a wider, full-height column than
 * `Stage`'s compact glass rail panel -- `Stage.ets`'s own header comment
 * explicitly leaves reconciling the two to "the Home page slice", i.e. this
 * file, and this file's reasoned choice is to place rails inside the rail
 * panel `Stage` already renders, spaced by
 * `TvGeometry.homeRailsColumnRowGap`, the one number brief 5.9 gives for
 * rail-to-rail spacing). `design/components/NavRail.ets` sits as a sibling in
 * the same full-bleed `Stack`, per that file's own "expected to be placed as
 * a sibling of Stage" contract. Up from every card in the TOPMOST rendered
 * rail is wired, via `.nextFocus({ up })`, to that `NavRail`'s first tile
 * (`MediaRail.ets`'s own header comment: this wiring is "the composing
 * screen's job", since `MediaRail` itself has no attribute-chain access to
 * whatever `itemBuilder` renders).
 *
 * Touch: the Web phone backdrop sits behind every non-empty rail stacked in
 * a `Scroll`, with `design/components/TouchNavBar.ets` at the bottom, always
 * visible, rails scrolling underneath it (brief 9's own words for this split).
 *
 * Nothing in this file imports `net/` or `auth/` (brief section 3.1,
 * validator-enforced).
 */

import { loadAppearance } from '../AppContainer';
import { artworkStep, cardGeometry, normaliseArtworkSize } from '../core/ArtworkSize';
import type { ArtworkSizeName, CardGeometry } from '../core/ArtworkSize';
import { image } from '@kit.ImageKit';

import { activeColors, resolvedThemeMode, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { isTvMetrics, tv, TvGeometry, TouchGeometry } from '../design/Metrics';
import { Spacing, Radii } from '../core/Tokens';

import { Stage } from '../design/components/Stage';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import type { NavRailItem } from '../design/components/NavRail';
import { HOME_NAV_ID, buildNavRailItems, navigateFromRail } from '../navigation/NavItems';
import { PageShell } from '../design/components/PageShell';
import { TitleActionsDrawer } from '../design/components/TitleActionsDrawer';
import { TouchNavBar } from '../design/components/TouchNavBar';
import { atLeast } from '../core/SafeInsets';
import { NavPill } from '../design/components/NavPill';
import type { NavPillItem } from '../design/components/NavPill';
import { PosterCard } from '../design/components/PosterCard';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import {
  getContinueWatching,
  getCatalog,
  getCatalogKinds,
  getHomeRails,
} from '../data/CatalogRepository';
import type { ContinueWatchingEntry } from '../data/CatalogRepository';
import { getWorkDetail, listWatchProgress } from '../data/CatalogRepository';
import { indexWatchProgressByWork, watchMarkFor } from '../core/WatchState';
import type { WatchProgress } from '../core/Types/Playback';
import { formatRuntimeLabel } from '../core/RuntimeLabel';
import {
  fetchWorkArtworkByPriority,
  LANDSCAPE_ARTWORK_PRIORITY,
  COVER_ARTWORK_PRIORITY,
  HERO_ARTWORK_PRIORITY,
} from '../data/ArtworkRepository';

import type { DeviceProfile } from '../core/DeviceProfile';
import type { WorkKind } from '../core/Types/Catalog';
import type { Work } from '../core/Types/Work';

import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, LibraryRouteParams } from '../navigation/Routes';
import { normaliseResumeMs } from '../core/EndOfPlayback.ts';
import { getNavStack, pushRoute, replaceRoute } from '../navigation/NavStack';

import { logWarn } from '../util/Log';

const LOG_TAG: string = 'Home';

/** Brief 9, Slice 6: "?kind=movie&sort=recent&limit=12&offset=0 ... then
 * both again at offset=12". */
const RAIL_LIMIT: number = 12;
const RAIL_OFFSET_NEW: number = 0;
const RAIL_OFFSET_MORE: number = 12;

/** Brief 4.8: `getCatalog`'s `sort` field is a plain `string`, `"recent"` is
 * one of its three documented values. */
const SORT_RECENT: string = 'recent';

/** Used when every rail is empty AND `getCatalogKinds()` itself failed (or
 * reported no kinds at all) -- a defensive, documented fallback so the
 * `Library` route this page bounces to always has SOME `kind` to open on. */
const DEFAULT_LIBRARY_FALLBACK_KIND: string = 'movie';


/** Discriminants for "which rail rendered first" -- see `topRailFocusUpId`'s
 * wiring below. Plain string constants rather than an enum: `HomeCardItem`
 * only needs to compare them for equality, never switch exhaustively. */
const TOP_RAIL_CONTINUE_WATCHING: string = 'continueWatching';
const TOP_RAIL_NEW_MOVIES: string = 'newMovies';
const TOP_RAIL_NEW_SERIES: string = 'newSeries';
const TOP_RAIL_MORE_MOVIES: string = 'moreMovies';
const TOP_RAIL_MORE_SERIES: string = 'moreSeries';

/** Brief 5.4's "Touch profile sizes" for a home-rail card's title/subtitle
 * (12/10) -- `design/components/PosterCard.ets`'s own header comment names
 * these as the documented touch override, matching `pages/DesignGallery.ets`'s
 * `touchRailItem` demo exactly. */
const TOUCH_CARD_TITLE_FONT_SIZE: number = 8;
const TOUCH_CARD_SUBTITLE_FONT_SIZE: number = 7;

/** `TouchGeometryTokens` has no dedicated rail-to-rail spacing field (only
 * `railItemGap`, the gap BETWEEN cards inside one rail) -- a reasoned,
 * documented default rather than a brief literal, the same "reuse a token
 * where one is reasonably close" instinct `pages/Library.ets`'s own
 * `TOUCH_GRID_GAP_VP` already follows for an analogous gap brief 5.10 does
 * not name. */
const TOUCH_RAIL_GAP: number = 50;
/** Web phone Home: 328 vp cards (the 360 vp page less 16 each side) and 16 px rail headings. */
/** Where the first heading sits under the dimmed backdrop (web phone Home). */
const TOUCH_RAILS_TOP: number = 94;
/** The touch card's caption block under the art (name and kind line). */
const TOUCH_CARD_CAPTION_HEIGHT: number = 63;
/** Web phone poster card (`--card-w`, `--card-w-cover`): the page less a 16 vp gutter and the 52 vp letter-rail clearance, split into
 * 2 + artwork-size-step columns 12 vp apart. Landscape cards are 16:9, Covers 2:3; the Home screen artwork setting picks which. */
const TOUCH_GUTTER: number = 16;
const TOUCH_RAIL_CLEARANCE: number = 52;
const TOUCH_CARD_GAP: number = 12;
const TOUCH_RAIL_HEADING_SIZE: number = 16;
const TOUCH_RAIL_HEADING_GAP: number = 22;

/** Extra bottom clearance under the touch rails column so the last rail's
 * cards are never obscured by the floating `NavPill` (brief 9: "rails
 * scrolling underneath it"). Derived from `NavPill`'s own footprint --
 * `pages/DesignGallery.ets`'s `NavPill` demo constraint uses the identical
 * `navItemHeight + navPaddingV * 2` base -- plus a further `Spacing.xxl` of
 * breathing room, since this is clearance for SCROLLED-PAST content, not a
 * tight bounding box. */
const TOUCH_BOTTOM_NAV_CLEARANCE: number =
  TouchGeometry.navItemHeight + TouchGeometry.navPaddingV * 2 + Spacing.xxl;

/**
 * This page's own local view-model shape for one rail/hero card (brief
 * section 3.2: "pages/. Presentational + a small local view-model per
 * page."). Satisfies `design/components/MediaRail.ets`'s `MediaRailItem`
 * (`{id: string}`) structurally, per that file's own header comment on why
 * a one-field interface lets any real catalogue item satisfy it with no
 * cast -- this file still casts explicitly (`item as HomeCardItem`) inside
 * `MediaRail`'s `itemBuilder` callback, since that callback's own declared
 * parameter type is the narrower `MediaRailItem`.
 */
interface HomeCardItem {
  id: string;
  kind: WorkKind;
  title: string;
  subtitle: string;
  genres: string[];
  releaseDate: string | null;
  /** The work's synopsis, `''` when the server has none (web shows it in the TV Home hero). */
  overview: string;
  /** Continue-watching fraction in `[0, 1]`, or `-1` to hide the progress
   * bar (`PosterCard.ets`'s own convention). */
  progress: number;
  /** `true` only for every card in whichever rail rendered FIRST -- the TV
   * item builder wires `.nextFocus({ up })` on exactly these cards. */
  applyTopRailFocus: boolean;
  /** `undefined` until `startArtworkLoading()`'s own fetch for this card
   * resolves; `PosterCard` renders a `Skeleton` placeholder meanwhile. */
  artwork: image.PixelMap | undefined;
  /** `'art'` once the artwork is patched in, so the rail rebuilds the card (see `MediaRailItem.stamp`). */
  stamp?: string;
}

/** A card's subtitle: the release year, or `''` (hidden by `PosterCard`)
 * when `releaseDate` is absent or malformed -- the same NaN-guard shape
 * `core/WatchProgressSort.ts#updatedAtMillis` already establishes for a
 * date string that might not parse. */
function releaseYearLabel(releaseDate: string | null): string {
  if (releaseDate === null) {
    return '';
  }
  const parsedMs = new Date(releaseDate).getTime();
  if (Number.isNaN(parsedMs)) {
    return '';
  }
  return String(new Date(releaseDate).getFullYear());
}

/** Web TV card caption: "Movie · 2014" (kind, then release year when known). */
function cardCaption(kind: WorkKind, releaseDate: string | null): string {
  const year = releaseYearLabel(releaseDate);
  return year.length > 0 ? `${workKindKicker(kind)} · ${year}` : workKindKicker(kind);
}

/** The hero kicker: the featured work's OWN kind, singular ("Movie",
 * "Series", ...) -- distinct from the nav label (navigation/NavItems.ets), which names a
 * whole LIBRARY SECTION rather than one work. */
function workKindKicker(kind: WorkKind): string {
  if (kind === 'movie') {
    return 'Movie';
  }
  if (kind === 'series') {
    return 'Series';
  }
  if (kind === 'site') {
    return 'Site';
  }
  if (kind === 'artist') {
    return 'Artist';
  }
  return 'Author';
}

/** One server-curated Home rail (`GET /api/v1/home/rails`), as web TV Home renders it. */
interface HomeServerRail {
  id: string;
  title: string;
  items: HomeCardItem[];
}

/** Builds one rail's card list from a plain catalogue `Work[]` (the new/more
 * movies/series rails). `isTopRail` is decided once, by the caller, for the
 * WHOLE rail -- see `HomeCardItem.applyTopRailFocus`'s own doc comment. */
function buildCardItems(works: Work[], isTopRail: boolean): HomeCardItem[] {
  const result: HomeCardItem[] = [];
  for (const work of works) {
    const item: HomeCardItem = {
      id: work.id,
      kind: work.kind,
      title: work.title,
      subtitle: cardCaption(work.kind, work.release_date),
      genres: work.genres,
      releaseDate: work.release_date,
      overview: work.overview ?? '',
      progress: -1,
      applyTopRailFocus: isTopRail,
      artwork: undefined,
    };
    result.push(item);
  }
  return result;
}

/** Builds the continue-watching rail's card list, computing each card's
 * progress fraction from its own `WatchProgress` row (brief 4.12). */
function buildContinueWatchingCardItems(entries: ContinueWatchingEntry[], isTopRail: boolean): HomeCardItem[] {
  const result: HomeCardItem[] = [];
  for (const entry of entries) {
    const durationMs = entry.progress.duration_ms;
    const fraction = durationMs > 0 ? entry.progress.position_ms / durationMs : 0;
    const item: HomeCardItem = {
      id: entry.work.id,
      kind: entry.work.kind,
      title: entry.work.title,
      subtitle: cardCaption(entry.work.kind, entry.work.release_date),
      genres: entry.work.genres,
      releaseDate: entry.work.release_date,
      overview: entry.work.overview ?? '',
      progress: fraction,
      applyTopRailFocus: isTopRail,
      artwork: undefined,
    };
    result.push(item);
  }
  return result;
}

/** Returns a copy of `item` with `artwork` replaced -- never mutates `item`
 * in place, so reassigning the array/field this came from always changes
 * the `@State` reference and is guaranteed to re-render, regardless of any
 * Map/array mutation-observability assumption. */
function patchOneCardArtwork(item: HomeCardItem, pixelMap: image.PixelMap): HomeCardItem {
  const patched: HomeCardItem = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    genres: item.genres,
    overview: item.overview,
    releaseDate: item.releaseDate,
    progress: item.progress,
    applyTopRailFocus: item.applyTopRailFocus,
    artwork: pixelMap,
    stamp: 'art',
  };
  return patched;
}

/** A rail's ForEach key: `MediaRail` reads its items once, so the rail is rebuilt each time one more card's artwork arrives. */
function railKey(railId: string, items: HomeCardItem[]): string {
  if (isTvMetrics()) {
    return railId; // a rebuild would drop the D-pad focus inside the rail
  }
  let loaded = 0;
  for (const item of items) {
    if (item.stamp !== undefined) {
      loaded += 1;
    }
  }
  return railId + ':' + loaded.toString();
}

/** Returns a fresh array with the one item whose `id === workId` patched via
 * `patchOneCardArtwork`, every other item untouched (same reference). */
function patchCardArtwork(items: HomeCardItem[], workId: string, pixelMap: image.PixelMap): HomeCardItem[] {
  const updated: HomeCardItem[] = [];
  for (const item of items) {
    if (item.id === workId) {
      updated.push(patchOneCardArtwork(item, pixelMap));
    } else {
      updated.push(item);
    }
  }
  return updated;
}

/** `NavRail`'s richer `{id, icon, label}` shape is this page's one canonical
 * nav-item list; `NavPill` only wants `{id, icon}`, derived here on demand
 * rather than kept as separate `@State`. */
function toNavPillItems(items: NavRailItem[]): NavPillItem[] {
  const result: NavPillItem[] = [];
  for (const item of items) {
    const pillItem: NavPillItem = { id: item.id, icon: item.icon };
    result.push(pillItem);
  }
  return result;
}

/** `Stage`'s `keyArt`, resolved from the hero card: the fetched artwork once
 * it resolves, otherwise `Stage`'s own documented placeholder default --
 * computed here, rather than left to `Stage`'s own default parameter, so
 * this page can always pass an explicit, definite value (`Stage.keyArt` is
 * not itself typed to accept `undefined`). */
function heroKeyArtFor(hero: HomeCardItem | undefined): ResourceStr | image.PixelMap {
  if (hero !== undefined && hero.artwork !== undefined) {
    return hero.artwork;
  }
  return '';
}

function heroKickerFor(hero: HomeCardItem | undefined): string {
  if (hero === undefined) {
    return '';
  }
  return hero.genres.length > 0 ? `${workKindKicker(hero.kind)} · ${hero.genres[0]}` : workKindKicker(hero.kind);
}

function heroTitleFor(hero: HomeCardItem | undefined): string {
  if (hero === undefined) {
    return '';
  }
  return hero.title;
}

/** Web's TV Home meta line is the focused work's runtime, shown once its detail has loaded and nothing before. */
function heroMetaLinesFor(runtime: string): string[] {
  return runtime.length > 0 ? [runtime] : [];
}

@Component
export struct Home {
  @StorageProp('safeTop') private safeTop: number = 0;
  @StorageProp('safeBottom') private safeBottom: number = 0;
  @StorageProp('safeLeft') private safeLeft: number = 0;
  @StorageProp('safeRight') private safeRight: number = 0;
  @State private loading: boolean = true;
  @State private showError: boolean = false;
  @State private errorMessage: string = '';

  @State private continueWatchingItems: HomeCardItem[] = [];
  @State private newMovieItems: HomeCardItem[] = [];
  @State private newSeriesItems: HomeCardItem[] = [];
  @State private moreMovieItems: HomeCardItem[] = [];
  @State private moreSeriesItems: HomeCardItem[] = [];
  /** Server rails for the TV Home (web's rails); empty when the call failed, and the TV Home then shows
   * the catalogue rails above instead. */
  @State private serverRails: HomeServerRail[] = [];

  @State private hero: HomeCardItem | undefined = undefined;
  /** The hero's runtime label, from its work detail ('' until it loads), keyed by `heroRuntimeId`. */
  @State private heroRuntime: string = '';
  /** Web Home: the watch list, once; until it loads cards draw no unseen dot. */
  @State private watchIndex: Map<string, WatchProgress> = new Map<string, WatchProgress>();
  @State private watchLoaded: boolean = false;
  private heroRuntimeId: string = '';
  /** Settings > Appearance: Home screen artwork ('thumbnail' or 'cover') and the artwork size. */
  @State private homeView: string = 'thumbnail';
  /** The touch rails' measured width in vp (the card columns derive from it); 360 until the first layout. */
  @State private touchWidthVp: number = 360;
  @State private artworkSize: ArtworkSizeName = 'medium';
  /** Only non-null when `this.hero` came from continue-watching -- see this
   * file's header comment on the hero play button's resume-vs-detail split. */
  @State private heroResumeMediaFileId: string | null = null;
  @State private heroResumeStartPositionMs: number = 0;

  /** `NavRail`/`NavPill`'s shared item list, driven by `getCatalogKinds()`
   * (brief 9), never hard-coded. */
  @State private navItems: NavRailItem[] = [];
  /** The title whose long-press actions are open (web's media context menu), '' for none. */
  @State private actionsWorkId: string = '';
  @State private actionsTitle: string = '';
  /** `'<id>-nav-tile'` for `navItems[0]` once populated, or `''` before that
   * -- see `NavRail.ets`'s own header comment on this exact wiring contract. */
  @State private topRailFocusUpId: string = '';

  // Tracked purely to force a re-render on theme / device-profile / TV-scale
  // change; the actual values always go through design/Theme.ets's and
  // design/Metrics.ets's own resolvers below (see those files' own header
  // comments, and pages/Library.ets's/pages/DesignGallery.ets's identical
  // fields, for this exact pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('deviceProfile') private deviceProfile: DeviceProfile | undefined = undefined;
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  aboutToAppear(): void {
    this.load();
    this.loadWatchMarks();
  }

  private async loadWatchMarks(): Promise<void> {
    const result = await listWatchProgress();
    if (result.kind === 'ok') {
      this.watchIndex = indexWatchProgressByWork(result.value);
      this.watchLoaded = true;
    }
  }

  /** The unseen dot for a card without a progress bar (web `WatchStateOverlay`). */
  private unseenFor(item: HomeCardItem): boolean {
    return item.progress < 0 && watchMarkFor(this.watchIndex.get(item.id), this.watchLoaded).unseen;
  }

  private touchCardWidth(): number {
    const columns = Math.max(1, 2 + artworkStep(this.artworkSize));
    return (this.touchWidthVp - TOUCH_GUTTER - TOUCH_RAIL_CLEARANCE - this.safeRight - TOUCH_CARD_GAP * (columns - 1)) / columns;
  }

  private touchCardHeight(): number {
    const w = this.touchCardWidth();
    return this.homeView === 'cover' ? w * 1.5 : (w * 9) / 16;
  }

  /** Part of the rails' keys: the cards rebuild when the art mode or the card width changes. */
  private touchCardKey(): string {
    return ':' + this.homeView + Math.round(this.touchCardWidth()).toString();
  }

  private touchListHeight(): number {
    return Math.round(this.touchCardHeight()) + TOUCH_CARD_CAPTION_HEIGHT;
  }

  /** The card every rail uses (web `--card-w` / `--card-w-cover`): landscape thumbnails or portrait covers. */
  private card(): CardGeometry {
    return cardGeometry(this.homeView === 'cover', this.artworkSize);
  }

  /** The rail's list height: the landscape rail's, plus the extra height of a taller portrait card. */
  private railListHeight(): number {
    return tv(TvGeometry.homeRailsListHeight + Math.max(0, this.card().height - TvGeometry.libraryGridCardHeight));
  }

  /** Reads the saved appearance; true when it differs from what is showing. */
  private async readAppearance(): Promise<boolean> {
    const stored = await loadAppearance();
    const view = stored[0] === 'cover' ? 'cover' : 'thumbnail';
    const size = normaliseArtworkSize(stored[1]);
    const changed = view !== this.homeView || size !== this.artworkSize;
    this.homeView = view;
    this.artworkSize = size;
    return changed;
  }

  private async load(): Promise<void> {
    const appearanceRead = this.readAppearance();
    this.loading = true;
    this.showError = false;
    this.errorMessage = '';

    // Every call below is invoked (and its Promise captured) before any of
    // them is awaited, so all six requests are already in flight together --
    // see this file's own header comment and brief risk R14.
    const continueWatchingPromise = getContinueWatching();
    const newMoviesPromise = getCatalog({ kind: 'movie', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_NEW });
    const newSeriesPromise = getCatalog({ kind: 'series', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_NEW });
    const moreMoviesPromise = getCatalog({ kind: 'movie', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_MORE });
    const moreSeriesPromise = getCatalog({ kind: 'series', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_MORE });
    const kindsPromise = getCatalogKinds();
    const homeRailsPromise = getHomeRails();

    const continueWatchingResult = await continueWatchingPromise;
    const newMoviesResult = await newMoviesPromise;
    const newSeriesResult = await newSeriesPromise;
    const moreMoviesResult = await moreMoviesPromise;
    const moreSeriesResult = await moreSeriesPromise;
    const kindsResult = await kindsPromise;
    const homeRailsResult = await homeRailsPromise;

    // A genuine connectivity failure across every rail-shaped call -- see
    // this file's header comment on why this is a distinct, deliberate
    // ADDITION beyond the plain "empty rails fall back to Library" rule.
    // Checked as one compound condition (not stored in an intermediate
    // boolean first) so TypeScript keeps `continueWatchingResult` narrowed
    // to its network-failure shape for the `.message` read just below.
    if (
      continueWatchingResult.kind === 'network_failure' &&
      newMoviesResult.kind === 'network_failure' &&
      newSeriesResult.kind === 'network_failure' &&
      moreMoviesResult.kind === 'network_failure' &&
      moreSeriesResult.kind === 'network_failure'
    ) {
      logWarn(LOG_TAG, 'every Home rail fetch failed: ' + continueWatchingResult.message);
      this.loading = false;
      this.showError = true;
      this.errorMessage = continueWatchingResult.message;
      return;
    }

    const continueWatchingEntries: ContinueWatchingEntry[] =
      continueWatchingResult.kind === 'ok' ? continueWatchingResult.value : [];
    const newMovieWorks: Work[] = newMoviesResult.kind === 'ok' ? newMoviesResult.value.items : [];
    const newSeriesWorks: Work[] = newSeriesResult.kind === 'ok' ? newSeriesResult.value.items : [];
    const moreMovieWorks: Work[] = moreMoviesResult.kind === 'ok' ? moreMoviesResult.value.items : [];
    const moreSeriesWorks: Work[] = moreSeriesResult.kind === 'ok' ? moreSeriesResult.value.items : [];

    const navRailItems: NavRailItem[] = buildNavRailItems(kindsResult.kind === 'ok' ? kindsResult.value : []);
    this.navItems = navRailItems;
    const firstNavItem = navRailItems[0];
    this.topRailFocusUpId = firstNavItem !== undefined ? `${firstNavItem.id}-nav-tile` : '';

    const totalCount =
      continueWatchingEntries.length +
      newMovieWorks.length +
      newSeriesWorks.length +
      moreMovieWorks.length +
      moreSeriesWorks.length;

    if (totalCount === 0) {
      // Brief 9: "If every rail comes back empty, fall back to the Library
      // route rather than showing a dead page."
      let fallbackKind: string = DEFAULT_LIBRARY_FALLBACK_KIND;
      if (kindsResult.kind === 'ok') {
        const firstKind = kindsResult.value[0];
        if (firstKind !== undefined) {
          fallbackKind = firstKind;
        }
      }
      const libraryParams: LibraryRouteParams = { kind: fallbackKind };
      replaceRoute(getNavStack(), ROUTES.Library, libraryParams);
      return;
    }

    let topRailKey: string = '';
    if (continueWatchingEntries.length > 0) {
      topRailKey = TOP_RAIL_CONTINUE_WATCHING;
    } else if (newMovieWorks.length > 0) {
      topRailKey = TOP_RAIL_NEW_MOVIES;
    } else if (newSeriesWorks.length > 0) {
      topRailKey = TOP_RAIL_NEW_SERIES;
    } else if (moreMovieWorks.length > 0) {
      topRailKey = TOP_RAIL_MORE_MOVIES;
    } else if (moreSeriesWorks.length > 0) {
      topRailKey = TOP_RAIL_MORE_SERIES;
    }

    this.continueWatchingItems = buildContinueWatchingCardItems(
      continueWatchingEntries,
      topRailKey === TOP_RAIL_CONTINUE_WATCHING
    );
    this.newMovieItems = buildCardItems(newMovieWorks, topRailKey === TOP_RAIL_NEW_MOVIES);
    this.newSeriesItems = buildCardItems(newSeriesWorks, topRailKey === TOP_RAIL_NEW_SERIES);
    this.moreMovieItems = buildCardItems(moreMovieWorks, topRailKey === TOP_RAIL_MORE_MOVIES);
    this.moreSeriesItems = buildCardItems(moreSeriesWorks, topRailKey === TOP_RAIL_MORE_SERIES);
    const serverRails: HomeServerRail[] = [];
    if (homeRailsResult.kind === 'ok') {
      for (const rail of homeRailsResult.value.rails) {
        if (rail.items.length > 0) {
          // The first server rail carries the up-focus wiring when there is no On deck rail above it.
          const isTopRail = continueWatchingEntries.length === 0 && serverRails.length === 0;
          serverRails.push({ id: rail.id, title: rail.title, items: buildCardItems(rail.items, isTopRail) });
        }
      }
    }
    this.serverRails = serverRails;

    this.hero =
      this.continueWatchingItems[0] ??
      this.newMovieItems[0] ??
      this.newSeriesItems[0] ??
      this.moreMovieItems[0] ??
      this.moreSeriesItems[0];

    if (continueWatchingEntries.length > 0) {
      const firstEntry = continueWatchingEntries[0];
      if (firstEntry !== undefined) {
        this.heroResumeMediaFileId = firstEntry.progress.media_file_id;
        this.heroResumeStartPositionMs = normaliseResumeMs(
          firstEntry.progress.position_ms,
          firstEntry.progress.duration_ms
        );
      }
    } else {
      this.heroResumeMediaFileId = null;
      this.heroResumeStartPositionMs = 0;
    }

    await appearanceRead;
    this.loading = false;
    this.showError = false;

    this.startArtworkLoading();
  }

  /** Fires every card's (and the hero's) artwork fetch concurrently, without
   * awaiting any of them here -- each one patches its own `HomeCardItem`
   * (never the others) the moment it resolves. See this file's header
   * comment. */
  private startArtworkLoading(): void {
    const hero = this.hero;
    if (hero !== undefined) {
      this.loadHeroArtwork(hero.id);
      this.loadHeroRuntime(hero.id);
    }
    for (const rail of this.serverRails) {
      const railId = rail.id;
      this.loadRailArtwork(
        (): HomeCardItem[] => this.serverRailItems(railId),
        (items: HomeCardItem[]): void => {
          this.serverRails = this.serverRails.map((current: HomeServerRail): HomeServerRail =>
            current.id === railId ? { id: current.id, title: current.title, items: items } : current);
        }
      );
    }
    this.loadRailArtwork(
      (): HomeCardItem[] => this.continueWatchingItems,
      (items: HomeCardItem[]): void => {
        this.continueWatchingItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.newMovieItems,
      (items: HomeCardItem[]): void => {
        this.newMovieItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.newSeriesItems,
      (items: HomeCardItem[]): void => {
        this.newSeriesItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.moreMovieItems,
      (items: HomeCardItem[]): void => {
        this.moreMovieItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.moreSeriesItems,
      (items: HomeCardItem[]): void => {
        this.moreSeriesItems = items;
      }
    );
  }

  /** Kicks off one concurrent fetch per item currently in `getItems()`, each
   * patching (via `setItems`) whichever array is CURRENT at the moment IT
   * resolves -- never a stale snapshot, since `getOneCardArtwork` re-reads
   * `getItems()` fresh inside its own (single, synchronous-until-`await`)
   * continuation. */
  private serverRailItems(railId: string): HomeCardItem[] {
    const rail = this.serverRails.find((candidate: HomeServerRail): boolean => candidate.id === railId);
    return rail !== undefined ? rail.items : [];
  }

  private loadRailArtwork(getItems: () => HomeCardItem[], setItems: (items: HomeCardItem[]) => void): void {
    const items = getItems();
    for (const item of items) {
      this.loadOneCardArtwork(item.id, getItems, setItems);
    }
  }

  private async loadOneCardArtwork(
    workId: string,
    getItems: () => HomeCardItem[],
    setItems: (items: HomeCardItem[]) => void
  ): Promise<void> {
    const result = await fetchWorkArtworkByPriority(workId, this.homeView === 'cover' ? COVER_ARTWORK_PRIORITY : LANDSCAPE_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      setItems(patchCardArtwork(getItems(), workId, result.value));
    }
    // A failure (including the normal "no artwork of any priority kind" 404)
    // is left alone -- PosterCard already renders a Skeleton placeholder
    // whenever a card's `artwork` stays `undefined`.
  }

  private async loadHeroRuntime(workId: string): Promise<void> {
    this.heroRuntimeId = workId;
    this.heroRuntime = '';
    const result = await getWorkDetail(workId);
    if (result.kind === 'ok' && this.heroRuntimeId === workId) {
      this.heroRuntime = formatRuntimeLabel(result.value.runtime_ms ?? null);
    }
  }

  private async loadHeroArtwork(workId: string): Promise<void> {
    const result = await fetchWorkArtworkByPriority(workId, HERO_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      const current = this.hero;
      if (current !== undefined && current.id === workId) {
        this.hero = patchOneCardArtwork(current, result.value);
      }
    }
  }

  /** Web TV Home: the hero shows the focused card's work. */
  private focusHero(item: HomeCardItem): void {
    if (this.hero !== undefined && this.hero.id === item.id) {
      return;
    }
    this.hero = item;
    this.loadHeroArtwork(item.id);
    this.loadHeroRuntime(item.id);
  }

  private openDetail(workId: string): void {
    const detailParams: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, detailParams);
  }

  private handleNavSelect(id: string): void {
    navigateFromRail(id, HOME_NAV_ID);
  }


  /** TV-profile card content: `PosterCard` sized from its own TV default
   * (brief 5.10's home-rail landscape width). Wires `.nextFocus({ up })` on
   * every card of whichever rail rendered first -- see
   * `HomeCardItem.applyTopRailFocus`'s own doc comment and this file's header
   * comment. Duplicating the `PosterCard({...})` call across the `if`/`else`
   * is unavoidable: ArkUI's declarative attribute chaining has no
   * conditional form, only a conditional CHOICE of which chain to render
   * (the same constraint `design/components/PosterCard.ets`'s own
   * `if (this.artwork !== undefined)` branch works within, one level up). */
  @Builder
  private tvCardItemBuilder(item: MediaRailItem, index: number, activeRailFactor: number): void {

    if (((item as HomeCardItem).applyTopRailFocus) && this.topRailFocusUpId.length > 0) {
      PosterCard({
        variant: 'home',
        cardWidth: tv(this.card().width),
        cardHeight: tv(this.card().height),
        title: ((item as HomeCardItem).title),
        subtitle: ((item as HomeCardItem).subtitle),
        progress: ((item as HomeCardItem).progress),
        unseen: this.unseenFor(item as HomeCardItem),
        artwork: ((item as HomeCardItem).artwork),
        activeRailFactor: activeRailFactor,
        onSelect: ((): void => {
      this.openDetail(((item as HomeCardItem).id));
    }),
        onFocused: (): void => {
          this.focusHero(item as HomeCardItem);
        },
        onLongPress: (): void => {
          this.actionsWorkId = ((item as HomeCardItem).id);
          this.actionsTitle = ((item as HomeCardItem).title);
        },
      })
        .nextFocus({ up: this.topRailFocusUpId })
    } else {
      PosterCard({
        variant: 'home',
        cardWidth: tv(this.card().width),
        cardHeight: tv(this.card().height),
        title: ((item as HomeCardItem).title),
        subtitle: ((item as HomeCardItem).subtitle),
        progress: ((item as HomeCardItem).progress),
        unseen: this.unseenFor(item as HomeCardItem),
        artwork: ((item as HomeCardItem).artwork),
        activeRailFactor: activeRailFactor,
        onSelect: ((): void => {
      this.openDetail(((item as HomeCardItem).id));
    }),
        onFocused: (): void => {
          this.focusHero(item as HomeCardItem);
        },
        onLongPress: (): void => {
          this.actionsWorkId = ((item as HomeCardItem).id);
          this.actionsTitle = ((item as HomeCardItem).title);
        },
      })
    }
  }

  /** Touch-profile card content: explicit `TouchGeometry` sizing plus brief
   * 5.4's documented touch title/subtitle overrides, matching
   * `pages/DesignGallery.ets`'s own `touchRailItem` demo exactly. No
   * `.nextFocus()` wiring -- touch has no D-pad "Up escapes to the nav rail"
   * concept, `NavPill` is always visible instead (brief 9). */
  @Builder
  private touchCardItemBuilder(item: MediaRailItem, index: number, activeRailFactor: number): void {

    PosterCard({
      variant: 'home',
      title: (item as HomeCardItem).title,
      subtitle: (item as HomeCardItem).subtitle,
      progress: (item as HomeCardItem).progress,
      artwork: (item as HomeCardItem).artwork,
      unseen: this.unseenFor(item as HomeCardItem),
      cardWidth: this.touchCardWidth(),
      cardHeight: Math.round(this.touchCardHeight()),
      artworkRadius: Radii.homeCardArtworkTouch,
      titleFontSize: TOUCH_CARD_TITLE_FONT_SIZE,
      softCaption: true,
      subtitleFontSize: TOUCH_CARD_SUBTITLE_FONT_SIZE,
      activeRailFactor: activeRailFactor,
      onSelect: ((): void => {
      this.openDetail(((item as HomeCardItem).id));
    }),
    })
  }

  /** `Stage`'s `railsSlot`: every non-empty rail stacked vertically inside
   * the glass rail panel `Stage` already renders, spaced by
   * `TvGeometry.homeRailsColumnRowGap` -- see this file's header comment on
   * reconciling brief 5.9's wider `homeRailsColumn*` figures against
   * `Stage`'s own compact rail-panel geometry. */
  @Builder
  private tvRailsSlot(): void {

    Column({ space: tv(TvGeometry.homeRailsRowGap) }) {
      if (this.continueWatchingItems.length > 0) {
        ForEach([railKey('continue', this.continueWatchingItems)], (_key: string) => {
        MediaRail({
          railId: 'home-continue-watching-tv',
          headingGap: tv(TvGeometry.homeRailsHeadingGap),
          listHeight: this.railListHeight(),
          heading: 'On deck',
          items: this.continueWatchingItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
        }, (key: string): string => key)
      }
      ForEach(this.serverRails, (rail: HomeServerRail) => {
        MediaRail({
          railId: `home-${rail.id}-tv`,
          headingGap: tv(TvGeometry.homeRailsHeadingGap),
          listHeight: this.railListHeight(),
          heading: rail.title,
          items: rail.items,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }, (rail: HomeServerRail): string => railKey(rail.id, rail.items))
      if (this.serverRails.length === 0 && this.newMovieItems.length > 0) {
        MediaRail({
          railId: 'home-new-movies-tv',
          headingGap: tv(TvGeometry.homeRailsHeadingGap),
          listHeight: this.railListHeight(),
          heading: 'New Movies',
          items: this.newMovieItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.serverRails.length === 0 && this.newSeriesItems.length > 0) {
        MediaRail({
          railId: 'home-new-series-tv',
          headingGap: tv(TvGeometry.homeRailsHeadingGap),
          listHeight: this.railListHeight(),
          heading: 'New Series',
          items: this.newSeriesItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.serverRails.length === 0 && this.moreMovieItems.length > 0) {
        MediaRail({
          railId: 'home-more-movies-tv',
          headingGap: tv(TvGeometry.homeRailsHeadingGap),
          listHeight: this.railListHeight(),
          heading: 'More Movies',
          items: this.moreMovieItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.serverRails.length === 0 && this.moreSeriesItems.length > 0) {
        MediaRail({
          railId: 'home-more-series-tv',
          headingGap: tv(TvGeometry.homeRailsHeadingGap),
          listHeight: this.railListHeight(),
          heading: 'More Series',
          items: this.moreSeriesItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** The touch-profile rails column, scrolled underneath the always-visible
   * `NavPill` (brief 9). */
  @Builder
  private touchRailsColumn(): void {

    // Web phone Home: "On deck", then the server's rails (Recently Added in Movies ...), every card as wide as the page less its margins.
    Column({ space: TOUCH_RAIL_GAP }) {
      if (this.continueWatchingItems.length > 0) {
        ForEach([railKey('continue', this.continueWatchingItems) + this.touchCardKey()], (_key: string) => {
        MediaRail({
          railId: 'home-continue-watching-touch',
          heading: 'On deck',
          items: this.continueWatchingItems,
          itemGap: TouchGeometry.railItemGap,
          listHeight: this.touchListHeight(),
          headingSize: TOUCH_RAIL_HEADING_SIZE,
          headingGap: TOUCH_RAIL_HEADING_GAP,
          bleedEnd: atLeast(Spacing.md, this.safeRight),
          allowFocusedOverflow: true,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
        }, (key: string): string => key)
      }
      ForEach(this.serverRails, (rail: HomeServerRail) => {
        MediaRail({
          railId: `home-${rail.id}-touch`,
          heading: rail.title,
          items: rail.items,
          itemGap: TouchGeometry.railItemGap,
          listHeight: this.touchListHeight(),
          headingSize: TOUCH_RAIL_HEADING_SIZE,
          headingGap: TOUCH_RAIL_HEADING_GAP,
          bleedEnd: atLeast(Spacing.md, this.safeRight),
          allowFocusedOverflow: true,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }, (rail: HomeServerRail): string => railKey(rail.id, rail.items) + this.touchCardKey())
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: TOUCH_RAILS_TOP, bottom: TOUCH_BOTTOM_NAV_CLEARANCE, left: atLeast(Spacing.md, this.safeLeft), right: atLeast(Spacing.md, this.safeRight) })
    .onAreaChange((_old: Area, area: Area) => {
      const measured = Number(area.width);
      if (measured > 0 && Math.abs(measured - this.touchWidthVp) > 0.5) {
        this.touchWidthVp = measured;
      }
    })
  }

  /** TV: `Stage` (hero + rails) with `NavRail` as a sibling in one full-bleed
   * `Stack`, matching `pages/DesignGallery.ets`'s own "Stage + NavRail"
   * demo composition exactly. */
  @Builder
  private tvStage(): void {
    Stage({
      keyArt: heroKeyArtFor(this.hero),
      kicker: heroKickerFor(this.hero),
      title: heroTitleFor(this.hero),
      metaLines: heroMetaLinesFor(this.heroRuntime),
      synopsis: this.hero !== undefined ? this.hero.overview : '',
      metaGapAdjust: -4, // web Home: meta 4 vp higher, synopsis 1 vp higher than the Library panel (frames 2026-10-15)
      synopsisGapAdjust: 3,
      railFrost: true,
      railsTopAdjust: this.homeView === 'cover' ? -(this.card().height - TvGeometry.libraryGridCardHeight) / 2 : 0,
      // Arrow wrapper keeps `this` = Home; a bare method reference runs with Stage as `this`.
      railsSlot: (): void => {
        this.tvRailsSlot();
      },
    })
    if (this.actionsWorkId.length > 0) {
      TitleActionsDrawer({
        workId: this.actionsWorkId,
        workTitle: this.actionsTitle,
        onClose: (): void => {
          this.actionsWorkId = '';
        },
        onPlay: (workId: string): void => {
          this.openDetail(workId);
        },
        onWatchedChanged: (): void => {
          this.load();
        },
      })
    }
  }

  /** TV: the shared page shell (rail, logo, clock; Home has no header) around the `Stage` (hero + rails). */
  @Builder
  private tvContent(): void {
    PageShell({
      title: '',
      showHeader: false,
      selectedId: HOME_NAV_ID,
      content: (): void => {
        this.tvStage();
      },
    })
  }

  /** Touch: the full-screen Web backdrop behind a scrollable rails column
   * and the always-visible bottom navigation bar. */
  @Builder
  private touchContent(): void {

    Stack({ alignContent: Alignment.TopStart }) {
      // Web phone Home: show the first title's backdrop through the same
      // phone theme treatment and scrims as `.tv-key-art`. ImageFit.Cover
      // retains ArkUI's centred crop because it exposes no object-position.
      if (this.hero !== undefined && this.hero.artwork !== undefined) {
        Image(this.hero.artwork)
          .width('100%')
          .height('55%')
          .objectFit(ImageFit.Cover)
          .grayscale(1)
          .contrast(resolvedThemeMode() === 'dark' ? 0.82 : 0.88)
          .brightness(resolvedThemeMode() === 'dark' ? 0.6 : 1.1)
          .opacity(resolvedThemeMode() === 'dark' ? 0.72 : 0.42)
          .scale({ x: 1.04, y: 1.04 })
          .draggable(false)
          .focusable(false)
        // The source CSS image mask fades the key art into the page surface.
        Row()
          .width('100%')
          .height('55%')
          .hitTestBehavior(HitTestMode.Transparent)
          .linearGradient({
            angle: 90,
            colors: [
              [toResourceColorWithAlpha(activeColors().surface, 0), 0],
              [toResourceColorWithAlpha(activeColors().surface, 0), 0.72],
              [toResourceColor(activeColors().surface), 1],
            ],
          })
        // Web phone `::after`: bottom fade and a lighter left-to-right scrim.
        Column()
          .width('100%')
          .height('100%')
          .hitTestBehavior(HitTestMode.Transparent)
          .linearGradient({
            angle: 0,
            colors: [
              [toResourceColor(activeColors().surface), 0],
              [toResourceColor(activeColors().surface), 0.46],
              [toResourceColorWithAlpha(activeColors().surface, 0), 0.74],
              [toResourceColorWithAlpha(activeColors().surface, 0), 1],
            ],
          })
        Row()
          .width('100%')
          .height('100%')
          .hitTestBehavior(HitTestMode.Transparent)
          .linearGradient({
            angle: 90,
            colors: [
              [toResourceColorWithAlpha(activeColors().surface, 0.54), 0],
              [toResourceColorWithAlpha(activeColors().surface, 0), 1],
            ],
          })
        // Web phone `.tv-stage-wash`: finish the lower edge over the rails.
        Column()
          .width('100%')
          .height('100%')
          .hitTestBehavior(HitTestMode.Transparent)
          .linearGradient({
            angle: 0,
            colors: [
              [toResourceColor(activeColors().surface), 0],
              [toResourceColor(activeColors().surface), 0.34],
              [toResourceColorWithAlpha(activeColors().surface, 0), 0.68],
              [toResourceColorWithAlpha(activeColors().surface, 0), 1],
            ],
          })
      }
      // Web `.tv-home-rails` starts 58px below the phone top inset and fades
      // to the page surface over its first 8%. Keep this underlay aligned to
      // that viewport without changing the Scroll's content geometry.
      Column() {
        Blank().height(58)
        Column()
          .width('100%')
          .layoutWeight(1)
          .hitTestBehavior(HitTestMode.Transparent)
          .linearGradient({
            angle: 180,
            colors: [
              [toResourceColorWithAlpha(activeColors().surface, 0), 0],
              [toResourceColor(activeColors().surface), 0.08],
              [toResourceColor(activeColors().surface), 1],
            ],
          })
      }
      .width('100%')
      .height('100%')
      .hitTestBehavior(HitTestMode.Transparent)
      Column() {
        Stack({ alignContent: Alignment.TopStart }) {
          Scroll() {
            this.touchRailsColumn()
          }
          .scrollBar(BarState.Off)
          .width('100%')
          .height('100%')
        }
        .width('100%')
        .layoutWeight(1)

        // Web phone shell: the full-width bottom bar, not a floating pill.
        TouchNavBar({ selectedId: HOME_NAV_ID })
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
  }

  build() {

    NavDestination() {
      Stack() {
        if (this.loading) {
          AsyncState({ kind: AsyncStateKind.Loading })
        } else if (this.showError) {
          AsyncState({
            kind: AsyncStateKind.Error,
            message: this.errorMessage,
            retryLabel: 'Retry',
            retry: ((): void => {
      this.load();
    }),
          })
        } else if ((this.deviceProfile !== undefined && this.deviceProfile.metricsKey === 'tv')) {
          this.tvContent()
        } else {
          this.touchContent()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
    .onShown(() => {
      // Back from Settings: a changed Home artwork or size reloads the rails with the right art.
      this.readAppearance().then((changed: boolean): void => {
        if (changed && !this.loading) {
          this.load();
        }
      });
    })
  }
}

/**
 * Registered in `profile/router_map.json` as the `Home` route's
 * `buildFunction`, once the navigation-shell slice adds that row --
 * `pages/Library.ets`'s own header comment and `LibraryBuilder` establish
 * this exact "not yet wired, ready the moment it lands" posture; `Home`
 * carries no route parameters (`navigation/Routes.ets`'s own note), so
 * both builder parameters are unused, kept only to match the fixed
 * two-parameter shape `router_map.json` invokes every `buildFunction` with.
 */
@Builder
export function HomeBuilder(_name: string, _param: Object): void {
  Home()
}
