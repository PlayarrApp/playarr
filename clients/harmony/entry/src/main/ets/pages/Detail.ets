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

import { t, tf } from '../core/Language';
import { nunito } from '../design/Typography';
import { image } from '@kit.ImageKit';
import { LengthMetrics } from '@kit.ArkUI';

import { getWorkDetail, getSimilarWorks, getWorkCredits, getResumePlan, clearResumeChoices } from '../data/CatalogRepository';
import { resumeButtonLabel, resumeKicker, resumeTargetFile } from '../core/ResumePlan';
import { atLeast } from '../core/SafeInsets';
import { generatedChapters, hasSeriesResumeTarget, metaChips, planEpisodeTitle, planSynopsis } from '../core/DetailMeta';
import {
  EpisodeFocusGate,
  hasPositiveEpisodeAreaSample,
  hasPositiveEpisodeVisibleArea,
  issueEpisodeFocusRequest,
  isSeriesEpisodeTargetFocused,
  EpisodeFocusRect,
  episodeFocusRectFromAreaVps,
  SeriesEpisodeAreaSample,
  seriesEpisodeAreaSampleMatchesTarget,
  centredSeasonStackOffset,
  SERIES_EPISODE_CARD_WIDTH,
  SERIES_EPISODE_LIST_HEIGHT,
  SERIES_SEASON_HEADER_CARD_GAP,
  SERIES_SEASON_ROW_GAP,
  episodeIndexForTarget,
  seriesEpisodeCaption,
  seriesDetailMeasurementId,
  seriesEpisodeFocusId,
  seriesEpisodeOverlayNumber,
} from '../core/SeriesEpisodePresentation';
import { NonEmptyComponentIdModifier } from '../design/ComponentMeasurement';
import type { ResumePlan } from '../core/Types/ResumePlan';
import type { WatchProgress } from '../core/Types/Playback';
import { getMediaChapters, getWatchProgress, listWatchProgress } from '../data/PlaybackRepository';
import { watchMarkFor } from '../core/WatchState';
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
  LANDSCAPE_ARTWORK_PRIORITY,
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
import { KeyArtBackdrop } from '../design/components/KeyArtBackdrop';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import { PosterCard } from '../design/components/PosterCard';
import { PageShell } from '../design/components/PageShell';
import { TitleActionsDrawer } from '../design/components/TitleActionsDrawer';
import { TouchNavBar, touchNavBarBox } from '../design/components/TouchNavBar';
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
// Web phone season rows (measured on the 360 vp reference): 187 vp cards, heading to cards 23, season to season 237.
const PHONE_EPISODE_CARD_WIDTH: number = 187;
const PHONE_EPISODE_RAIL_GAP: number = 11;
const PHONE_SEASON_LIST_HEIGHT: number = 165;
const PHONE_SEASON_HEADER_CARD_GAP: number = 21.18;
// 24 > the card's 20 vp ring glow, so the glow is not cut at the rail's left edge
const PHONE_DETAIL_RAIL_CLIP_START: number = 24;
const PHONE_DETAIL_RAIL_CLIP_TOP: number = 36;
// Web phone detail header (#175): the 44 vp Back button 16 vp from the top, an 8 vp gap, then the 28 vp edge fade of the pinned scrim.
const PHONE_BACK_SIZE: number = 44;
const PHONE_HEADER_TOP: number = 16;
const PHONE_HEADER_GAP: number = 8;
const PHONE_HEADER_FADE: number = 28;
// Season to season is 237 on web; the phone capture measured 14.3 vp short with 21, so the gap is 35.3.
const PHONE_SEASON_ROW_GAP: number = 35.65;
/** Web `--brand-strong`, the phone Play button's focused fill. */
const PLAY_FOCUS_FILL: string = '#a52745';
const PILL_GLYPH_DARK: string = '#ba8492'; // sampled from the dark static-server ref (anti-aliased thin glyph; refine if the colour reads off)
const TOUCH_SCROLL_ID: string = 'detail-touch-scroll';
const TOUCH_SETTLE_ATTEMPTS: number = 12;
/** Web phone series detail, next-up episode in the middle: the page scrolled by about this much (measured on the 360 vp reference). */
const TOUCH_SETTLE_FALLBACK_VP: number = 377;
const TOUCH_SETTLE_INTERVAL_MS: number = 250;
/** Phone: where the text block starts (the backdrop's lower part is under it, faded). */
const TOUCH_TEXT_TOP: number = 343;

// Web `.tv-detail-play` / `.tv-detail-playback-settings` at 1920 wide (clamps of 0.62vw / 0.58vw, 4.2vw, 8.5vw / 7.6vw).
const PILL_HEIGHT: number = 64;
const PILL_PADDING_X: number = 16;
const PILL_PRIMARY_PADDING_X: number = 21.6;
const PILL_PRIMARY_FONT: number = 11.9;
const PILL_SECONDARY_FONT: number = 11.1;
const PILL_PRIMARY_GAP: number = 10.4;
const PILL_SECONDARY_GAP: number = 8.8;
const PILL_PRIMARY_MIN_WIDTH: number = 156;
const PILL_SECONDARY_MIN_WIDTH: number = 142;
const PILL_GAP: number = 16;
const PILL_ROW_GAP: number = 14;
const PILL_FILL_ALPHA: number = 0.09;
const COPY_GAP: number = 36;
const RIGHT_COLUMN_X: number = 882;
const RIGHT_COLUMN_Y: number = 543;
const RIGHT_COLUMN_WIDTH: number = 1038;
const RIGHT_COLUMN_HEIGHT: number = 537;
const RIGHT_COLUMN_GAP: number = 77; // web: Cast heading at 904 under Chapters at 553
const SERIES_COLUMN_TOP: number = 543; // static-server refs: the first season heading rests with the other details' right column (was 361, the scrolled old ref)
const SERIES_COLUMN_BLEED: number = 12;
const SERIES_COLUMN_HEIGHT: number = 537;
const CHAPTER_CARD_WIDTH: number = 268;
const CHAPTER_CARD_HEIGHT: number = 150;
/** Room under a landscape Similar card for its caption and the focus shadow. */
const SIMILAR_LIST_EXTRA: number = 70;
const CAST_CIRCLE: number = 104;
/** Web's first circle starts 24 vp in from the rail edge (the item is wider than ours); ours sat at 10. */
const CAST_LEFT_INSET: number = 14;
const CAST_GAP: number = 39; // pitch 177 = item 124 + inset 14 + gap 39
/** Room under a cast circle for its name and the focus shadow: the list is this much taller than the circle (a list without a height fills the column and pushes everything below it off the page). */
const CAST_LIST_EXTRA: number = 60;
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
  /** Present only for a series TV card, rendered above its episode title. */
  episodeCaption?: string;
  /** Present only for a series TV card, rendered over the artwork. */
  episodeNumberOverlay?: string;
  /** Where playback starts when the row is a chapter; absent plays from the beginning. */
  startMs?: number;
  /** Changes when the phone's unseen dot or next-up ring changes, so the rail rebuilds the card (ForEach keys on id and stamp). */
  stamp?: string;
}

@Component
struct DetailRowArtworkCard {
  @ObjectLink artworkStore: DetailArtworkStore;
  @Prop rowId: string = '';
  @Prop measurementId: string = '';
  @Prop imageMeasurementId: string = '';
  @Prop variant: 'home' | 'titleEpisode' = 'titleEpisode';
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop cardWidth: number = 0;
  @Prop cardHeight: number = 0;
  @Prop artworkRadius: number = -1;
  @Prop titleFontSize: number = 11.904;
  @Prop subtitleFontSize: number = 8.832;
  @Prop activeRailFactor: number = 1;
  @Prop episodeCaption: string = '';
  @Prop episodeNumberOverlay: string = '';
  @Prop focusId: string = '';
  @Prop ringOn: boolean = false;
  @Prop unseen: boolean = false;

  onSelect: () => void = () => {};
  onCardAppear: () => void = () => {};
  onCardFocus: () => void = () => {};
  onCardArea: (area: Area) => void = (_area: Area) => {};
  onArtworkAreaChanged: () => void = () => {};

  @Builder
  private posterCard(): void {
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
      episodeCaption: this.episodeCaption,
      episodeNumberOverlay: this.episodeNumberOverlay,
      ringOn: this.ringOn,
      unseen: this.unseen,
      measurementId: this.measurementId,
      imageMeasurementId: this.imageMeasurementId,
      onFocused: this.onCardFocus,
      onArtworkAreaChanged: this.onArtworkAreaChanged,
      onSelect: this.onSelect,
    })
      .id(this.focusId.length > 0 ? this.focusId : 'detail-card-' + this.rowId)
      .onAppear(() => { this.onCardAppear(); })
      .onAreaChange((_oldArea: Area, area: Area) => { this.onCardArea(area); })
  }

  build() {
    if (this.measurementId.length > 0) {
      Column() {
        this.posterCard()
      }
      .attributeModifier(new NonEmptyComponentIdModifier(this.measurementId))
    } else {
      this.posterCard()
    }
  }
}

/** One season/album/books/similar rail: a heading plus its rows. */
interface DetailRail {
  id: string;
  heading: string;
  items: DetailRow[];
}

interface DetailSeasonRowArea {
  top: number;
  height: number;
}

function kindLabel(kind: WorkKind): string {
  if (kind === 'movie') {
    return t('pages.home.workKind.movie', 'Movie');
  }
  if (kind === 'series') {
    return t('pages.home.workKind.series', 'Series');
  }
  if (kind === 'site') {
    return t('pages.workDetail.kindSite', 'Site');
  }
  if (kind === 'artist') {
    return t('pages.home.workKind.artist', 'Artist');
  }
  return 'Author';
}

function humanizeAvailability(availability: Availability): string {
  if (availability === 'available') {
    return t('pages.requests.status.available', 'Available');
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

function buildEpisodeRow(detail: EpisodeDetail, seasonNumber: number): DetailRow {
  const episode = detail.episode;
  let title = tf('pages.workDetail.episodeNumber', 'Episode {{number}}', { number: String(episode.episode_number) });
  if (episode.title !== undefined && episode.title !== null && episode.title.length > 0) {
    title = episode.title;
  }
  const row: DetailRow = {
    id: episode.id,
    title: title,
    subtitle: tf('pages.workDetail.episodeNumber', 'Episode {{number}}', { number: String(episode.episode_number) }),
    episodeCaption: seriesEpisodeCaption(seasonNumber, episode.episode_number),
    episodeNumberOverlay: seriesEpisodeOverlayNumber(episode.episode_number),
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
  return tf('pages.workDetail.seasonNumber', 'Season {{number}}', { number: String(season.season_number) });
}

function buildSeasonRail(detail: SeasonDetail): DetailRail {
  const items: DetailRow[] = [];
  for (const episodeDetail of detail.episodes) {
    const item = buildEpisodeRow(episodeDetail, detail.season.season_number);
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
    // Web lists only seasons with at least one playable episode (a media file has synced for it).
    if (season.episodes.some((episode: EpisodeDetail): boolean => episodeMediaFileId(episode) !== null)) {
      rails.push(buildSeasonRail(season));
    }
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
  const rail: DetailRail = { id: 'books', heading: t('pages.calendar.typeBooks', 'Books'), items: items };
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
  const rail: DetailRail = { id: 'similar', heading: t('pages.workDetail.similarTitlesHeading', 'Similar Titles'), items: items };
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
  const title = chapter.title !== undefined && chapter.title !== null && chapter.title.length > 0 ? chapter.title : tf('pages.workDetail.chapterNumber', 'Chapter {{number}}', { number: String(number) });
  const row: DetailRow = {
    id: 'chapter-' + chapter.index.toString(),
    title: title,
    subtitle: '',
    episodeCaption: chapterTimeLabel(chapter.start_ms),
    episodeNumberOverlay: number,
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

function detailLengthToVp(value: Length): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function detailAreaLengthToVp(value: Length | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function detailFocusRectForArea(area: Area): EpisodeFocusRect | null {
  const position = area.globalPosition;
  if (position === undefined || position === null) {
    return null;
  }
  return episodeFocusRectFromAreaVps(
    detailAreaLengthToVp(position.x),
    detailAreaLengthToVp(position.y),
    detailAreaLengthToVp(area.width),
    detailAreaLengthToVp(area.height)
  );
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
  /** Web: generated chapters (the server listed none) are counted as "scene markers". */
  private chaptersGenerated: boolean = false;
  /** A series' resume plan (null for a film, or until the server answers): its target is what the primary button plays. */
  @State private resumePlan: ResumePlan | null = null;
  @State private episodeFocusSuppressed: boolean = false;
  @State private targetSeriesSeasonCentered: boolean = false;
  @State private targetSeriesEpisodeCentered: boolean = false;
  @State private seriesFocusedRowIsTarget: boolean = false;
  private episodeFocusGate: EpisodeFocusGate = new EpisodeFocusGate();
  private seriesFocusGeneration: number = 0;
  private mountedSeriesEpisodeIds: string[] = [];
  private measuredSeriesCardAreas: Map<string, SeriesEpisodeAreaSample | null> = new Map();
  private measuredSeriesAreaRects: Map<string, EpisodeFocusRect | null> = new Map();
  private currentSeriesRailOffsets: Map<string, number> = new Map();
  private seasonRowAreas: Map<string, DetailSeasonRowArea> = new Map();
  private seriesStackScroller: Scroller = new Scroller();
  @StorageProp('safeTop') private safeTop: number = 0;
  @StorageProp('safeBottom') private safeBottom: number = 0;
  @StorageProp('safeLeft') private safeLeft: number = 0;
  @StorageProp('safeRight') private safeRight: number = 0;
  /** Phone: the page scroller, and whether the next-up episode has been brought to the middle yet. */
  private touchScroller: Scroller = new Scroller();
  private touchEpisodeSettled: boolean = false;
  @State private cast: Credit[] = [];
  @State private actionsOpen: boolean = false;
  /** Phone: the title actions drawer (Download, Add to Playlist, watched marks). */
  @State private touchActionsOpen: boolean = false;
  /** Phone Play: web's focus style (`.tv-detail-play:focus-visible`: brand-strong fill, white label, 1.06 scale). */
  // starts true on the phone: web opens with Play focused, and the Previewer window never reports the focus
  /** Web's unseen dot on episode cards: the viewer's progress rows by media file, once loaded. */
  @State private episodeProgress: Map<string, WatchProgress> = new Map<string, WatchProgress>();
  @State private episodeProgressLoaded: boolean = false;
  // true from the start on both: web opens a film with Play focused (the Previewer never reports focus); only the TV film Play pill and the phone Play read it
  @State private playFocused: boolean = true;
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
    this.seriesFocusGeneration += 1;
    this.detail = null;
    this.loadFailed = false;
    this.errorMessage = '';
    this.heroArtwork = undefined;
    const artworkGeneration = this.artworkStore.beginGeneration();
    this.rails = [];
    this.similarRail = null;
    this.primaryMediaFileId = null;
    this.chaptersRail = null;
    this.chaptersGenerated = false;
    this.resumePlan = null;
    this.episodeFocusSuppressed = false;
    this.episodeFocusGate = new EpisodeFocusGate();
    this.mountedSeriesEpisodeIds = [];
    this.measuredSeriesCardAreas = new Map();
    this.measuredSeriesAreaRects = new Map();
    this.currentSeriesRailOffsets = new Map();
    this.seasonRowAreas = new Map();
    this.targetSeriesSeasonCentered = false;
    this.targetSeriesEpisodeCentered = false;
    this.seriesFocusedRowIsTarget = false;
    this.seriesStackScroller = new Scroller();
    this.touchScroller = new Scroller();
    this.touchEpisodeSettled = false;
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
    if (detail.work.kind === 'series') {
      this.loadEpisodeProgress();
    }
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
    // web: the server's list can be empty; the rail then shows generated chapters (one "Chapter 01" at 0:00 for a short clip)
    const chapters: MediaChapter[] = result.kind === 'ok' && result.value.length > 0
      ? result.value
      : generatedChapters(this.detail !== null && this.detail.runtime_ms !== null ? this.detail.runtime_ms : 0);
    if (chapters.length === 0) {
      return;
    }
    this.chaptersGenerated = !(result.kind === 'ok' && result.value.length > 0);
    const rows: DetailRow[] = [];
    for (const chapter of chapters) {
      rows.push(chapterRow(chapter, mediaFileId));
    }
    this.chaptersRail = { id: 'chapters', heading: t('pages.workDetail.chaptersHeading', 'Chapters'), items: rows };
    for (const chapter of chapters) {
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
      const result = await fetchWorkArtworkByPriority(item.similarWorkId, isTvMetrics() ? LANDSCAPE_ARTWORK_PRIORITY : COVER_ARTWORK_PRIORITY);
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
    this.cancelInitialEpisodeFocus();
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

  private seriesEpisodeCardAppeared(railId: string, episodeId: string, occurrence: number): void {
    if (this.mountedSeriesEpisodeIds.indexOf(episodeId) < 0) {
      this.mountedSeriesEpisodeIds.push(episodeId);
    }
    this.tryInitialEpisodeFocus(railId, episodeId, this.workId, this.seriesFocusGeneration, occurrence);
  }

  private seriesMeasurementId(kind: string, workId: string, generation: number, railId: string,
                              episodeId: string = '', occurrence: number = -1): string {
    return seriesDetailMeasurementId(kind, workId, generation, railId, episodeId, occurrence);
  }

  /** NaN while the page Scroll is not mounted (the phone layout has no series stack): the callers already skip non-finite offsets. */
  private seriesPageOffset(): number {
    const offset: OffsetResult | undefined = this.seriesStackScroller.currentOffset();
    return offset === undefined ? Number.NaN : offset.yOffset;
  }

  private seriesCardAreaChanged(railId: string, episodeId: string, occurrence: number,
                                workId: string, generation: number, area: Area, railOffset: number): void {
    if (generation !== this.seriesFocusGeneration || workId !== this.workId ||
        this.detail === null || this.detail.work.kind !== 'series' || this.detail.work.id !== workId) {
      return;
    }
    const rail = this.rails.find((candidate: DetailRail): boolean => candidate.id === railId);
    if (rail === undefined || occurrence < 0 || occurrence >= rail.items.length ||
        rail.items[occurrence].id !== episodeId) {
      return;
    }
    const pageOffset = this.seriesPageOffset();
    const measurementId = this.seriesMeasurementId('card', workId, generation, railId, episodeId, occurrence);
    const rect = detailFocusRectForArea(area);
    if (rect === null || !Number.isFinite(pageOffset) || !Number.isFinite(railOffset)) {
      this.measuredSeriesAreaRects.set(measurementId, null);
      this.measuredSeriesCardAreas.set(measurementId, null);
      return;
    }
    this.measuredSeriesAreaRects.set(measurementId, rect);
    this.measuredSeriesCardAreas.set(measurementId, {
      workId: workId,
      generation: generation,
      railId: railId,
      episodeId: episodeId,
      occurrence: occurrence,
      pageOffset: pageOffset,
      railOffset: railOffset,
      capturedAtMs: Date.now(),
    });
    const plan = this.resumePlan;
    if (plan !== null && plan.target !== undefined && plan.target !== null &&
        plan.target.episode_id === episodeId) {
      this.tryInitialEpisodeFocus(railId, episodeId, workId, generation, occurrence);
    }
  }

  private seriesRailItemAreaReporter(railId: string, workId: string, generation: number):
    (itemId: string, index: number, area: Area, railOffset: number) => void {
    return (itemId: string, index: number, area: Area, railOffset: number): void => {
      this.seriesCardAreaChanged(railId, itemId, index, workId, generation, area, railOffset);
    };
  }

  private seriesCardArtworkAreaReporter(railId: string, episodeId: string, occurrence: number,
                                       workId: string, generation: number): () => void {
    return (): void => {
      const measurementId = this.seriesMeasurementId('card', workId, generation, railId, episodeId, occurrence);
      const measurement = this.measuredSeriesCardAreas.get(measurementId);
      if (generation !== this.seriesFocusGeneration || workId !== this.workId ||
          measurement === undefined || measurement === null) {
        return;
      }
      this.tryInitialEpisodeFocus(railId, episodeId, workId, generation, occurrence);
    };
  }

  private seriesRailAreaChanged(railId: string, workId: string, generation: number, area: Area): void {
    if (generation !== this.seriesFocusGeneration || workId !== this.workId) {
      return;
    }
    const railIdForMeasure = this.seriesMeasurementId('rail', workId, generation, railId);
    const rect = detailFocusRectForArea(area);
    if (rect === null) {
      this.measuredSeriesAreaRects.set(railIdForMeasure, null);
      return;
    }
    this.measuredSeriesAreaRects.set(railIdForMeasure, rect);
    this.tryInitialEpisodeFocus(railId, null, workId, generation);
  }

  private seriesRailAreaReporter(railId: string, workId: string, generation: number): (area: Area) => void {
    return (area: Area): void => { this.seriesRailAreaChanged(railId, workId, generation, area); };
  }

  private seriesRailOffsetChanged(railId: string, offset: number, workId: string, generation: number): void {
    if (generation !== this.seriesFocusGeneration || workId !== this.workId || !Number.isFinite(offset)) {
      return;
    }
    this.currentSeriesRailOffsets.set(railId, offset);
    this.tryInitialEpisodeFocus(railId, null, workId, generation);
  }

  private seriesRailOffsetReporter(railId: string, workId: string, generation: number): (offset: number) => void {
    return (offset: number): void => { this.seriesRailOffsetChanged(railId, offset, workId, generation); };
  }

  private seriesPageAreaChanged(workId: string, generation: number, area: Area): void {
    if (generation !== this.seriesFocusGeneration || workId !== this.workId) {
      return;
    }
    const pageId = this.seriesMeasurementId('page', workId, generation, '');
    const rect = detailFocusRectForArea(area);
    if (rect === null) {
      this.measuredSeriesAreaRects.set(pageId, null);
      return;
    }
    this.measuredSeriesAreaRects.set(pageId, rect);
    this.tryInitialEpisodeFocus(null, null, workId, generation);
  }

  private seriesPageAreaReporter(workId: string, generation: number): (area: Area) => void {
    return (area: Area): void => { this.seriesPageAreaChanged(workId, generation, area); };
  }

  private seriesPageScrollChanged(workId: string, generation: number): void {
    if (generation !== this.seriesFocusGeneration || workId !== this.workId ||
        !Number.isFinite(this.seriesPageOffset())) {
      return;
    }
    this.tryInitialEpisodeFocus(null, null, workId, generation);
  }

  private seriesPageScrollReporter(workId: string, generation: number): (xOffset: number, yOffset: number) => void {
    return (_xOffset: number, _yOffset: number): void => {
      this.seriesPageScrollChanged(workId, generation);
    };
  }

  private tryInitialEpisodeFocus(railId: string | null = null, reportedEpisodeId: string | null = null,
                                 workId: string = this.workId, generation: number = this.seriesFocusGeneration,
                                 reportedOccurrence: number = -1): void {
    if (generation !== this.seriesFocusGeneration || workId !== this.workId) {
      return;
    }
    const detail = this.detail;
    const plan = this.resumePlan;
    if (detail === null || detail.work.kind !== 'series' || !this.targetSeriesSeasonCentered ||
        !this.targetSeriesEpisodeCentered || plan === null || !hasSeriesResumeTarget(detail, plan) ||
        plan.target === undefined || plan.target === null) {
      return;
    }
    const episodeId = plan.target.episode_id;
    if (reportedEpisodeId !== null && reportedEpisodeId !== episodeId) {
      return;
    }
    const appeared = this.mountedSeriesEpisodeIds.indexOf(episodeId) >= 0;
    const actualTargetRailId = this.railIdForEpisode(episodeId);
    if (actualTargetRailId === null || (railId !== null && railId !== actualTargetRailId)) {
      return;
    }
    const targetRailId = actualTargetRailId;
    const currentRailOffset = this.listOffsetForRail(targetRailId);
    if (currentRailOffset === null || !Number.isFinite(currentRailOffset)) {
      return;
    }
    const targetRail = this.rails.find((candidate: DetailRail): boolean => candidate.id === targetRailId);
    if (targetRail === undefined) {
      return;
    }
    const occurrence = reportedEpisodeId === episodeId && reportedOccurrence >= 0 ?
      reportedOccurrence : targetRail.items.findIndex((item: DetailRow): boolean => item.id === episodeId);
    if (occurrence < 0) {
      return;
    }
    const measurementId = this.seriesMeasurementId('card', workId, generation, targetRailId, episodeId, occurrence);
    const cardMeasurement = this.measuredSeriesCardAreas.get(measurementId);
    const card = this.measuredSeriesAreaRects.get(measurementId);
    const rail = this.measuredSeriesAreaRects.get(
      this.seriesMeasurementId('rail', workId, generation, targetRailId)
    );
    const page = this.measuredSeriesAreaRects.get(this.seriesMeasurementId('page', workId, generation, ''));
    const pageOffset = this.seriesPageOffset();
    if (cardMeasurement === undefined || cardMeasurement === null || card === undefined || card === null ||
        rail === undefined || rail === null || page === undefined || page === null ||
        !Number.isFinite(pageOffset) ||
        !seriesEpisodeAreaSampleMatchesTarget(
          cardMeasurement, workId, generation, targetRailId, episodeId, occurrence, pageOffset, currentRailOffset
        )) {
      return;
    }
    const mounted = appeared || hasPositiveEpisodeAreaSample(
      card, cardMeasurement.pageOffset, cardMeasurement.railOffset
    );
    const visible = hasPositiveEpisodeVisibleArea(card, rail, page);
    const decision = this.episodeFocusGate.claim(episodeId, mounted, visible);
    if (decision === 'request' && this.episodeFocusGate.beginRequest()) {
      const issued = issueEpisodeFocusRequest((): void => {
        this.getUIContext().getFocusController().requestFocus(seriesEpisodeFocusId(episodeId));
      });
      if (!issued) {
        this.episodeFocusGate.rollbackRequest();
      }
    }
  }

  private railIdForEpisode(episodeId: string): string | null {
    const rail = this.rails.find((candidate: DetailRail): boolean =>
      candidate.items.findIndex((item: DetailRow): boolean => item.id === episodeId) >= 0
    );
    return rail === undefined ? null : rail.id;
  }

  private listOffsetForRail(railId: string): number | null {
    const offset = this.currentSeriesRailOffsets.get(railId);
    return offset === undefined ? null : offset;
  }

  private centreTargetSeriesSeason(rail: DetailRail): void {
    const detail = this.detail;
    const plan = this.resumePlan;
    if (this.targetSeriesSeasonCentered || this.episodeFocusSuppressed || !this.episodeFocusGate.isPending() ||
        detail === null || detail.work.kind !== 'series' || plan === null || !hasSeriesResumeTarget(detail, plan) ||
        plan.target === undefined || plan.target === null) {
      return;
    }
    const targetEpisodeId = plan.target.episode_id;
    if (rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) < 0) {
      return;
    }
    const rowArea = this.seasonRowAreas.get(rail.id);
    if (rowArea === undefined) {
      return;
    }
    if (rowArea.height <= 0) {
      return;
    }
    this.targetSeriesSeasonCentered = true;
    this.seriesStackScroller.scrollTo({
      xOffset: 0,
      yOffset: centredSeasonStackOffset(rowArea.top, rowArea.height, tv(SERIES_COLUMN_HEIGHT)),
      animation: false,
    });
    this.tryInitialEpisodeFocus();
  }

  private onSeriesSeasonRowAreaChanged(rail: DetailRail, area: Area): void {
    const positionY = area.position.y;
    const rowHeight = area.height;
    if (positionY === undefined || positionY === null || rowHeight === undefined || rowHeight === null) {
      return;
    }
    const topVp = detailLengthToVp(positionY);
    const heightVp = detailLengthToVp(rowHeight);
    if (heightVp <= 0) {
      return;
    }
    this.seasonRowAreas.set(rail.id, { top: topVp, height: heightVp });
    this.centreTargetSeriesSeason(rail);
  }

  private seriesEpisodeIndexPositioned(rail: DetailRail): void {
    const detail = this.detail;
    const plan = this.resumePlan;
    if (!this.targetSeriesSeasonCentered || this.targetSeriesEpisodeCentered || this.episodeFocusSuppressed ||
        detail === null || detail.work.kind !== 'series' || plan === null || !hasSeriesResumeTarget(detail, plan) ||
        plan.target === undefined || plan.target === null) {
      return;
    }
    const targetEpisodeId = plan.target.episode_id;
    if (rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) < 0) {
      return;
    }
    this.targetSeriesEpisodeCentered = true;
    this.tryInitialEpisodeFocus();
  }

  private cancelInitialEpisodeFocus(): void {
    this.episodeFocusGate.cancel();
    this.episodeFocusSuppressed = true;
    this.seriesFocusedRowIsTarget = false;
  }

  private noteOtherDetailFocus(workId: string, generation: number): void {
    if (workId !== this.workId || generation !== this.seriesFocusGeneration) {
      return;
    }
    // Framework-seeded focus is passive; key and click handlers cancel the initial request.
    this.seriesFocusedRowIsTarget = false;
    this.episodeFocusGate.recordCurrentFocus('', this.resumeTargetEpisodeId());
    this.tryInitialEpisodeFocus(null, null, workId, generation);
  }

  private otherDetailFocusReporter(workId: string, generation: number): () => void {
    return (): void => { this.noteOtherDetailFocus(workId, generation); };
  }

  private seriesEpisodeCardFocused(episodeId: string): void {
    const targetEpisodeId = this.resumeTargetEpisodeId();
    this.seriesFocusedRowIsTarget = isSeriesEpisodeTargetFocused(episodeId, targetEpisodeId);
    this.episodeFocusGate.recordCurrentFocus(episodeId, targetEpisodeId);
  }

  private resumeTargetEpisodeId(): string | null {
    const plan = this.resumePlan;
    return plan !== null && plan.target !== undefined && plan.target !== null ? plan.target.episode_id : null;
  }

  private seriesEpisodeFocusReporter(episodeId: string, workId: string,
                                     generation: number): () => void {
    return (): void => {
      if (generation === this.seriesFocusGeneration && workId === this.workId) {
        this.seriesEpisodeCardFocused(episodeId);
        this.tryInitialEpisodeFocus(null, null, workId, generation);
      }
    };
  }

  private initialEpisodeIndex(rail: DetailRail): number {
    const detail = this.detail;
    const plan = this.resumePlan;
    if (detail === null || detail.work.kind !== 'series' || !this.targetSeriesSeasonCentered || plan === null || !hasSeriesResumeTarget(detail, plan) ||
        plan.target === undefined || plan.target === null) {
      return -1;
    }
    return episodeIndexForTarget(
      rail.items.map((item: DetailRow): string => item.id),
      plan.target.episode_id,
      !this.episodeFocusSuppressed && this.episodeFocusGate.isPending()
    );
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
        onCardFocus: this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration),
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
        onCardFocus: this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration),
        onSelect: () => { this.selectRow((item as DetailRow)); },
      })
    }
  }

  private episodeUnseen(row: DetailRow): boolean {
    const file = row.mediaFileId;
    // TV draws the dot too, from the card's own prop: no restamp (it would rebuild the cards and reset the artwork)
    return file !== null && watchMarkFor(this.episodeProgress.get(file), this.episodeProgressLoaded).unseen;
  }

  /** Give each episode row a stamp that reflects its unseen dot (TV too: web draws it) and, on the phone, its ring, so the cards redraw when the data arrives. */
  private restampEpisodes(): void {
    // TV: restamping rebuilds cards and times out per-row artwork acceptance (run 38795686584); unseen changes flow through @State-backed props instead.
    if (isTvMetrics() || this.detail === null || this.detail.work.kind !== 'series') {
      return;
    }
    const nextUp = this.nextUpEpisodeId();
    const next: DetailRail[] = [];
    for (const rail of this.rails) {
      const items: DetailRow[] = [];
      for (const row of rail.items) {
        items.push({
          id: row.id,
          title: row.title,
          subtitle: row.subtitle,
          mediaFileId: row.mediaFileId,
          similarWorkId: row.similarWorkId,
          episodeHasThumb: row.episodeHasThumb,
          episodeCaption: row.episodeCaption,
          episodeNumberOverlay: row.episodeNumberOverlay,
          startMs: row.startMs,
          stamp: (this.episodeUnseen(row) ? 'u' : 's') + (nextUp === row.id ? 'r' : 'n'),
        });
      }
      next.push({ id: rail.id, heading: rail.heading, items: items });
    }
    this.rails = next;
  }

  private async loadEpisodeProgress(): Promise<void> {
    const result = await listWatchProgress();
    if (result.kind === 'ok') {
      const byFile = new Map<string, WatchProgress>();
      for (const row of result.value) {
        byFile.set(row.media_file_id, row);
      }
      this.episodeProgress = byFile;
      this.episodeProgressLoaded = true;
      this.restampEpisodes();
    }
  }

  /** The episode web rings on open: the resume target, else (everything watched) the first episode of the first season. */
  private nextUpEpisodeId(): string {
    const plan = this.resumePlan;
    if (plan !== null && plan.target !== undefined && plan.target !== null) {
      return plan.target.episode_id;
    }
    return this.rails.length > 0 && this.rails[0].items.length > 0 ? this.rails[0].items[0].id : '';
  }

  @Builder
  private seriesEpisodeItem(item: MediaRailItem, index: number, activeRailFactor: number, railId: string): void {
    DetailRowArtworkCard({
      artworkStore: this.artworkStore,
      rowId: (item as DetailRow).id,
      measurementId: this.seriesMeasurementId('card', this.workId, this.seriesFocusGeneration, railId,
        (item as DetailRow).id, index),
      imageMeasurementId: this.seriesMeasurementId('image', this.workId, this.seriesFocusGeneration, railId,
        (item as DetailRow).id, index),
      variant: 'titleEpisode',
      title: (item as DetailRow).title,
      subtitle: '',
      episodeCaption: (item as DetailRow).episodeCaption ?? '',
      episodeNumberOverlay: (item as DetailRow).episodeNumberOverlay ?? '',
      focusId: seriesEpisodeFocusId((item as DetailRow).id),
      titleFontSize: isTvMetrics() ? 11.904 : 12.4, // web phone's episode caption is a little larger than the TV's
      subtitleFontSize: isTvMetrics() ? 8.832 : 9.5,
      ringOn: !isTvMetrics() && this.nextUpEpisodeId() === (item as DetailRow).id,
      unseen: this.episodeUnseen(item as DetailRow),
      cardWidth: this.seriesCardWidth(),
      cardHeight: Math.round(this.seriesCardWidth() * 9 / 16),
      activeRailFactor: activeRailFactor,
      onCardAppear: (): void => { this.seriesEpisodeCardAppeared(railId, (item as DetailRow).id, index); },
      onArtworkAreaChanged: this.seriesCardArtworkAreaReporter(railId, (item as DetailRow).id, index,
        this.workId, this.seriesFocusGeneration),
      onCardFocus: this.seriesEpisodeFocusReporter(
        (item as DetailRow).id,
        this.workId,
        this.seriesFocusGeneration
      ),
      onSelect: () => { this.selectRow((item as DetailRow)); },
    })
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
        cardWidth: tv(TvGeometry.homeRailCardWidthLandscape),
        cardHeight: Math.round((tv(TvGeometry.homeRailCardWidthLandscape) * 9) / 16),
        artworkRadius: Radii.homeCardArtworkTv,
        activeRailFactor: activeRailFactor,
        onCardFocus: this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration),
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
        onCardFocus: this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration),
        onSelect: () => { this.selectRow((item as DetailRow)); },
      })
    }
  }

  private playInk(): ResourceColor {
    return this.playFocused && !isTvMetrics() ? '#ffffff' : toResourceColor(isTvMetrics() ? activeColors().onAccent : activeColors().bg);
  }

  /** Phone play glyph: a drawn triangle, because the Previewer renders the text glyph as an emoji box. */
  @Builder
  private playTriangle(): void {
    Polygon({ width: 8, height: 9 })
      .points([[0, 0], [0, 9], [8, 4.5]])
      .fill(this.playInk())
      .width(8)
      .height(9)
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
      if (isTvMetrics()) {
        Text('\u25B6').fontFamily(nunito(400))
          .fontSize(PLAY_BUTTON_ICON_SIZE)
          .fontColor(this.playInk())
      } else {
        this.playTriangle()
      }
      Text(this.primaryLabel()).fontFamily(nunito(700))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .fontSize(isTvMetrics() ? PLAY_BUTTON_LABEL_SIZE : 11)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.playInk())
    }
    .layoutWeight(1)
    .height(height)
    .padding({ left: Spacing.lg, right: Spacing.lg })
    .borderRadius(Radii.pillFull)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor((enabled ? (this.playFocused && !isTvMetrics() ? PLAY_FOCUS_FILL : toResourceColor(isTvMetrics() ? activeColors().accent : activeColors().ink)) : toResourceColor(activeColors().inkMuted)))
    .opacity((enabled ? 1 : 0.6))
    .focusable(enabled)
    .defaultFocus(enabled && !isTvMetrics())
    .scale(this.playFocused && !isTvMetrics() ? { x: 1.06, y: 1.06 } : { x: 1, y: 1 })
    .onFocus((): void => {
      this.playFocused = true;
      this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration)();
    })
    .onBlur((): void => {
      this.playFocused = false;
    })
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
      return t('pages.home.workKind.series', 'Series');
    }
    if (kind === 'artist') {
      return t('shell.nav.music', 'Music');
    }
    return t('shell.nav.movies', 'Movies');
  }

  /** The nav tile that stays marked on this page: the title's own kind (`movie`, `series`, `artist`). */
  private shellNavId(): string {
    return this.detail !== null ? this.detail.work.kind : '';
  }

  /** Web's series detail draws its secondary actions as flat text beside the filled Start pill (movie detail keeps the translucent capsules). */
  private isSeriesPage(): boolean {
    return this.detail !== null && this.detail.work.kind === 'series';
  }

  /** Web's series pills carry a soft drop shadow (light theme; the dark pills are flat). */
  private pillShadow(primary: boolean): ShadowOptions {
    if (resolvedThemeMode() === 'dark') {  // the film page's light pills take the series page's white fill and shadow (static-server refs)
      return { radius: 0, color: Color.Transparent };
    }
    return primary
      ? { radius: tv(22), offsetY: tv(10), color: 'rgba(56, 38, 33, 0.28)' }
      : { radius: tv(22), offsetY: tv(8), color: 'rgba(56, 38, 33, 0.08)' };
  }

  /** The TV film Play pill in web's focused look (accent fill, ring): web opens a film with Play focused. */
  private filmPlayFocused(primary: boolean): boolean {
    return primary && isTvMetrics() && !this.isSeriesPage() && this.playFocused;
  }

  /** Web's action pill: a glyph and a label in a rounded translucent capsule, the primary one filled. */
  @Builder
  private actionPill(label: string, glyph: string, primary: boolean, enabled: boolean, onPress: () => void): void {
    Row({ space: tv(primary ? PILL_PRIMARY_GAP : PILL_SECONDARY_GAP) }) {
      Text(glyph).fontFamily(nunito(400))
        .fontSize(tv(primary ? PILL_PRIMARY_FONT * 0.85 : PILL_SECONDARY_FONT * 1.15))
        .fontColor(primary ? (this.filmPlayFocused(primary) ? '#ffffff' : toResourceColor(activeColors().bg)) : (resolvedThemeMode() === 'dark' ? PILL_GLYPH_DARK : PLAY_FOCUS_FILL))  // web: the secondary pills' glyph is pink
      Text(label).fontFamily(nunito(700))
        .fontSize(tv(primary ? PILL_PRIMARY_FONT : PILL_SECONDARY_FONT))
        .fontWeight(FontWeight.Bold)
        .fontColor(primary ? (this.filmPlayFocused(primary) ? '#ffffff' : toResourceColor(activeColors().bg)) : toResourceColor(activeColors().ink))
        .maxLines(1)
    }
    .height(tv(PILL_HEIGHT))
    .constraintSize({ minWidth: tv(primary ? PILL_PRIMARY_MIN_WIDTH : PILL_SECONDARY_MIN_WIDTH) })
    .padding({ left: tv(primary ? PILL_PRIMARY_PADDING_X : PILL_PADDING_X), right: tv(primary ? PILL_PRIMARY_PADDING_X : PILL_PADDING_X) })
    .borderRadius(tv(PILL_HEIGHT / 2))
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor(primary ? (this.filmPlayFocused(primary) ? PLAY_FOCUS_FILL : toResourceColor(activeColors().ink)) : resolvedThemeMode() === 'dark' ? (this.isSeriesPage() ? toResourceColorWithAlpha(activeColors().ink, 0) : toResourceColorWithAlpha(activeColors().ink, PILL_FILL_ALPHA)) : toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
    .shadow(this.pillShadow(primary))
    .border(this.filmPlayFocused(primary) ? { width: tv(3), color: resolvedThemeMode() === 'dark' ? '#ffffff' : toResourceColor(activeColors().ink) } : { width: 0 })
    .opacity(enabled ? 1 : 0.5)
    .focusable(enabled)
    .defaultFocus(enabled && primary && !this.isSeriesPage())
    .onFocus((): void => {
      if (primary) {
        this.playFocused = true;
      }
      this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration)();
    })
    .onBlur((): void => {
      if (primary) {
        this.playFocused = false;
      }
    })
    .onClick(() => {
      this.cancelInitialEpisodeFocus();
      onPress();
    })
  }

  @Builder
  private tvActions(): void {
    if (this.detail !== null && this.detail.work.kind === 'series') {
      this.tvSeriesActions()
    } else {
      this.tvTitleActions()
    }
  }

  /** Web's series actions: one row, the Start / Resume pill (once the resume plan is there), Ask again when a choice is remembered, then the watchlist and playlist pills. */
  @Builder
  private tvSeriesActions(): void {
    Row({ space: tv(PILL_GAP) }) {
      if (this.resumePlan !== null && this.resumePlan.target !== undefined && this.resumePlan.target !== null) {
        this.actionPill(resumeButtonLabel(this.resumePlan), '\u25BA', true, this.primaryMediaFileId !== null, (): void => {
          this.playPrimary();
        })
        if (this.resumePlan.action !== 'start') {
          this.actionPill(t('pages.workDetail.resumeAskAgain', 'Ask again'), '\u21BA', false, true, (): void => {
            void this.askAgain();
          })
        }
      }
      this.actionPill(this.listed === true ? t('discovery.watchlist.remove', 'Remove from watchlist') : t('discovery.watchlist.add', 'Add to watchlist'), this.listed === true ? '\u2713' : '+', false, true, (): void => {
        void this.toggleWatchlist();
      })
      this.actionPill(t('components.mediaContextMenu.addToPlaylist', 'Add to Playlist'), '+', false, true, (): void => {
        this.actionsOpen = true;
      })
    }
  }

  private async askAgain(): Promise<void> {
    if (this.detail === null) {
      return;
    }
    await clearResumeChoices(this.detail.work.id);
    await this.loadResumePlan(this.detail.work.id);
  }

  @Builder
  private tvTitleActions(): void {
    Column({ space: tv(PILL_ROW_GAP) }) {
      Row({ space: tv(PILL_GAP) }) {
        this.actionPill(t('components.mediaContextMenu.download', 'Download'), '\u21E9', false, this.primaryMediaFileId !== null, (): void => {
          this.actionsOpen = true;
        })
        if (this.primaryMediaFileId !== null && this.detail !== null && this.detail.work.kind === 'movie') {
          this.actionPill(t('pages.workDetail.playbackButtonLabel', 'Playback'), '\u2630', false, true, (): void => {
            this.optionsOpen = true;
          })
        }
        this.actionPill(this.primaryLabel(), '\u25BA', true, this.primaryMediaFileId !== null, (): void => {
          this.playPrimary();
        })
      }
      Row({ space: tv(PILL_GAP) }) {
        this.actionPill(this.listed === true ? t('discovery.watchlist.remove', 'Remove from watchlist') : t('discovery.watchlist.add', 'Add to watchlist'), this.listed === true ? '\u2713' : '+', false, true, (): void => {
          void this.toggleWatchlist();
        })
        this.actionPill(t('components.mediaContextMenu.addToPlaylist', 'Add to Playlist'), '+', false, true, (): void => {
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
    this.restampEpisodes();
    const target = resumeTargetFile(result.value);
    if (target !== null) {
      this.primaryMediaFileId = target;
    }
    if (result.value.target !== undefined && result.value.target !== null) {
      const targetEpisodeId = result.value.target.episode_id;
      const targetRail = this.rails.find((rail: DetailRail): boolean =>
        rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) >= 0
      );
      if (targetRail !== undefined) {
        this.centreTargetSeriesSeason(targetRail);
      }
    }
    this.tryInitialEpisodeFocus();
  }

  /** The primary pill's label: Resume from m:ss for a part-watched movie, else Play (Unavailable while nothing is playable). */
  private primaryLabel(): string {
    if (this.primaryMediaFileId === null) {
      return t('pages.workDetail.unavailable', 'Unavailable');
    }
    if (this.resumePlan !== null) {
      return resumeButtonLabel(this.resumePlan);
    }
    if (this.resumeMs > 0) {
      return tf('pages.workDetail.resumeFrom', 'Resume from {{position}}', { position: chapterTimeLabel(this.resumeMs) });
    }
    return t('pages.workDetail.play', 'Play');
  }

  /** Web's cast circle: the person's initials (their headshot over them when there is one) and their name under it. */
  @Builder
  private castItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    Column({ space: tv(8) }) {
      Stack() {
        Text(initialsOf((item as CastRow).name)).fontFamily(nunito(500))
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
      .onFocus(this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration))
      Text((item as CastRow).name).fontFamily(nunito(400))
        .fontSize(tv(12))
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width(tv(CAST_CIRCLE + 20))
        .textAlign(TextAlign.Center)
    }
    .width(tv(CAST_CIRCLE + 20))
    .margin({ left: tv(CAST_LEFT_INSET) })
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
  private railHeading(heading: string, count: string, phoneSeasonHeading: boolean = false): void {
    Column({ space: phoneSeasonHeading && !isTvMetrics() ? 8.3 : tv(phoneSeasonHeading ? 7 : 4) }) {
      Text(heading).fontFamily(nunito(400))
        .fontSize(phoneSeasonHeading && !isTvMetrics() ? 16 : tv(TvGeometry.railHeadingSize))
        .fontColor(toResourceColor(activeColors().ink))
      Text(count).fontFamily(nunito(400))
        .fontSize(phoneSeasonHeading && !isTvMetrics() ? 10.4 : tv(phoneSeasonHeading ? 10 : 11))
        .fontColor(toResourceColor(activeColors().inkMuted))
    }
    .alignItems(HorizontalAlign.Start)
  }

  /** The right-hand column on web: the Chapters rail, then the Cast rail, straight on the page (no glass panel). */
  @Builder
  private tvRightColumn(): void {
    Column({ space: tv(RIGHT_COLUMN_GAP) }) {
      if (this.detail !== null && this.detail.work.kind === 'series') {
        this.tvSeriesSeasonRows()
      } else {
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
      }
      if (this.chaptersRail !== null) {
        Column({ space: tv(SERIES_SEASON_HEADER_CARD_GAP) }) {
          this.railHeading(t('pages.workDetail.chaptersHeading', 'Chapters'), this.chaptersGenerated ? tf('pages.workDetail.sceneMarkersCount', '{{count}} scene markers', { count: this.chaptersRail.items.length.toString() }) : tf('pages.workDetail.chaptersCount', '{{count}} chapters', { count: this.chaptersRail.items.length.toString() }))
          MediaRail({
            railId: 'chapters',
            headingGap: 0,
            listHeight: isTvMetrics() ? tv(SERIES_EPISODE_LIST_HEIGHT) : 0,
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
        Column({ space: tv(SERIES_SEASON_HEADER_CARD_GAP) }) {
          this.railHeading(t('pages.workDetail.cast', 'Cast'), this.cast.length.toString() + ' people')
          MediaRail({
            railId: 'cast',
            headingGap: 0,
            listHeight: tv(CAST_CIRCLE + CAST_LIST_EXTRA),
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
        // web: landscape cards (the Library's size) under a heading with the title count
        Column({ space: tv(SERIES_SEASON_HEADER_CARD_GAP) }) {
          this.railHeading(this.similarRail.heading, tf(this.similarRail.items.length === 1 ? 'pages.workDetail.titlesCountOne' : 'pages.workDetail.titlesCountOther', this.similarRail.items.length === 1 ? '{{count}} title' : '{{count}} titles', { count: this.similarRail.items.length.toString() }))
          MediaRail({
            railId: this.similarRail.id,
            headingGap: 0,
            listHeight: tv(Math.round(TvGeometry.homeRailCardWidthLandscape * 9 / 16) + SIMILAR_LIST_EXTRA),
            itemGap: tv(TvGeometry.railItemGapHome),
            items: this.similarRail.items,
            itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
              this.similarItem(item, index, activeRailFactor);
            },
          })
        }
        .alignItems(HorizontalAlign.Start)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  /** The episode card width: the TV stage's, or web phone's 187 vp. */
  private seriesCardWidth(): number {
    return isTvMetrics() ? tv(SERIES_EPISODE_CARD_WIDTH) : PHONE_EPISODE_CARD_WIDTH;
  }

  @Builder
  private tvSeriesSeasonRows(): void {
    Column({ space: isTvMetrics() ? tv(SERIES_SEASON_ROW_GAP) : PHONE_SEASON_ROW_GAP }) {
      ForEach(
        this.rails,
        (rail: DetailRail) => {
          Column({ space: isTvMetrics() ? tv(SERIES_SEASON_HEADER_CARD_GAP - 2) : PHONE_SEASON_HEADER_CARD_GAP }) { // -2: web's cards start 2 px higher
            this.railHeading(rail.heading, rail.items.length.toString() + ' episodes', true)
            MediaRail({
              railId: rail.id,
              measurementId: this.seriesMeasurementId('rail', this.workId, this.seriesFocusGeneration, rail.id),
              heading: '',
              headingGap: 0,
              itemGap: isTvMetrics() ? tv(TvGeometry.railItemGapTitle + 2) : PHONE_EPISODE_RAIL_GAP, // +2: web pitch 294 vs 292
              clipInsetStart: isTvMetrics() ? 8 : PHONE_DETAIL_RAIL_CLIP_START,
              clipInsetTop: isTvMetrics() ? 24 : PHONE_DETAIL_RAIL_CLIP_TOP,
              allowFocusedOverflow: isTvMetrics(), // the focused card's ring and lift stay inside the rail's padding, not clipped at the list edge
              bleedEnd: isTvMetrics() ? 0 : atLeast(16, this.safeRight), // web: the season rails run to the screen edge
              overflowItems: true, // TV too: the focused card shadow was cut to a visible band behind the first episode row (parity)
              items: rail.items,
              listHeight: isTvMetrics() ? tv(SERIES_EPISODE_LIST_HEIGHT) : PHONE_SEASON_LIST_HEIGHT,
              initialItemIndex: this.initialEpisodeIndex(rail),
              onInitialItemPositioned: (): void => { this.seriesEpisodeIndexPositioned(rail); },
              onListAreaChange: this.seriesRailAreaReporter(rail.id, this.workId, this.seriesFocusGeneration),
              onListOffsetChange: this.seriesRailOffsetReporter(rail.id, this.workId, this.seriesFocusGeneration),
              onItemAreaChange: this.seriesRailItemAreaReporter(
                rail.id, this.workId, this.seriesFocusGeneration
              ),
              itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
                this.seriesEpisodeItem(item, index, activeRailFactor, rail.id);
              },
            })
          }
          .alignItems(HorizontalAlign.Start)
          .onAreaChange((_oldArea: Area, area: Area) => {
            this.onSeriesSeasonRowAreaChanged(rail, area);
          })
        },
        (rail: DetailRail): string => rail.id
      )
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .margin({ top: isTvMetrics() ? 0 : 36.8 })
  }

  @Builder
  private chapterItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    DetailRowArtworkCard({
      artworkStore: this.artworkStore,
      rowId: (item as DetailRow).id,
      variant: 'titleEpisode',
      title: (item as DetailRow).title,
      subtitle: (item as DetailRow).subtitle,
      episodeCaption: (item as DetailRow).episodeCaption ?? '',
      episodeNumberOverlay: ((item as DetailRow).episodeNumberOverlay ?? ''), // parenthesised: the capture patch anchors on the series card's line
      cardWidth: tv(CHAPTER_CARD_WIDTH),
      cardHeight: tv(CHAPTER_CARD_HEIGHT),
      activeRailFactor: activeRailFactor,
      onCardFocus: this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration),
      onSelect: () => { this.selectRow((item as DetailRow)); },
    })
  }

  @Builder
  private tvContent(): void {
    Stack() {
      KeyArtBackdrop({ keyArt: this.heroArtwork, railFrostWidthPct: 65 })

      Column({ space: tv(COPY_GAP - (this.isSeriesPage() ? 20 : 0)) }) {
        FeatureCopy({
          kicker: this.tvCopyKicker(),
          title: (this.detail !== null ? this.detail.work.title : ''),
          subtitle: this.tvCopySubtitle(),
          metaChips: this.detail !== null ? metaChips(this.detail, this.hasResumeTarget() ? this.resumePlan : null) : [],
          synopsis: this.tvCopySynopsis(),
        })
        this.tvActions()
      }
      .width(`${TvGeometry.detailCopyColumnWidthRatio * 100}%`)
      .alignItems(HorizontalAlign.Start)
      .position({ x: tv(TvGeometry.detailCopyColumnStart), y: tv(TvGeometry.detailCopyColumnTop) })

      if (this.detail !== null && this.detail.work.kind === 'series') {
        Scroll(this.seriesStackScroller) {
          Column() {
            this.tvRightColumn()
          }
          .width('100%')
          .padding({ left: tv(SERIES_COLUMN_BLEED) })
        }
        .id(this.seriesMeasurementId('page', this.workId, this.seriesFocusGeneration, ''))
        .align(Alignment.Top)
        .width(tv(RIGHT_COLUMN_WIDTH + SERIES_COLUMN_BLEED))
        .height(tv(SERIES_COLUMN_HEIGHT))
        .scrollBar(BarState.Off)
        // The scroll box starts BLEED left of the column so the first card's focus ring (and lift) is not cut at the box edge.
        .position({ x: tv(RIGHT_COLUMN_X - SERIES_COLUMN_BLEED), y: tv(SERIES_COLUMN_TOP) })
        .onAreaChange(this.seriesPageAreaReporter(this.workId, this.seriesFocusGeneration))
        .onScroll(this.seriesPageScrollReporter(this.workId, this.seriesFocusGeneration))
      } else {
        Scroll() {
          this.tvRightColumn()
        }
        .align(Alignment.Top)
        .width(tv(RIGHT_COLUMN_WIDTH))
        .height(tv(RIGHT_COLUMN_HEIGHT))
        .scrollBar(BarState.Off)
        .position({ x: tv(RIGHT_COLUMN_X), y: tv(RIGHT_COLUMN_Y) })
      }
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

  /** Phone (web focuses the next-up episode and scrolls it to the middle of the page): once the card is laid out, centre it and focus it.
   * Polls for the plan and the card, then stops; any touch or key press cancels it. */
  private settleTouchEpisode(attempt: number): void {
    const detail = this.detail;
    const plan = this.resumePlan;
    if (this.touchEpisodeSettled || this.episodeFocusSuppressed || (detail !== null && detail.work.kind !== 'series')) {
      return;
    }
    if (attempt > TOUCH_SETTLE_ATTEMPTS) {
      // shortcut: the Previewer's getRectangleById is a mock that reports no size, so land on web's measured scroll instead; a device never gets here
      this.touchEpisodeSettled = true;
      this.touchScroller.scrollTo({ xOffset: 0, yOffset: TOUCH_SETTLE_FALLBACK_VP, animation: false });
      // web opens with the next-up episode focused; the mock reports no size, so focus it by id as the device path does
      if (detail !== null && plan !== null && plan.target !== undefined && plan.target !== null) {
        try {
          this.getUIContext().getFocusController().requestFocus(seriesEpisodeFocusId(plan.target.episode_id));
        } catch (_err) {
          // the card is not laid out yet: nothing to focus
        }
      }
      return;
    }
    const retry = (): void => {
      setTimeout((): void => { this.settleTouchEpisode(attempt + 1); }, TOUCH_SETTLE_INTERVAL_MS);
    };
    if (detail === null || plan === null || !hasSeriesResumeTarget(detail, plan) || plan.target === undefined || plan.target === null) {
      retry();
      return;
    }
    const cardId = seriesEpisodeFocusId(plan.target.episode_id);
    try {
      const ctx = this.getUIContext();
      const card = ctx.getComponentUtils().getRectangleById(cardId);
      const page = ctx.getComponentUtils().getRectangleById(TOUCH_SCROLL_ID);
      if (card.size.height <= 0 || page.size.height <= 0) {
        retry();
        return;
      }
      const delta = ctx.px2vp(card.windowOffset.y + card.size.height / 2 - page.windowOffset.y - page.size.height / 2);
      this.touchScroller.scrollBy(0, delta);
      this.touchEpisodeSettled = true;
      ctx.getFocusController().requestFocus(cardId);
    } catch (_err) {
      retry();
    }
  }

  /** Phone: the meta chips (web `.work-meta`): the first bold, the rest muted, 12 vp apart, wrapping. */
  @Builder
  private touchMetaChips(): void {
    Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(this.detail !== null && this.detail.work.kind === 'series' ? 9 : 10), cross: LengthMetrics.vp(this.detail !== null && this.detail.work.kind === 'series' ? 7.3 : 8) } }) {
      ForEach(this.detail !== null ? metaChips(this.detail, this.resumePlan) : [], (chip: string, index: number) => {
        Text(chip).fontFamily(nunito(index === 0 ? 700 : 400))
          .fontSize(10.24)
          .fontWeight(index === 0 ? FontWeight.Bold : FontWeight.Normal)
          .fontColor(toResourceColor(index === 0 ? activeColors().ink : activeColors().inkSoft))
      }, (chip: string, index: number): string => index.toString() + chip)
    }
    .width('100%')
    .margin({ top: 12 })
  }

  /** Phone: web's action rows. Download, Playback and Add to Playlist open the title actions drawer; Play is the primary pill. */
  @Builder
  private touchActionButton(label: string, onTap: () => void, size: number = 8, glyph: string = '', share: boolean = false): void {
    Text(glyph.length > 0 ? glyph + '  ' + label : label).fontFamily(nunito(500))
      .fontSize(size)
      .fontWeight(FontWeight.Medium)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .height(44)
      .textAlign(TextAlign.Center)
      .padding({ left: 16, right: 16 })
      .borderRadius(22)
      .layoutWeight(share ? 1 : 0)
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
      .border({ width: 1, color: Color.Transparent })
      .onClick(() => {
        this.cancelInitialEpisodeFocus();
        onTap();
      })
  }

  /** Phone series (web phone series detail): one row, the Start pill and the two secondary actions, labels at web's 8 vp. */
  @Builder
  private touchSeriesAction(label: string, onTap: () => void): void {
    Row({ space: 4 }) {
      Text('+').fontFamily(nunito(700))
        .fontSize(8)
        .fontColor(toResourceColor(resolvedThemeMode() === 'dark' ? BRAND_PINK_SOFT : activeColors().accent))
      Text(label).fontFamily(nunito(700))
        .fontSize(8)
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
    }
    .layoutWeight(1)
    .height(44)
    .justifyContent(FlexAlign.Center)
    .borderRadius(22)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
    .border({ width: 1, color: Color.Transparent })
    .onClick(() => {
      this.cancelInitialEpisodeFocus();
      onTap();
    })
  }

  @Builder
  private touchSeriesActionRow(): void {
    Row({ space: 8 }) {
      Row({ space: 6 }) {
        this.playTriangle()
        Text(this.primaryLabel()).fontFamily(nunito(700))
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .maxLines(1)
          .fontColor(toResourceColor(activeColors().bg))
      }
      .width(100)
      .height(44)
      .justifyContent(FlexAlign.Center)
      .borderRadius(22)
      // web `.tv-detail-play`: the ink fill with the page colour as label
      .backgroundColor(this.primaryMediaFileId !== null ? toResourceColor(activeColors().ink) : toResourceColor(activeColors().inkMuted))
      .opacity(this.primaryMediaFileId !== null ? 1 : 0.6)
      .focusable(this.primaryMediaFileId !== null)
      .onFocus(this.otherDetailFocusReporter(this.workId, this.seriesFocusGeneration))
      .onClick(() => {
        this.playPrimary();
      })
      this.touchSeriesAction(this.listed === true ? t('discovery.watchlist.remove', 'Remove from watchlist') : t('discovery.watchlist.add', 'Add to watchlist'), (): void => {
        this.toggleWatchlist();
      })
      this.touchSeriesAction(t('components.mediaContextMenu.addToPlaylist', 'Add to Playlist'), (): void => {
        this.touchActionsOpen = true;
      })
    }
    .width('100%')
  }

  @Builder
  private touchActionRows(): void {
    if (this.detail !== null && this.detail.work.kind === 'series') {
      this.touchSeriesActionRow()
    } else {
      this.touchMovieActionRows()
    }
  }

  @Builder
  private touchMovieActionRows(): void {
    Row({ space: 8 }) {
      this.touchActionButton(t('components.mediaContextMenu.download', 'Download'), (): void => {
        this.touchActionsOpen = true;
      }, 8, '\u21E9', true)
      this.touchActionButton(t('pages.workDetail.playbackButtonLabel', 'Playback'), (): void => {
        this.touchActionsOpen = true;
      }, 11, '\u2637', true)
      this.playButton(this.primaryMediaFileId !== null, PLAY_BUTTON_HEIGHT_TOUCH)
    }
    // web phone film: the three pills share the row width (104 / 104 / 110 vp)
    .width('100%')
    Row({ space: 8 }) {
      this.touchActionButton(this.listed === true ? t('discovery.watchlist.remove', 'Remove from watchlist') : t('discovery.watchlist.add', 'Add to watchlist'), (): void => {
        this.toggleWatchlist();
      }, 8, this.listed === true ? '\u2713' : '+')
      this.touchActionButton(t('components.mediaContextMenu.addToPlaylist', 'Add to Playlist'), (): void => {
        this.touchActionsOpen = true;
      }, 8, '+')
    }
    .margin({ top: 11 })
  }

  /** Phone (web phone detail): the backdrop fading into the page at the top, Back over it, then the pink kind line, the title, the
   * meta line, three lines of synopsis, the Play pill and the rails. */
  @Builder
  private touchLayout(): void {

    Stack({ alignContent: Alignment.TopStart }) {
      // web: the art, Back row and text are one page, so they scroll away together
      Scroll(this.touchScroller) {
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
          colors: [[toResourceColorWithAlpha(activeColors().surface, 0.78), 0.0], [toResourceColorWithAlpha(activeColors().surface, 0.9), 0.55], [toResourceColor(activeColors().surface), 1.0]],
        })

        Column({ space: TouchGeometry.detailListSpacing }) {
          Column() {
            Text(this.resumePlan !== null && resumeKicker(this.resumePlan).length > 0 ? resumeKicker(this.resumePlan) : (this.detail !== null ? (this.detail.work.genres.length > 0 ? this.detail.work.genres[0] : kindLabel(this.detail.work.kind)) : '')).fontFamily(nunito(900))
              .fontSize(10.56)
              .height(16)
              .fontWeight(FontWeight.Bolder)
              .letterSpacing(0.8)
              .textCase(TextCase.UpperCase)
              .fontColor(toResourceColor(BRAND_PINK_SOFT))
              .margin({ bottom: 10 })
            Text(this.detail !== null ? this.detail.work.title : '').fontFamily(nunito(500))
              .fontSize(36)
              .fontWeight(FontWeight.Medium)
              .letterSpacing(-1.6)
              .lineHeight(34)
              .fontColor(toResourceColor(activeColors().ink))
              // web phone: a series title wraps at about 250 vp (measured on the static fixture: "Golden / Cathedral 1")
              .constraintSize({ maxWidth: this.detail !== null && this.detail.work.kind === 'series' ? 250 : '100%' })
            if (this.detail !== null && planEpisodeTitle(this.detail, this.resumePlan).length > 0) {
              Text(planEpisodeTitle(this.detail, this.resumePlan)).fontFamily(nunito(500))
                .fontSize(14.4)
                .fontWeight(FontWeight.Medium)
                .fontColor(toResourceColor(activeColors().ink))
                .maxLines(1)
                .margin({ top: 3 })
            }
            this.touchMetaChips()
            Text(this.detail !== null ? planSynopsis(this.detail, this.resumePlan) : '').fontFamily(nunito(400))
              .fontSize(11.52)
              .fontColor(toResourceColor(activeColors().inkSoft))
              .lineHeight(16.7)
              .margin({ top: this.detail !== null && this.detail.work.kind === 'series' ? (planEpisodeTitle(this.detail, this.resumePlan).length > 0 ? 11.7 : 10) : 12 })
              .maxLines(3)
              // web phone: a series synopsis reserves its three lines, so the actions sit at the same y for any text
              .constraintSize({ minHeight: this.detail !== null && this.detail.work.kind === 'series' ? 50.1 : 0 })
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Column() {
              this.touchActionRows()
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .margin({ top: this.detail !== null && this.detail.work.kind === 'series' ? 12.5 : 12 })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          // the TV page's rails, Chapters and Cast column, one copy: its sizes are web CSS px, which are vp here
          // web phone: the rails of a film sit on a glass panel that fades in from the left edge, bleeding to both sides.
          // Series keep the unpanelled rails: a panel layer behind the season rails left the dark episode art unpainted in the Previewer.
          if (this.detail !== null && this.detail.work.kind === 'series') {
            this.tvRightColumn()
          } else {
            Stack({ alignContent: Alignment.TopStart }) {
              Column()
                .width('100%')
                .height('100%')
                .linearGradient({
                  direction: GradientDirection.Right,
                  colors: resolvedThemeMode() === 'dark' ?
                    [['rgba(255, 244, 255, 0)', 0.0], ['rgba(255, 244, 255, 0.058)', 0.35], ['rgba(255, 244, 255, 0.058)', 1.0]] :
                    [['rgba(255, 255, 255, 0.71)', 0.0], ['rgba(255, 255, 255, 0.71)', 1.0]],
                })
              Column() {
                this.tvRightColumn()
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ top: 36, left: atLeast(16, this.safeLeft), right: atLeast(16, this.safeRight) })
            }
            .width(`calc(100% + ${atLeast(16, this.safeLeft) + atLeast(16, this.safeRight)}vp)`)
            .margin({ left: -atLeast(16, this.safeLeft) })
          }
        }
        .padding({
          top: TOUCH_TEXT_TOP,
          bottom: TouchGeometry.detailListBottom,
          left: atLeast(16, this.safeLeft),
          right: atLeast(16, this.safeRight),
        })
        .width('100%')
        .alignItems(HorizontalAlign.Start)

       }
       .width('100%')
      }
      .id(TOUCH_SCROLL_ID)
      .width('100%')
      .height('100%')
      .align(Alignment.Top)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      .onAppear(() => { this.settleTouchEpisode(0); })

      // web (#175): on phones the Back row stays pinned and the content fades out under it (solid to the row, then the edge fade)
      Column()
        .width('100%')
        .height(atLeast(PHONE_HEADER_TOP, this.safeTop) + PHONE_BACK_SIZE + PHONE_HEADER_GAP + PHONE_HEADER_FADE)
        .linearGradient({
          direction: GradientDirection.Bottom,
          colors: [
            [toResourceColor(activeColors().surface), 0.0],
            [toResourceColor(activeColors().surface), (atLeast(PHONE_HEADER_TOP, this.safeTop) + PHONE_BACK_SIZE + PHONE_HEADER_GAP) / (atLeast(PHONE_HEADER_TOP, this.safeTop) + PHONE_BACK_SIZE + PHONE_HEADER_GAP + PHONE_HEADER_FADE)],
            [toResourceColorWithAlpha(activeColors().surface, 0), 1.0],
          ],
        })
        .hitTestBehavior(HitTestMode.None)
      Row({ space: 10 }) {
        Text('←').fontFamily(nunito(700))
          .fontSize(11)
          .fontWeight(FontWeight.Normal)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)
          .width(PHONE_BACK_SIZE)
          .height(PHONE_BACK_SIZE)
          .borderRadius(PHONE_BACK_SIZE / 2)
          .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
          .onClick(() => {
            popRoute(getNavStack());
          })
        Text(this.detail !== null ? (this.detail.work.kind === 'series' ? t('pages.home.workKind.series', 'Series') : kindLabel(this.detail.work.kind) + 's') : '').fontFamily(nunito(500))
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(activeColors().ink))
      }
      .padding({ left: atLeast(16, this.safeLeft), top: atLeast(PHONE_HEADER_TOP, this.safeTop) })
      .alignItems(VerticalAlign.Center)

      // Keep the floating nav above page overlays and below title actions.
      TouchNavBar({ selectedId: this.detail !== null ? this.detail.work.kind : '' })
        .position({ x: 0, y: '100%' })
        .markAnchor({ x: 0, y: touchNavBarBox(this.safeBottom) })

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
    .backgroundColor(toResourceColor(activeColors().surface))
  }

  @Builder
  private busyOrErrorState(): void {
    if (this.loadFailed) {
      AsyncState({
        kind: AsyncStateKind.Error,
        message: this.errorMessage,
        retryLabel: t('pages.downloads.retry', 'Retry'),
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
        .backgroundColor(toResourceColor(isTvMetrics() ? activeColors().bg : activeColors().surface))
      } else if (isTvMetrics()) {
        this.tvLayout()
      } else {
        this.touchLayout()
      }
    }
    .hideTitleBar(true)
    .backgroundColor(toResourceColor(isTvMetrics() ? activeColors().bg : activeColors().surface))
    .onKeyEvent((event: KeyEvent): boolean => {
      if (event.type === KeyType.Down) {
        this.cancelInitialEpisodeFocus();
      }
      return false;
    })
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
