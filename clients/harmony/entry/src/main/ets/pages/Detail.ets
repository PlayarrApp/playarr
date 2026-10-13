/**
 * Work detail page (brief section 2.5: "Detail.ets -- Work detail: hero,
 * actions, seasons/episodes or albums/tracks, chapters, similar"; brief
 * section 9, Slice 6). Pushed onto the shared `NavPathStack` by name
 * (`navigation/Routes.ets`'s `ROUTES.Detail`) with a `DetailRouteParams`
 * (`{workId}`) -- see `DetailBuilder`, at the bottom of this file, for the
 * exact param-decoding entry point a `router_map.json` row (landed by
 * whichever slice finishes wiring the navigation shell) will target.
 *
 * ## Data flow
 *
 * `data/CatalogRepository.ets#getWorkDetail` fetches the `WorkDetail`; hero
 * art comes from `data/ArtworkRepository.ets#fetchWorkArtworkByPriority`
 * with `HERO_ARTWORK_PRIORITY` (`[backdrop, poster]`, brief 4.9). The
 * externally-tagged `children` union (brief 4.8) is decoded once, in
 * `buildRailsFromChildren`, into a UNIFORM `DetailRail[]` shape this file
 * renders identically regardless of which of the three object variants (or
 * the bare `"Movie"` string) actually came back:
 *
 * - `{"Series": SeasonDetail[]}` (also `WorkKind::Site`, which brief 4.8
 *   says "reuses the Series shape" -- this file never branches on
 *   `work.kind` to decide this, only on the SHAPE of `children`, so Site
 *   falls into this same path for free) -> one rail per season, episodes as
 *   rows.
 * - `{"Artist": AlbumDetail[]}` -> one rail per album, tracks as rows.
 * - `{"Author": BookDetail[]}` -> ONE rail (there is no second nesting level
 *   to split rails by the way seasons/albums have -- each `Book` is already
 *   a leaf/playable row on its own), holding every book as a row. This is
 *   the "simple single-item view" the brief's task framing groups with
 *   Movie: not literally one item, but each row needs no further expansion.
 * - the bare string `"Movie"` -> no rails at all (a Movie's only playable
 *   leaf is the work's own `media_file_id`, already surfaced by the primary
 *   play action).
 *
 * The primary play action resolves via `resolvePrimaryMediaFileId`: the
 * work's own `media_file_id` when present (a Movie's leaf), otherwise the
 * first row across the built rails, in order, that actually has a resolved
 * `media_file_id` (season 1 episode 1 / album 1 track 1 / book 1 -- skipping
 * any leading row that has not synced a file yet, brief 4.8's "be
 * additive-tolerant" extended to "a still-syncing leaf is not fatal, just
 * skip it").
 *
 * Similar titles come from `data/CatalogRepository.ets#getSimilarWorks`,
 * which already folds in the brief-4.8 "404 is normal, fall back to up to 3
 * genre queries" behaviour -- this file calls it exactly once, with no
 * knowledge of that fallback, and renders a trailing rail only when the
 * result is non-empty.
 *
 * ## Artwork
 *
 * Per-row artwork follows the matching web sources: episode rows require a
 * resolved `media_file_id`, then try the server-cached episode still when
 * advertised, its default 30-second media thumbnail, and the series
 * backdrop/poster detail artwork; book rows use their media thumbnail.
 * An album's own cover (`fetchAlbumArtworkByPriority`,
 * `COVER_ARTWORK_PRIORITY`) is fetched ONCE per album and reused for every
 * track row (there is no per-track artwork endpoint, brief 4.9). Every
 * fetch happens AFTER the rail/row skeletons are already on screen (never
 * blocking first paint). Resolved PixelMaps live in a
 * Detail-owned `@Observed` store keyed by stable row ID. Each store update
 * increments its `@Track` revision; row-card children receive the store
 * directly through `@ObjectLink` and read their artwork by row ID, without
 * changing the rail or item keys.
 *
 * ## Layout
 *
 * TV: a full-bleed hero (`TvGeometry.detailBackdropLeftPct`) with a copy
 * column (`FeatureCopy` + primary play action, `detailCopyColumnStart`/
 * `detailCopyColumnTop`/`detailCopyColumnWidthRatio`) and a glass "browser"
 * panel of rails anchored to the trailing edge, vertically centred
 * (`detailBrowserWidthRatio`/`detailBrowserHeightRatio`/`detailBrowserEnd`,
 * brief 5.10's "browser 0.57 x 0.72 at CenterEnd, end 50" -- reproduced here
 * via ordinary flex end-alignment plus a trailing-edge padding rather than
 * absolute-position arithmetic against a percentage-sized panel, since the
 * latter needs the panel's own resolved pixel width up front and ArkUI has
 * no read-back for that inside `build()`). The two full-bleed scrims reuse
 * `Stage.ets`'s own vertical-vignette percentages (`keyArtScrimVerticalFade*`)
 * rather than inventing fresh ones -- brief 5.10's detail row gives only ONE
 * horizontal percentage, no vertical pair of its own, so reusing the
 * already-established Home vignette is a documented, deliberate
 * simplification, not a fabricated number.
 *
 * Touch: a fixed-height hero image with a `Scroll`ed column beneath it,
 * padded per `TouchGeometry.detailListTop`/`detailListBottom` and spaced per
 * `detailListSpacing` (brief 5.10's "LazyColumn top 245, h 16, bottom 112,
 * spacedBy 18" -- `detailListItemHeight` (16) has no single natural anchor
 * in this page's own content shape, since every real row here is a full
 * `PosterCard`, not a plain 16vp text line; it is left unused here rather
 * than forced onto content it was not measured for).
 *
 * ## Layer isolation (brief 3.1, validator-asserted)
 *
 * This file imports only `data/`, `design/`, `core/` and `navigation/` --
 * never `net/` or `auth/`. Every `data/` call already resolves to a
 * `Promise<ApiResult<T>>` (`net/ApiResult.ets`'s shape); this file narrows
 * the result by reading `.kind` directly off the inferred local (`'ok'` /
 * `'network_failure'` / `'http_failure'`) rather than importing
 * `isApiOk`/`ApiResult`/`ApiFailure` from `net/ApiResult.ets` itself, which
 * `checks/arkts.mjs`'s `pages/*.ets must not import from 'net/'` rule would
 * reject outright.
 */

import { image } from '@kit.ImageKit';
import { LengthMetrics } from '@kit.ArkUI';

import { getWorkDetail, getSimilarWorks, getWorkCredits, getResumePlan } from '../data/CatalogRepository';
import { resumeButtonLabel, resumeKicker, resumeTargetFile } from '../core/ResumePlan';
import { hasSeriesResumeTarget, metaChips, planEpisodeTitle, planSynopsis } from '../core/DetailMeta';
import { seriesPhoneActionIds } from '../core/PhoneDetailActions';
import type { SeriesPhoneActionId } from '../core/PhoneDetailActions';
import type { ResumePlan } from '../core/Types/ResumePlan';
import { getMediaChapters, getWatchProgress } from '../data/PlaybackRepository';
import { addToWatchlist, removeFromWatchlist, resolveTitle } from '../data/WatchlistRepository';
import { snapshotFromWork } from '../core/TitleSnapshot';
import { formatRuntimeLabel } from '../core/RuntimeLabel';
import { resumeStartMs } from '../core/PlaybackMath.ts';
import { selectEpisodeArtworkSources } from '../core/EpisodeArtworkSources';
import {
  fetchWorkArtworkByPriority,
  fetchAlbumArtworkByPriority,
  fetchEpisodeArtwork,
  fetchMediaThumbnail,
  HERO_ARTWORK_PRIORITY,
  COVER_ARTWORK_PRIORITY,
} from '../data/ArtworkRepository';

import type {
  WorkDetail,
  WorkChildren,
  WorkChildrenSeries,
  WorkChildrenArtist,
  WorkChildrenAuthor,
  SeasonDetail,
  EpisodeDetail,
  AlbumDetail,
  TrackDetail,
  BookDetail,
  Season,
} from '../core/Types/WorkDetail';
import type { Credit } from '../core/Types/WorkDetail';
import type { MediaChapter } from '../core/Types/Media';
import type { Work, Availability } from '../core/Types/Work';
import type { WorkKind } from '../core/Types/Catalog';

import { FeatureCopy } from '../design/components/FeatureCopy';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import { PosterCard } from '../design/components/PosterCard';
import { PageShell } from '../design/components/PageShell';
import { TitleActionsDrawer } from '../design/components/TitleActionsDrawer';
import { PlaybackOptionsDrawer } from '../design/components/PlaybackOptionsDrawer';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { Skeleton } from '../design/components/Skeleton';

import { BRAND_PINK_SOFT } from '../core/Tokens';
import { activeColors, toResourceColor, toResourceColorWithAlpha, resolvedThemeMode } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, isTvMetrics, TvGeometry, TouchGeometry } from '../design/Metrics';
import { Spacing, Radii } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';
import type { DeviceProfile } from '../core/DeviceProfile';
import { buildSeriesQueue, buildAlbumQueue } from '../core/EndOfPlayback.ts';
import type { QueueItem } from '../core/EndOfPlayback.ts';

import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, PlayerRouteParams } from '../navigation/Routes';
import { getNavStack, popRoute, pushRoute } from '../navigation/NavStack';

// -- UI-only constants (not brief/Tokens.ts literals -- see design/components/
// AsyncState.ets's/Skeleton.ets's own header comments for this documented
// exception pattern) --------------------------------------------------------

const PLAY_BUTTON_HEIGHT_TV: number = 56;
const PLAY_BUTTON_HEIGHT_TOUCH: number = 48;
const PLAY_BUTTON_ICON_SIZE: number = 18;
const PLAY_BUTTON_LABEL_SIZE: number = 16;
const HERO_TOUCH_HEIGHT: number = 340;
/** Phone: where the text block starts (the backdrop's lower part is under it, faded). */
const TOUCH_TEXT_TOP: number = 343;

const PILL_HEIGHT: number = 62;
const PILL_PADDING_X: number = 28;
const PILL_GAP: number = 17;
const PILL_ROW_GAP: number = 14;
const PILL_FILL_ALPHA: number = 0.09;
const COPY_GAP: number = 36;
const BACKDROP_OPACITY: number = 0.09;
const RIGHT_COLUMN_X: number = 882;
const RIGHT_COLUMN_Y: number = 530;
const RIGHT_COLUMN_WIDTH: number = 1038;
const RIGHT_COLUMN_HEIGHT: number = 550;
const RIGHT_COLUMN_GAP: number = 56;
const CHAPTER_CARD_WIDTH: number = 268;
const CHAPTER_CARD_HEIGHT: number = 150;
const CAST_CIRCLE: number = 104;
const CAST_GAP: number = 73;
const CAST_INITIALS_SIZE: number = 36;

/** One cast entry in a rail: the person's name and headshot link (empty for none). */
interface CastRow {
  id: string;
  name: string;
  headshot: string;
}

/** Glass "browser" panel recipe -- brief 5.6 documents this exact glass
 * treatment for the rail panel; not a `core/Tokens.ts` field, matching
 * `design/components/Stage.ets`'s own identical constants (duplicated here
 * rather than imported since they are private to that file). */
const RAIL_PANEL_BLUR_RADIUS: number = 30;
const RAIL_PANEL_SURFACE_OPACITY_LIGHT: number = 0.72;
const RAIL_PANEL_SURFACE_OPACITY_DARK: number = 0.76;
const RAIL_PANEL_HAIRLINE_ALPHA: number = 0.22;
const HAIRLINE_WHITE: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

/** Fraction (0-1) conversion for a literal CSS percentage field, matching
 * `design/components/Stage.ets`'s own identical private helper. */
function pct100(value: number): number {
  return value / 100;
}

// -- Row/rail view models ----------------------------------------------------

@Observed
class DetailArtworkStore {
  @Track revision: number = 0;
  @Track private pixelMaps: Map<string, image.PixelMap> = new Map<string, image.PixelMap>();
  private generation: number = 0;

  beginGeneration(): number {
    this.generation += 1;
    this.pixelMaps.clear();
    this.revision += 1;
    return this.generation;
  }

  isCurrentGeneration(generation: number): boolean {
    return generation === this.generation;
  }

  setArtwork(generation: number, rowId: string, pixelMap: image.PixelMap): void {
    if (!this.isCurrentGeneration(generation)) {
      return;
    }
    this.pixelMaps.set(rowId, pixelMap);
    this.revision += 1;
  }

  setArtworkForRows(generation: number, rowIds: string[], pixelMap: image.PixelMap): void {
    if (!this.isCurrentGeneration(generation)) {
      return;
    }
    for (const rowId of rowIds) {
      this.pixelMaps.set(rowId, pixelMap);
    }
    this.revision += 1;
  }

  getArtwork(rowId: string): image.PixelMap | undefined {
    const revision = this.revision;
    if (revision === 0) {
      return undefined;
    }
    return this.pixelMaps.get(rowId);
  }
}

/**
 * One playable-or-navigable row inside a rail: an episode, a track, a book,
 * or a similar-title. Deliberately ONE shape for all four -- every one of
 * them renders as a `PosterCard` with a title/subtitle/artwork, and differs
 * only in what selecting it does (`mediaFileId` set -> jump straight to
 * Player; `similarWorkId` set -> push another Detail for that work). At
 * most one of the two is ever non-null for a given row.
 */
interface DetailRow {
  id: string;
  title: string;
  subtitle: string;
  mediaFileId: string | null;
  similarWorkId: string | null;
  /** Present only for episode rows; false means no still endpoint is advertised. */
  episodeHasThumb?: boolean;
  /** Where playback starts when the row is a chapter; absent plays from the beginning. */
  startMs?: number;
}

@Component
struct DetailRowArtworkCard {
  @ObjectLink artworkStore: DetailArtworkStore;
  @Prop rowId: string = '';
  @Prop variant: 'home' | 'titleEpisode' = 'titleEpisode';
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop cardWidth: number = 0;
  @Prop cardHeight: number = 0;
  @Prop artworkRadius: number = -1;
  @Prop titleFontSize: number = 11.904;
  @Prop subtitleFontSize: number = 8.832;
  @Prop activeRailFactor: number = 1;

  onSelect: () => void = () => {};

  build() {
    PosterCard({
      variant: this.variant,
      title: this.title,
      subtitle: this.subtitle,
      artwork: this.artworkStore.getArtwork(this.rowId),
      cardWidth: this.cardWidth,
      cardHeight: this.cardHeight,
      artworkRadius: this.artworkRadius,
      titleFontSize: this.titleFontSize,
      subtitleFontSize: this.subtitleFontSize,
      activeRailFactor: this.activeRailFactor,
      onSelect: this.onSelect,
    })
  }
}

/** One season/album/books/similar rail: a heading plus its rows. */
interface DetailRail {
  id: string;
  heading: string;
  items: DetailRow[];
}

function kindLabel(kind: WorkKind): string {
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

function humanizeAvailability(availability: Availability): string {
  if (availability === 'available') {
    return 'Available';
  }
  if (availability === 'partially_available') {
    return 'Partially available';
  }
  if (availability === 'processing') {
    return 'Processing';
  }
  if (availability === 'pending') {
    return 'Pending';
  }
  if (availability === 'deleted') {
    return 'Deleted';
  }
  return 'Availability unknown';
}

function formatYearLabel(releaseDate: string | null): string {
  if (releaseDate === null || releaseDate.length < 4) {
    return '';
  }
  return releaseDate.slice(0, 4);
}

/** FeatureCopy's `metaLines`: a first line of "year - genre - runtime"
 * (whichever parts are present), then a second, muted line carrying the
 * work's cross-peer availability (brief 4.3/4.8). */
function buildMetaLines(detail: WorkDetail): string[] {
  const work = detail.work;
  const parts: string[] = [];

  const year = formatYearLabel(work.release_date);
  if (year.length > 0) {
    parts.push(year);
  }
  if (work.genres.length > 0) {
    parts.push(work.genres[0]);
  }
  const runtime = formatRuntimeLabel(detail.runtime_ms);
  if (runtime.length > 0) {
    parts.push(runtime);
  }

  const lines: string[] = [];
  if (parts.length > 0) {
    lines.push(parts.join(' - '));
  }
  lines.push(humanizeAvailability(work.availability));
  return lines;
}

function episodeMediaFileId(detail: EpisodeDetail): string | null {
  if (detail.media_file_id === undefined || detail.media_file_id === null) {
    return null;
  }
  return detail.media_file_id;
}

function buildEpisodeRow(detail: EpisodeDetail): DetailRow {
  const episode = detail.episode;
  let title = 'Episode ' + String(episode.episode_number);
  if (episode.title !== undefined && episode.title !== null && episode.title.length > 0) {
    title = episode.title;
  }
  const row: DetailRow = {
    id: episode.id,
    title: title,
    subtitle: 'Episode ' + String(episode.episode_number),
    mediaFileId: episodeMediaFileId(detail),
    similarWorkId: null,
    episodeHasThumb: episode.images.some((item): boolean => item.kind === 'thumb'),
  };
  return row;
}

function seasonHeading(season: Season): string {
  if (season.title !== undefined && season.title !== null && season.title.length > 0) {
    return season.title;
  }
  return 'Season ' + String(season.season_number);
}

function buildSeasonRail(detail: SeasonDetail): DetailRail {
  const items: DetailRow[] = [];
  for (const episodeDetail of detail.episodes) {
    const item = buildEpisodeRow(episodeDetail);
    if (item.mediaFileId !== null && item.mediaFileId.length > 0) {
      items.push(item);
    }
  }
  const rail: DetailRail = {
    id: 'season-' + detail.season.id,
    heading: seasonHeading(detail.season),
    items: items,
  };
  return rail;
}

function buildSeasonRails(seasons: SeasonDetail[]): DetailRail[] {
  const rails: DetailRail[] = [];
  for (const season of seasons) {
    rails.push(buildSeasonRail(season));
  }
  return rails;
}

function trackMediaFileId(detail: TrackDetail): string | null {
  if (detail.media_file_id === undefined || detail.media_file_id === null) {
    return null;
  }
  return detail.media_file_id;
}

function buildTrackRow(detail: TrackDetail): DetailRow {
  const track = detail.track;
  const row: DetailRow = {
    id: track.id,
    title: track.title,
    subtitle: 'Track ' + String(track.track_number),
    mediaFileId: trackMediaFileId(detail),
    similarWorkId: null,
  };
  return row;
}

function buildAlbumRail(detail: AlbumDetail): DetailRail {
  const items: DetailRow[] = [];
  for (const trackDetail of detail.tracks) {
    items.push(buildTrackRow(trackDetail));
  }
  const rail: DetailRail = {
    id: 'album-' + detail.album.id,
    heading: detail.album.title,
    items: items,
  };
  return rail;
}

function buildAlbumRails(albums: AlbumDetail[]): DetailRail[] {
  const rails: DetailRail[] = [];
  for (const album of albums) {
    rails.push(buildAlbumRail(album));
  }
  return rails;
}

function bookMediaFileId(detail: BookDetail): string | null {
  if (detail.media_file_id === undefined || detail.media_file_id === null) {
    return null;
  }
  return detail.media_file_id;
}

function buildBookRow(detail: BookDetail): DetailRow {
  const book = detail.book;
  let subtitle = '';
  if (book.series_name !== undefined && book.series_name !== null && book.series_name.length > 0) {
    subtitle = book.series_name;
    if (book.series_position !== undefined && book.series_position !== null) {
      subtitle = subtitle + ' #' + String(book.series_position);
    }
  }
  const row: DetailRow = {
    id: book.id,
    title: book.title,
    subtitle: subtitle,
    mediaFileId: bookMediaFileId(detail),
    similarWorkId: null,
  };
  return row;
}

function buildBooksRail(books: BookDetail[]): DetailRail {
  const items: DetailRow[] = [];
  for (const book of books) {
    items.push(buildBookRow(book));
  }
  const rail: DetailRail = { id: 'books', heading: 'Books', items: items };
  return rail;
}

/**
 * Decodes the brief-4.8 externally-tagged `children` union into a uniform
 * `DetailRail[]` -- see this file's header comment for the exact shape
 * table. Every branch is a plain cast-then-field-check, never `Reflect`/`in`
 * (both awkward or banned for a union that includes a bare string variant),
 * matching `WorkDetail.ts`'s own doc comment on how to tell the variants
 * apart: try the string case first, then probe each object variant's own
 * named field.
 */
function buildRailsFromChildren(children: WorkChildren): DetailRail[] {
  if (typeof children === 'string') {
    return [];
  }

  const asSeries = children as WorkChildrenSeries;
  if (asSeries.Series !== undefined) {
    return buildSeasonRails(asSeries.Series);
  }

  const asArtist = children as WorkChildrenArtist;
  if (asArtist.Artist !== undefined) {
    return buildAlbumRails(asArtist.Artist);
  }

  const asAuthor = children as WorkChildrenAuthor;
  if (asAuthor.Author !== undefined) {
    return [buildBooksRail(asAuthor.Author)];
  }

  return [];
}

/** Walks every rail's rows, in order, returning the first resolved
 * `media_file_id` -- "season 1 episode 1" / "album 1 track 1" / "book 1",
 * skipping any row that has not synced a file yet. */
function firstPlayableFromRails(rails: DetailRail[]): string | null {
  for (const rail of rails) {
    for (const item of rail.items) {
      if (item.mediaFileId !== null) {
        return item.mediaFileId;
      }
    }
  }
  return null;
}

/** The primary play action's target: a Movie's own leaf when present,
 * otherwise the first playable row across the built rails. */
function resolvePrimaryMediaFileId(detail: WorkDetail, rails: DetailRail[]): string | null {
  if (detail.media_file_id !== null) {
    return detail.media_file_id;
  }
  return firstPlayableFromRails(rails);
}

function buildSimilarRail(works: Work[]): DetailRail {
  const items: DetailRow[] = [];
  for (const work of works) {
    const row: DetailRow = {
      id: work.id,
      title: work.title,
      subtitle: kindLabel(work.kind),
      mediaFileId: null,
      similarWorkId: work.id,
    };
    items.push(row);
  }
  const rail: DetailRail = { id: 'similar', heading: 'Similar Titles', items: items };
  return rail;
}

function chapterTimeLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = seconds < 10 ? '0' + seconds.toString() : seconds.toString();
  if (hours > 0) {
    const mm = minutes < 10 ? '0' + minutes.toString() : minutes.toString();
    return hours.toString() + ':' + mm + ':' + ss;
  }
  return minutes.toString() + ':' + ss;
}

/** One chapter card (web Chapters rail): "Chapter 01" (or the chapter's own title) under the card, its start time as the caption. */
function chapterRow(chapter: MediaChapter, mediaFileId: string): DetailRow {
  const number = chapter.index < 9 ? '0' + (chapter.index + 1).toString() : (chapter.index + 1).toString();
  const title = chapter.title !== undefined && chapter.title !== null && chapter.title.length > 0 ? chapter.title : 'Chapter ' + number;
  const row: DetailRow = {
    id: 'chapter-' + chapter.index.toString(),
    title: title,
    subtitle: chapterTimeLabel(chapter.start_ms),
    mediaFileId: mediaFileId,
    similarWorkId: null,
    startMs: chapter.start_ms,
  };
  return row;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(' ').filter((part: string): boolean => part.length > 0);
  if (parts.length === 0) {
    return '';
  }
  const first = parts[0].charAt(0).toUpperCase();
  return parts.length === 1 ? first : first + parts[parts.length - 1].charAt(0).toUpperCase();
}

@Component
struct Detail {
  @Prop workId: string = '';

  // Tracked purely to force a re-render on theme / device-profile / TV-scale
  // change; the actual values always go through design/Theme.ets's and
  // design/Metrics.ets's own resolver functions (see those files' header
  // comments for this exact pattern, already used by every component in
  // this design system).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('deviceProfile') private trackedDeviceProfile: DeviceProfile | undefined = undefined;
  @StorageProp('tvScaleFactor') private trackedTvScaleFactor: number = 1;

  @State private detail: WorkDetail | null = null;
  @State private loadFailed: boolean = false;
  @State private errorMessage: string = '';
  @State private heroArtwork: image.PixelMap | undefined = undefined;
  @State private rails: DetailRail[] = [];
  @State private artworkStore: DetailArtworkStore = new DetailArtworkStore();
  @State private similarRail: DetailRail | null = null;
  @State private primaryMediaFileId: string | null = null;
  @State private chaptersRail: DetailRail | null = null;
  /** A series' resume plan (null for a film, or until the server answers): its target is what the primary button plays. */
  @State private resumePlan: ResumePlan | null = null;
  @State private cast: Credit[] = [];
  @State private actionsOpen: boolean = false;
  /** Phone: the title actions drawer (Download, Add to Playlist, watched marks). */
  @State private touchActionsOpen: boolean = false;
  @State private optionsOpen: boolean = false;
  /** On this profile's watchlist: null until the server has answered. */
  @State private listed: boolean | null = null;
  private watchlistKey: string = '';
  private watchlistBusy: boolean = false;
  /** The saved resume point of a movie's file, 0 when there is none. */
  @State private resumeMs: number = 0;

  aboutToAppear(): void {
    this.loadDetail();
  }

  private async loadDetail(): Promise<void> {
    this.detail = null;
    this.loadFailed = false;
    this.errorMessage = '';
    this.heroArtwork = undefined;
    const artworkGeneration = this.artworkStore.beginGeneration();
    this.rails = [];
    this.similarRail = null;
    this.primaryMediaFileId = null;
    this.chaptersRail = null;
    this.resumePlan = null;
    this.cast = [];
    this.actionsOpen = false;
    this.optionsOpen = false;
    this.listed = null;
    this.watchlistKey = '';
    this.resumeMs = 0;

    const workId = this.workId;
    const detailResult = await getWorkDetail(workId);
    if (!this.artworkStore.isCurrentGeneration(artworkGeneration)) {
      return;
    }
    if (detailResult.kind !== 'ok') {
      this.loadFailed = true;
      if (detailResult.kind === 'network_failure') {
        this.errorMessage = detailResult.message;
      } else if (detailResult.envelope.kind === 'general') {
        this.errorMessage = detailResult.envelope.message;
      } else {
        this.errorMessage = 'Something went wrong loading this title.';
      }
      return;
    }

    const detail = detailResult.value;
    this.detail = detail;

    const rails = buildRailsFromChildren(detail.children);
    this.rails = rails;
    this.primaryMediaFileId = resolvePrimaryMediaFileId(detail, rails);

    if (detail.work.kind === 'series') {
      this.loadResumePlan(detail.work.id);
    }

    const heroArtworkPromise = this.loadHeroArtwork(detail.work.id, artworkGeneration);
    this.hydrateRailArtwork(artworkGeneration, heroArtworkPromise);
    this.loadSimilar(detail.work, artworkGeneration);
    this.loadCredits(detail.work.id);
    this.loadWatchlistState(detail.work);
    if (this.primaryMediaFileId !== null && detail.work.kind === 'movie') {
      this.loadResume(this.primaryMediaFileId);
    }
    if (this.primaryMediaFileId !== null && detail.work.kind === 'movie') {
      this.loadChapters(this.primaryMediaFileId, artworkGeneration);
    }
  }

  private async loadHeroArtwork(workId: string, generation: number): Promise<image.PixelMap | null> {
    const result = await fetchWorkArtworkByPriority(workId, HERO_ARTWORK_PRIORITY);
    if (!this.artworkStore.isCurrentGeneration(generation)) {
      return null;
    }
    if (result.kind === 'ok') {
      this.heroArtwork = result.value;
      return result.value;
    }
    return null;
  }

  /** Fires once per rail: an album cover is shared by its track rows;
   * episode rows try still, media frame, then the shared hero-art promise;
   * book rows use `fetchMediaThumbnail` when their file is resolved. */
  private async hydrateRailArtwork(
    generation: number,
    heroArtworkPromise: Promise<image.PixelMap | null>
  ): Promise<void> {
    const detail = this.detail;
    const artistWorkId = detail !== null ? detail.work.id : '';
    const rails = this.rails;

    for (const rail of rails) {
      if (rail.id.startsWith('album-')) {
        const albumId = rail.id.slice('album-'.length);
        const albumArt = await fetchAlbumArtworkByPriority(artistWorkId, albumId, COVER_ARTWORK_PRIORITY);
        if (!this.artworkStore.isCurrentGeneration(generation)) {
          return;
        }
        if (albumArt.kind === 'ok') {
          const currentRail = this.rails.find((item: DetailRail): boolean => item.id === rail.id);
          if (currentRail !== undefined) {
            const rowIds: string[] = [];
            for (const item of currentRail.items) {
              rowIds.push(item.id);
            }
            this.artworkStore.setArtworkForRows(generation, rowIds, albumArt.value);
          }
        }
        continue;
      }

      for (const item of rail.items) {
        if (item.mediaFileId === null) {
          continue;
        }
        if (item.episodeHasThumb !== undefined && detail !== null) {
          const sources = selectEpisodeArtworkSources({
            mediaFileId: item.mediaFileId,
            hasEpisodeThumb: item.episodeHasThumb,
          });
          for (const source of sources) {
            if (source === 'episode-still') {
              const still = await fetchEpisodeArtwork(detail.work.id, item.id, 'thumb', 540);
              if (!this.artworkStore.isCurrentGeneration(generation)) {
                return;
              }
              if (still.kind === 'ok') {
                this.artworkStore.setArtwork(generation, item.id, still.value);
                break;
              }
              continue;
            }
            if (source === 'media-thumbnail') {
              const frame = await fetchMediaThumbnail(item.mediaFileId);
              if (!this.artworkStore.isCurrentGeneration(generation)) {
                return;
              }
              if (frame.kind === 'ok') {
                this.artworkStore.setArtwork(generation, item.id, frame.value);
                break;
              }
              continue;
            }
            const seriesArtwork = await heroArtworkPromise;
            if (!this.artworkStore.isCurrentGeneration(generation)) {
              return;
            }
            if (seriesArtwork !== null) {
              this.artworkStore.setArtwork(generation, item.id, seriesArtwork);
              break;
            }
          }
          continue;
        }
        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (!this.artworkStore.isCurrentGeneration(generation)) {
          return;
        }
        if (thumb.kind === 'ok') {
          this.artworkStore.setArtwork(generation, item.id, thumb.value);
        }
      }
    }
  }

  /** Whether the title is on the watchlist (web `WatchlistToggle`: resolve the snapshot, the server owns the title key). */
  private async loadWatchlistState(work: Work): Promise<void> {
    const result = await resolveTitle(snapshotFromWork(work));
    if (result.kind === 'ok') {
      this.watchlistKey = result.value.title.title_key;
      this.listed = result.value.in_watchlist === true;
    } else {
      this.listed = false;
    }
  }

  private async toggleWatchlist(): Promise<void> {
    const detail = this.detail;
    if (detail === null || this.watchlistBusy) {
      return;
    }
    this.watchlistBusy = true;
    const snapshot = snapshotFromWork(detail.work);
    if (this.listed === true) {
      let key = this.watchlistKey;
      if (key.length === 0) {
        const resolved = await resolveTitle(snapshot);
        key = resolved.kind === 'ok' ? resolved.value.title.title_key : '';
      }
      if (key.length > 0) {
        const removed = await removeFromWatchlist(key);
        if (removed.kind === 'ok') {
          this.listed = false;
        }
      }
    } else {
      const added = await addToWatchlist(snapshot);
      if (added.kind === 'ok') {
        this.watchlistKey = added.value.title.title_key;
        this.listed = true;
      }
    }
    this.watchlistBusy = false;
  }

  /** A part-watched movie offers "Resume from m:ss" on its primary pill (the player itself resumes from the saved point). */
  private async loadResume(mediaFileId: string): Promise<void> {
    const saved = await getWatchProgress(mediaFileId);
    if (saved.kind === 'ok') {
      this.resumeMs = resumeStartMs(saved.value.state, saved.value.position_ms);
    }
  }

  /** The movie's embedded chapters (web's Chapters rail): one card per chapter, thumbnail taken at its start. */
  private async loadChapters(mediaFileId: string, generation: number): Promise<void> {
    const result = await getMediaChapters(mediaFileId);
    if (!this.artworkStore.isCurrentGeneration(generation)) {
      return;
    }
    if (result.kind !== 'ok' || result.value.length === 0) {
      return;
    }
    const rows: DetailRow[] = [];
    for (const chapter of result.value) {
      rows.push(chapterRow(chapter, mediaFileId));
    }
    this.chaptersRail = { id: 'chapters', heading: 'Chapters', items: rows };
    for (const chapter of result.value) {
      const thumb = await fetchMediaThumbnail(mediaFileId, chapter.start_ms);
      if (!this.artworkStore.isCurrentGeneration(generation)) {
        return;
      }
      const current = this.chaptersRail;
      if (thumb.kind === 'ok' && current !== null) {
        this.artworkStore.setArtwork(generation, 'chapter-' + chapter.index.toString(), thumb.value);
      }
    }
  }

  private async loadCredits(workId: string): Promise<void> {
    const result = await getWorkCredits(workId);
    if (result.kind === 'ok') {
      this.cast = result.value.cast;
    }
  }

  /** Brief 4.8: a 404 here is normal and already handled inside
   * `getSimilarWorks` itself (the genre-query fallback) -- this method only
   * ever sees the final, already-reconciled result. */
  private async loadSimilar(work: Work, generation: number): Promise<void> {
    const result = await getSimilarWorks(work);
    if (!this.artworkStore.isCurrentGeneration(generation)) {
      return;
    }
    if (result.kind !== 'ok' || result.value.length === 0) {
      return;
    }
    this.similarRail = buildSimilarRail(result.value);
    this.hydrateSimilarArtwork(generation);
  }

  private async hydrateSimilarArtwork(generation: number): Promise<void> {
    const rail = this.similarRail;
    if (rail === null) {
      return;
    }
    for (const item of rail.items) {
      if (item.similarWorkId === null) {
        continue;
      }
      const result = await fetchWorkArtworkByPriority(item.similarWorkId, COVER_ARTWORK_PRIORITY);
      if (!this.artworkStore.isCurrentGeneration(generation)) {
        return;
      }
      if (result.kind === 'ok') {
        const current = this.similarRail;
        if (current !== null) {
          this.artworkStore.setArtwork(generation, item.id, result.value);
        }
      }
    }
  }

  /** The primary play action: jumps straight to Player with the resolved
   * `media_file_id` plus this page's own `workId` (`NavStack.ets`'s
   * documented `PlayerRouteParams` shape). A no-op while nothing is
   * playable yet (still loading, or no synced leaf anywhere). */
  private playPrimary(): void {
    const mediaFileId = this.primaryMediaFileId;
    if (mediaFileId === null) {
      return;
    }
    const currentWorkId = this.workId;
    const stack = getNavStack();
    const upNext = this.upNextQueueAfter(mediaFileId);
    const params: PlayerRouteParams = {
      mediaFileId: mediaFileId,
      workId: currentWorkId,
      queue: upNext,
    };
    pushRoute(stack, ROUTES.Player, params);
  }

  /** Playable episodes after `mediaFileId` (series only; empty for movies,
   * albums and books), handed to the Player as its up-next queue. */
  private upNextQueueAfter(mediaFileId: string): QueueItem[] {
    const detail = this.detail;
    if (detail === null || typeof detail.children === 'string') {
      return [];
    }
    const asSeries = detail.children as WorkChildrenSeries;
    if (asSeries.Series !== undefined) {
      return buildSeriesQueue(detail.work.id, detail.work.title, asSeries.Series, mediaFileId);
    }
    const asArtist = detail.children as WorkChildrenArtist;
    if (asArtist.Artist !== undefined) {
      return buildAlbumQueue(detail.work.id, asArtist.Artist, mediaFileId);
    }
    return [];
  }

  /** Dispatches a row selection: a playable leaf jumps to Player, a
   * similar-title row pushes another Detail for that work. A row with
   * neither (an episode/track/book that has not synced a file yet) is a
   * no-op. */
  private selectRow(row: DetailRow): void {
    const stack = getNavStack();
    if (row.mediaFileId !== null) {
      const currentWorkId = this.workId;
      const upNext = this.upNextQueueAfter(row.mediaFileId);
      const params: PlayerRouteParams = {
        mediaFileId: row.mediaFileId,
        workId: currentWorkId,
        queue: upNext,
        startPositionMs: row.startMs,
      };
      pushRoute(stack, ROUTES.Player, params);
      return;
    }
    if (row.similarWorkId !== null) {
      const params: DetailRouteParams = { workId: row.similarWorkId };
      pushRoute(stack, ROUTES.Detail, params);
    }
  }

  private railPanelSurfaceOpacity(): number {
    if (resolvedThemeMode() === 'dark') {
      return RAIL_PANEL_SURFACE_OPACITY_DARK;
    }
    return RAIL_PANEL_SURFACE_OPACITY_LIGHT;
  }

  /** Episode/track/book row content -- brief 5.8's "title/episode" focus
   * delta and shadow pair (`PosterCard`'s `'titleEpisode'` variant). */
  @Builder
  private rowItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    if (isTvMetrics()) {
      DetailRowArtworkCard({
        artworkStore: this.artworkStore,
        rowId: (item as DetailRow).id,
        variant: 'titleEpisode',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        cardWidth: tv(TvGeometry.railPanelCardWidth),
        cardHeight: Math.round((tv(TvGeometry.railPanelCardWidth) * 9) / 16),
        activeRailFactor: activeRailFactor,
        onSelect: () => { this.selectRow((item as DetailRow)); },
      })
    } else {
      DetailRowArtworkCard({
        artworkStore: this.artworkStore,
        rowId: (item as DetailRow).id,
        variant: 'titleEpisode',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        cardWidth: TouchGeometry.homeRailCardWidthLandscape,
        cardHeight: Math.round((TouchGeometry.homeRailCardWidthLandscape * 9) / 16),
        titleFontSize: 12,
        subtitleFontSize: 10,
        activeRailFactor: activeRailFactor,
        onSelect: () => { this.selectRow((item as DetailRow)); },
      })
    }
  }

  /** Similar-title row content -- a cover (2:3) card, matching every other
   * work-poster placement in this design system (brief 4.9's
   * `COVER_ARTWORK_PRIORITY`). */
  @Builder
  private similarItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    if (isTvMetrics()) {
      DetailRowArtworkCard({
        artworkStore: this.artworkStore,
        rowId: (item as DetailRow).id,
        variant: 'home',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        cardWidth: tv(TvGeometry.homeRailCardWidthCover),
        cardHeight: Math.round((tv(TvGeometry.homeRailCardWidthCover) * 3) / 2),
        artworkRadius: Radii.homeCardArtworkTv,
        activeRailFactor: activeRailFactor,
        onSelect: () => { this.selectRow((item as DetailRow)); },
      })
    } else {
      DetailRowArtworkCard({
        artworkStore: this.artworkStore,
        rowId: (item as DetailRow).id,
        variant: 'home',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        cardWidth: TouchGeometry.homeRailCardWidthCover,
        cardHeight: Math.round((TouchGeometry.homeRailCardWidthCover * 3) / 2),
        artworkRadius: Radii.homeCardArtworkTouch,
        titleFontSize: 12,
        subtitleFontSize: 10,
        activeRailFactor: activeRailFactor,
        onSelect: () => { this.selectRow((item as DetailRow)); },
      })
    }
  }

  /** The primary play action: a simple pill (brief 5.8's "primary play
   * action" lift is reproduced via `FocusLift`-free plain opacity/scale
   * here, a deliberately lighter treatment than `Stage.ets`'s own home-hero
   * glass button -- this page's own play action is a labelled pill inside a
   * text copy column, not an icon-only circular affordance floating over
   * full-bleed key art, so re-deriving Stage's exact glass recipe would not
   * fit this different context). Disabled (dimmed, unfocusable) while
   * nothing is resolved to play yet. */
  @Builder
  private playButton(enabled: boolean, height: number): void {

    Row({ space: Spacing.sm }) {
      Text('▶')
        .fontSize(PLAY_BUTTON_ICON_SIZE)
        .fontColor(toResourceColor(activeColors().onAccent))
      Text(this.primaryLabel())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .fontSize(PLAY_BUTTON_LABEL_SIZE)
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().onAccent))
    }
    .layoutWeight(1)
    .height(height)
    .padding({ left: Spacing.lg, right: Spacing.lg })
    .borderRadius(Radii.pillFull)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor((enabled ? toResourceColor(activeColors().accent) : toResourceColor(activeColors().inkMuted)))
    .opacity((enabled ? 1 : 0.6))
    .focusable(enabled)
    .onClick(() => {
      this.playPrimary();
    })
  }

  @Builder
  private railsColumn(): void {

    Column({ space: Spacing.xl }) {
      ForEach(
        this.rails,
        (rail: DetailRail) => {
          MediaRail({
            railId: rail.id,
            heading: rail.heading,
            itemGap: (isTvMetrics() ? tv(TvGeometry.railItemGapTitle) : TouchGeometry.railItemGap),
            headingSize: (isTvMetrics() ? tv(TvGeometry.railHeadingSize) : TouchGeometry.railHeadingSize),
            items: rail.items,
            itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
              this.rowItem(item, index, activeRailFactor);
            },
          })
        },
        (rail: DetailRail): string => rail.id
      )

      if (this.similarRail !== null) {
        MediaRail({
          railId: this.similarRail.id,
          heading: this.similarRail.heading,
          headingSize: (isTvMetrics() ? tv(TvGeometry.railHeadingSize) : TouchGeometry.railHeadingSize),
          items: this.similarRail.items,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.similarItem(item, index, activeRailFactor);
          },
        })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  private synopsisText(): string {
    if (this.detail !== null && this.detail.work.overview !== null) {
      return this.detail.work.overview;
    }
    return '';
  }

  private shellTitle(): string {
    const kind = this.detail !== null ? this.detail.work.kind : 'movie';
    if (kind === 'series') {
      return 'Series';
    }
    if (kind === 'artist') {
      return 'Music';
    }
    return 'Movies';
  }

  /** The nav tile that stays marked on this page: the title's own kind (`movie`, `series`, `artist`). */
  private shellNavId(): string {
    return this.detail !== null ? this.detail.work.kind : '';
  }

  /** Web's action pill: a glyph and a label in a rounded translucent capsule, the primary one filled. */
  @Builder
  private actionPill(label: string, glyph: string, primary: boolean, enabled: boolean, onPress: () => void): void {
    Row({ space: tv(10) }) {
      Text(glyph)
        .fontSize(tv(12))
        .fontColor(primary ? toResourceColor(activeColors().bg) : toResourceColor(activeColors().accent))
      Text(label)
        .fontSize(tv(13))
        .fontWeight(FontWeight.Bold)
        .fontColor(primary ? toResourceColor(activeColors().bg) : toResourceColor(activeColors().ink))
        .maxLines(1)
    }
    .height(tv(PILL_HEIGHT))
    .padding({ left: tv(PILL_PADDING_X), right: tv(PILL_PADDING_X) })
    .borderRadius(tv(PILL_HEIGHT / 2))
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor(primary ? toResourceColor(activeColors().ink) : toResourceColorWithAlpha(activeColors().ink, PILL_FILL_ALPHA))
    .opacity(enabled ? 1 : 0.5)
    .focusable(enabled)
    .onClick(() => {
      onPress();
    })
  }

  @Builder
  private tvActions(): void {
    Column({ space: tv(PILL_ROW_GAP) }) {
      Row({ space: tv(PILL_GAP) }) {
        this.actionPill('Download', '\u21E9', false, this.primaryMediaFileId !== null, (): void => {
          this.actionsOpen = true;
        })
        if (this.primaryMediaFileId !== null && this.detail !== null && this.detail.work.kind === 'movie') {
          this.actionPill('Playback', '\u2630', false, true, (): void => {
            this.optionsOpen = true;
          })
        }
        this.actionPill(this.primaryLabel(), '\u25B6', true, this.primaryMediaFileId !== null, (): void => {
          this.playPrimary();
        })
      }
      Row({ space: tv(PILL_GAP) }) {
        this.actionPill(this.listed === true ? 'Remove from watchlist' : 'Add to watchlist', this.listed === true ? '\u2713' : '+', false, this.listed !== null, (): void => {
          void this.toggleWatchlist();
        })
        this.actionPill('Add to Playlist', '+', false, true, (): void => {
          this.actionsOpen = true;
        })
      }
    }
    .alignItems(HorizontalAlign.Start)
  }

  /** The series' resume plan (web's Resume / Start button): the kicker and the label follow it, and it plays the plan's target. */
  private async loadResumePlan(seriesId: string): Promise<void> {
    const result = await getResumePlan(seriesId);
    if (result.kind !== 'ok') {
      return;
    }
    this.resumePlan = result.value;
    const target = resumeTargetFile(result.value);
    if (target !== null) {
      this.primaryMediaFileId = target;
    }
  }

  /** The primary pill's label: Resume from m:ss for a part-watched movie, else Play (Unavailable while nothing is playable). */
  private primaryLabel(): string {
    if (this.primaryMediaFileId === null) {
      return 'Unavailable';
    }
    if (this.resumePlan !== null) {
      return resumeButtonLabel(this.resumePlan);
    }
    if (this.resumeMs > 0) {
      return 'Resume from ' + chapterTimeLabel(this.resumeMs);
    }
    return 'Play';
  }

  /** Web's cast circle: the person's initials (their headshot over them when there is one) and their name under it. */
  @Builder
  private castItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    Column({ space: tv(8) }) {
      Stack() {
        Text(initialsOf((item as CastRow).name))
          .fontSize(tv(CAST_INITIALS_SIZE))
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColorWithAlpha(activeColors().ink, 0.6))
        if ((item as CastRow).headshot.length > 0) {
          Image((item as CastRow).headshot)
            .width(tv(CAST_CIRCLE))
            .height(tv(CAST_CIRCLE))
            .objectFit(ImageFit.Cover)
            .draggable(false)
        }
      }
      .width(tv(CAST_CIRCLE))
      .height(tv(CAST_CIRCLE))
      .borderRadius(tv(CAST_CIRCLE / 2))
      .clip(true)
      .backgroundColor(toResourceColorWithAlpha(activeColors().ink, 0.08))
      .focusable(true)

      Text((item as CastRow).name)
        .fontSize(tv(12))
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width(tv(CAST_CIRCLE + 20))
        .textAlign(TextAlign.Center)
    }
    .width(tv(CAST_CIRCLE + 20))
  }

  private castRows(): CastRow[] {
    const rows: CastRow[] = [];
    for (const credit of this.cast) {
      const headshot = credit.person.headshot_url !== undefined && credit.person.headshot_url !== null ? credit.person.headshot_url : '';
      const row: CastRow = { id: credit.id, name: credit.person.name, headshot: headshot };
      rows.push(row);
    }
    return rows;
  }

  /** A rail's heading with the count line web shows under it (`16 chapters`, `30 people`). */
  @Builder
  private railHeading(heading: string, count: string): void {
    Column({ space: tv(4) }) {
      Text(heading)
        .fontSize(tv(TvGeometry.railHeadingSize))
        .fontColor(toResourceColor(activeColors().ink))
      Text(count)
        .fontSize(tv(11))
        .fontColor(toResourceColor(activeColors().inkMuted))
    }
    .alignItems(HorizontalAlign.Start)
  }

  /** The right-hand column on web: the Chapters rail, then the Cast rail, straight on the page (no glass panel). */
  @Builder
  private tvRightColumn(): void {
    Column({ space: tv(RIGHT_COLUMN_GAP) }) {
      ForEach(
        this.rails,
        (rail: DetailRail) => {
          MediaRail({
            railId: rail.id,
            heading: rail.heading,
            itemGap: tv(TvGeometry.railItemGapTitle),
            headingSize: tv(TvGeometry.railHeadingSize),
            items: rail.items,
            itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
              this.rowItem(item, index, activeRailFactor);
            },
          })
        },
        (rail: DetailRail): string => rail.id
      )
      if (this.chaptersRail !== null) {
        Column({ space: tv(12) }) {
          this.railHeading('Chapters', this.chaptersRail.items.length.toString() + ' chapters')
          MediaRail({
            railId: 'chapters',
            itemGap: tv(TvGeometry.railItemGapTitle),
            items: this.chaptersRail.items,
            itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
              this.chapterItem(item, index, activeRailFactor);
            },
          })
        }
        .alignItems(HorizontalAlign.Start)
      }
      if (this.cast.length > 0) {
        Column({ space: tv(12) }) {
          this.railHeading('Cast', this.cast.length.toString() + ' people')
          MediaRail({
            railId: 'cast',
            itemGap: tv(CAST_GAP),
            items: this.castRows(),
            itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
              this.castItem(item, index, activeRailFactor);
            },
          })
        }
        .alignItems(HorizontalAlign.Start)
      }
      if (this.similarRail !== null) {
        MediaRail({
          railId: this.similarRail.id,
          heading: this.similarRail.heading,
          headingSize: tv(TvGeometry.railHeadingSize),
          items: this.similarRail.items,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.similarItem(item, index, activeRailFactor);
          },
        })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  private chapterItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    DetailRowArtworkCard({
      artworkStore: this.artworkStore,
      rowId: (item as DetailRow).id,
      variant: 'titleEpisode',
      title: (item as DetailRow).title,
      subtitle: (item as DetailRow).subtitle,
      cardWidth: tv(CHAPTER_CARD_WIDTH),
      cardHeight: tv(CHAPTER_CARD_HEIGHT),
      activeRailFactor: activeRailFactor,
      onSelect: () => { this.selectRow((item as DetailRow)); },
    })
  }

  @Builder
  private tvContent(): void {
    Stack() {
      if (this.heroArtwork !== undefined) {
        Image(this.heroArtwork)
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Cover)
          .grayscale(1)
          .opacity(BACKDROP_OPACITY)
          .draggable(false)
          .focusable(false)
      }

      Row()
        .width('100%')
        .height('100%')
        .hitTestBehavior(HitTestMode.Transparent)
        .linearGradient({
          angle: 90,
          colors: [
            [toResourceColor(activeColors().surface), 0],
            [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.detailBackdropLeftPct)],
          ],
        })

      Column({ space: tv(COPY_GAP) }) {
        FeatureCopy({
          kicker: this.tvCopyKicker(),
          title: (this.detail !== null ? this.detail.work.title : ''),
          subtitle: this.tvCopySubtitle(),
          metaLines: this.tvCopyMetaLines(),
          synopsis: this.tvCopySynopsis(),
        })
        this.tvActions()
      }
      .width(`${TvGeometry.detailCopyColumnWidthRatio * 100}%`)
      .alignItems(HorizontalAlign.Start)
      .position({ x: tv(TvGeometry.detailCopyColumnStart), y: tv(TvGeometry.detailCopyColumnTop) })

      Scroll() {
        this.tvRightColumn()
      }
      .align(Alignment.Top)
      .width(tv(RIGHT_COLUMN_WIDTH))
      .height(tv(RIGHT_COLUMN_HEIGHT))
      .scrollBar(BarState.Off)
      .position({ x: tv(RIGHT_COLUMN_X), y: tv(RIGHT_COLUMN_Y) })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().surface))
  }

  /** Web's pink line over the title: the first genre when there is one, else the kind. */
  private kickerLabel(): string {
    if (this.detail === null) {
      return '';
    }
    const genres = this.detail.work.genres;
    if (genres !== undefined && genres !== null && genres.length > 0) {
      return genres[0];
    }
    return kindLabel(this.detail.work.kind);
  }

  private hasResumeTarget(): boolean {
    return this.detail !== null && hasSeriesResumeTarget(this.detail, this.resumePlan);
  }

  private tvCopyKicker(): string {
    if (this.hasResumeTarget() && this.resumePlan !== null) {
      const kicker = resumeKicker(this.resumePlan);
      if (kicker.length > 0) {
        return kicker;
      }
    }
    return this.detail !== null ? this.kickerLabel() : '';
  }

  private tvCopySubtitle(): string {
    if (this.detail === null || !this.hasResumeTarget() || this.resumePlan === null) {
      return '';
    }
    return planEpisodeTitle(this.detail, this.resumePlan);
  }

  private tvCopyMetaLines(): string[] {
    if (this.detail === null) {
      return [];
    }
    if (this.hasResumeTarget() && this.resumePlan !== null) {
      return [metaChips(this.detail, this.resumePlan).join(' · ')];
    }
    return buildMetaLines(this.detail);
  }

  private tvCopySynopsis(): string {
    if (this.detail === null) {
      return '';
    }
    if (this.hasResumeTarget() && this.resumePlan !== null) {
      return planSynopsis(this.detail, this.resumePlan);
    }
    return this.synopsisText();
  }

  @Builder
  private tvLayout(): void {
    PageShell({
      title: this.shellTitle(),
      kicker: (this.detail !== null ? this.detail.work.title.toUpperCase() : ''),
      selectedId: this.shellNavId(),
      content: (): void => {
        this.tvContent();
      },
    })
    if (this.optionsOpen && this.primaryMediaFileId !== null && this.detail !== null) {
      PlaybackOptionsDrawer({
        mediaFileId: this.primaryMediaFileId,
        workTitle: this.detail.work.title,
        onClose: (): void => {
          this.optionsOpen = false;
        },
      })
    }
    if (this.actionsOpen && this.detail !== null) {
      TitleActionsDrawer({
        workId: this.detail.work.id,
        workTitle: this.detail.work.title,
        onClose: (): void => {
          this.actionsOpen = false;
        },
        onPlay: (workId: string): void => {
          this.playPrimary();
        },
        onWatchedChanged: (): void => {},
      })
    }
  }

  /** Phone: the meta chips (web `.work-meta`): the first bold, the rest muted, 12 vp apart, wrapping. */
  @Builder
  private touchMetaChips(): void {
    Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(12), cross: LengthMetrics.vp(4) } }) {
      ForEach(this.detail !== null ? metaChips(this.detail, this.resumePlan) : [], (chip: string, index: number) => {
        Text(chip)
          .fontSize(11)
          .fontWeight(index === 0 ? FontWeight.Bold : FontWeight.Normal)
          .fontColor(toResourceColor(index === 0 ? activeColors().ink : activeColors().inkSoft))
      }, (chip: string, index: number): string => index.toString() + chip)
    }
    .width('100%')
  }

  /** Phone: web's action rows. Download, Playback and Add to Playlist open the title actions drawer; Play is the primary pill. */
  @Builder
  private touchActionButton(label: string, onTap: () => void): void {
    Text(label)
      .fontSize(11)
      .fontWeight(FontWeight.Medium)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .height(44)
      .padding({ left: 16, right: 16 })
      .borderRadius(22)
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
      .onClick(() => {
        onTap();
      })
  }

  @Builder
  private touchActionRows(): void {
    if (this.detail !== null && this.detail.work.kind === 'series') {
      Row({ space: 8 }) {
        ForEach(seriesPhoneActionIds(this.hasResumeTarget() && this.primaryMediaFileId !== null),
          (action: SeriesPhoneActionId) => {
            this.touchSeriesAction(action);
          },
          (action: SeriesPhoneActionId) => action)
      }
      .width('100%')
      .margin({ top: 4 })
    } else {
      Row({ space: 8 }) {
        this.touchActionButton('Download', (): void => {
          this.touchActionsOpen = true;
        })
        this.touchActionButton('Playback', (): void => {
          this.touchActionsOpen = true;
        })
        this.playButton(this.primaryMediaFileId !== null, PLAY_BUTTON_HEIGHT_TOUCH)
      }
      Row({ space: 8 }) {
        this.touchActionButton(this.listed === true ? 'Remove from watchlist' : 'Add to watchlist', (): void => {
          this.toggleWatchlist();
        })
        this.touchActionButton('Add to Playlist', (): void => {
          this.touchActionsOpen = true;
        })
      }
      .margin({ top: 4 })
    }
  }

  @Builder
  private touchSeriesAction(action: SeriesPhoneActionId): void {
    if (action === 'primary') {
      Row({ space: 8 }) {
        Text('▶')
          .fontSize(11)
          .fontColor(toResourceColor(activeColors().bg))
        Text(this.primaryLabel())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().bg))
          .layoutWeight(1)
      }
      .layoutWeight(1)
      .height(44)
      .padding({ left: 12, right: 12 })
      .borderRadius(22)
      .justifyContent(FlexAlign.Center)
      .backgroundColor(toResourceColor(activeColors().ink))
      .onClick(() => {
        this.playPrimary();
      })
    } else if (action === 'watchlist') {
      this.touchSeriesSecondaryAction(
        this.listed === true ? 'Remove from watchlist' : 'Add to watchlist',
        this.listed === true ? '✓' : '+',
        (): void => { this.toggleWatchlist(); }
      )
    } else {
      this.touchSeriesSecondaryAction('Add to Playlist', '+', (): void => {
        this.touchActionsOpen = true;
      })
    }
  }

  @Builder
  private touchSeriesSecondaryAction(label: string, glyph: string, onTap: () => void): void {
    Row({ space: 5 }) {
      Text(glyph)
        .fontSize(12)
        .fontColor(toResourceColor(BRAND_PINK))
      Text(label)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .fontSize(11)
        .fontColor(toResourceColor(activeColors().ink))
        .layoutWeight(1)
    }
    .layoutWeight(1)
    .height(44)
    .padding({ left: 8, right: 8 })
    .borderRadius(22)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.72))
    .onClick(() => {
      onTap();
    })
  }

  /** Phone (web phone detail): the backdrop fading into the page at the top, Back over it, then the pink kind line, the title, the
   * meta line, three lines of synopsis, the Play pill and the rails. */
  @Builder
  private touchLayout(): void {

    Stack({ alignContent: Alignment.TopStart }) {
      if (this.heroArtwork !== undefined) {
        Image(this.heroArtwork)
          .width('100%')
          .height(HERO_TOUCH_HEIGHT)
          .objectFit(ImageFit.Cover)
          .draggable(false)
          .focusable(false)
      } else {
        Skeleton({ blockWidth: TouchGeometry.homeRailCardWidthLandscape * 4, blockHeight: HERO_TOUCH_HEIGHT, radius: 0 })
      }
      Column()
        .width('100%')
        .height(HERO_TOUCH_HEIGHT)
        .linearGradient({
          direction: GradientDirection.Bottom,
          colors: [[toResourceColorWithAlpha(activeColors().bg, 0.78), 0.0], [toResourceColorWithAlpha(activeColors().bg, 0.9), 0.55], [toResourceColor(activeColors().bg), 1.0]],
        })

      Scroll() {
        Column({ space: TouchGeometry.detailListSpacing }) {
          Column({ space: 10 }) {
            Text(this.resumePlan !== null && resumeKicker(this.resumePlan).length > 0 ? resumeKicker(this.resumePlan) : (this.detail !== null ? kindLabel(this.detail.work.kind) : ''))
              .fontSize(10.56)
              .height(16)
              .fontWeight(FontWeight.Bolder)
              .letterSpacing(0.8)
              .textCase(TextCase.UpperCase)
              .fontColor(toResourceColor(BRAND_PINK_SOFT))
            Text(this.detail !== null ? this.detail.work.title : '')
              .fontSize(36)
              .fontWeight(FontWeight.Medium)
              .letterSpacing(-1.6)
              .lineHeight(34)
              .fontColor(toResourceColor(activeColors().ink))
            if (this.detail !== null && planEpisodeTitle(this.detail, this.resumePlan).length > 0) {
              Text(planEpisodeTitle(this.detail, this.resumePlan))
                .fontSize(14.4)
                .fontWeight(FontWeight.Medium)
                .fontColor(toResourceColor(activeColors().ink))
                .maxLines(1)
            }
            this.touchMetaChips()
            Text(this.detail !== null ? planSynopsis(this.detail, this.resumePlan) : '')
              .fontSize(12)
              .fontColor(toResourceColor(activeColors().inkSoft))
              .lineHeight(18)
              .maxLines(3)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            this.touchActionRows()
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          // the TV page's rails, Chapters and Cast column, one copy: its sizes are web CSS px, which are vp here
          this.tvRightColumn()
        }
        .padding({
          top: TOUCH_TEXT_TOP,
          bottom: TouchGeometry.detailListBottom,
          left: Spacing.lg,
          right: Spacing.lg,
        })
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height('100%')

      Row({ space: 12 }) {
        Text('←')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)
          .width(40)
          .height(40)
          .borderRadius(20)
          .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
          .onClick(() => {
            popRoute(getNavStack());
          })
        Text(this.detail !== null ? (this.detail.work.kind === 'series' ? 'Series' : kindLabel(this.detail.work.kind) + 's') : '')
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(activeColors().ink))
      }
      .padding({ left: 16, top: 12 })
      .alignItems(VerticalAlign.Center)

      if (this.touchActionsOpen && this.detail !== null) {
        TitleActionsDrawer({
          workId: this.detail.work.id,
          workTitle: this.detail.work.title,
          onClose: (): void => {
            this.touchActionsOpen = false;
          },
          onPlay: (_workId: string): void => {
            this.touchActionsOpen = false;
            this.playPrimary();
          },
          onWatchedChanged: (): void => {},
        })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  @Builder
  private busyOrErrorState(): void {
    if (this.loadFailed) {
      AsyncState({
        kind: AsyncStateKind.Error,
        message: this.errorMessage,
        retryLabel: 'Retry',
        retry: () => {
          this.loadDetail();
        },
      })
    } else {
      AsyncState({ kind: AsyncStateKind.Loading })
    }
  }

  build() {
    NavDestination() {
      if (this.detail === null) {
        Column() {
          this.busyOrErrorState()
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor(toResourceColor(activeColors().bg))
      } else if (isTvMetrics()) {
        this.tvLayout()
      } else {
        this.touchLayout()
      }
    }
    .hideTitleBar(true)
    .backgroundColor(toResourceColor(activeColors().bg))
  }
}

/**
 * Registered in `profile/router_map.json` as the `Detail` route's
 * `buildFunction` once the navigation-shell slice lands that row (this
 * file's header comment) -- same `(name, param)` entry-point shape the
 * system route table's `NavPathStack.pushPathByName` targets. Decodes
 * `param` as `navigation/Routes.ets`'s `DetailRouteParams` and passes
 * `workId` straight through as `Detail`'s own `@Prop`.
 */
@Builder
export function DetailBuilder(name: string, param: Object): void {
  Detail({ workId: ((param as DetailRouteParams).workId) })
}
