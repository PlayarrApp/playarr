/** TV series episode-card geometry and next-up focus claim rules. */
export const SERIES_EPISODE_CARD_WIDTH: number = 268;
export const SERIES_EPISODE_LIST_HEIGHT: number = 220;
export const SERIES_EPISODE_CAPTION_TOP_PADDING: number = 11.52;
export const SERIES_EPISODE_CAPTION_TITLE_GAP: number = 8.8;
export const SERIES_SEASON_HEADER_CARD_GAP: number = 24;
export const SERIES_SEASON_ROW_GAP: number = 32;

export function seriesEpisodeCaption(seasonNumber: number, episodeNumber: number): string {
  return 'S' + twoDigits(seasonNumber) + ' · E' + twoDigits(episodeNumber);
}

export function seriesEpisodeOverlayNumber(episodeNumber: number): string {
  return twoDigits(episodeNumber);
}

export function seriesEpisodeFocusId(episodeId: string): string {
  return 'detail-episode-' + episodeId;
}

/** A non-focusable measurement ID scoped to one Detail route row instance. */
export function seriesDetailMeasurementId(kind: string, workId: string, generation: number,
                                          railId: string, episodeId: string, occurrence: number): string {
  return 'detail-measure-' + encodeURIComponent('Detail') + '-' + encodeURIComponent(workId) + '-' +
    String(generation) + '-' + encodeURIComponent(kind) + '-' + encodeURIComponent(railId) + '-' +
    encodeURIComponent(episodeId) + '-' + String(occurrence);
}

export function isSeriesEpisodeTargetFocused(focusedEpisodeId: string, targetEpisodeId: string | null): boolean {
  return targetEpisodeId !== null && targetEpisodeId.length > 0 && focusedEpisodeId === targetEpisodeId;
}

export function episodeIndexForTarget(episodeIds: string[], targetEpisodeId: string | null,
                                      focusStillAllowed: boolean): number {
  if (!focusStillAllowed || targetEpisodeId === null) {
    return -1;
  }
  return episodeIds.indexOf(targetEpisodeId);
}

/** Scroll offset that places the target season row's centre in the viewport. */
export function centredSeasonStackOffset(rowTop: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, rowTop + rowHeight / 2 - viewportHeight / 2);
}

function twoDigits(value: number): string {
  if (value >= 0 && value < 10) {
    return '0' + String(value);
  }
  return String(value);
}

export interface EpisodeFocusRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Build a validated rectangle from global Area coordinates already expressed in vp. */
export function episodeFocusRectFromAreaVps(left: number | null, top: number | null,
                                            width: number | null, height: number | null): EpisodeFocusRect | null {
  if (left === null || top === null || width === null || height === null ||
      !Number.isFinite(left) || !Number.isFinite(top) ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !Number.isFinite(left + width) || !Number.isFinite(top + height)) {
    return null;
  }
  return { left: left, top: top, width: width, height: height };
}

/** A current paired ListItem Area/scroll sample proves that the target card is mounted. */
export function hasPositiveEpisodeAreaSample(rect: EpisodeFocusRect | null,
                                             pageOffset: number | null,
                                             railOffset: number | null): boolean {
  return rect !== null && pageOffset !== null && railOffset !== null &&
    Number.isFinite(rect.left) && Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 0 && rect.height > 0 &&
    Number.isFinite(pageOffset) && Number.isFinite(railOffset);
}

/** Convert ComponentInfo windowOffset/size pixels into a validated vp rectangle. */
export function episodeFocusRectFromWindowPixels(windowX: number, windowY: number, widthPx: number,
                                                heightPx: number, pxToVp: (value: number) => number): EpisodeFocusRect | null {
  if (!Number.isFinite(windowX) || !Number.isFinite(windowY) ||
      !Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return null;
  }
  try {
    const left = pxToVp(windowX);
    const top = pxToVp(windowY);
    const right = pxToVp(windowX + widthPx);
    const bottom = pxToVp(windowY + heightPx);
    const rect: EpisodeFocusRect = { left: left, top: top, width: right - left, height: bottom - top };
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
        !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return rect;
  } catch (_error) {
    return null;
  }
}


/** The episode must intersect both the rail clip and its vertical page viewport. */
export function hasPositiveEpisodeVisibleArea(card: EpisodeFocusRect, rail: EpisodeFocusRect,
                                              page: EpisodeFocusRect): boolean {
  const cardRight = card.left + card.width;
  const cardBottom = card.top + card.height;
  const railRight = rail.left + rail.width;
  const railBottom = rail.top + rail.height;
  const pageRight = page.left + page.width;
  const pageBottom = page.top + page.height;
  const visibleLeft = Math.max(card.left, rail.left, page.left);
  const visibleTop = Math.max(card.top, rail.top, page.top);
  const visibleRight = Math.min(cardRight, railRight, pageRight);
  const visibleBottom = Math.min(cardBottom, railBottom, pageBottom);
  return Number.isFinite(visibleLeft) && Number.isFinite(visibleTop) &&
    Number.isFinite(visibleRight) && Number.isFinite(visibleBottom) &&
    card.width > 0 && card.height > 0 && rail.width > 0 && rail.height > 0 &&
    page.width > 0 && page.height > 0 && visibleRight > visibleLeft && visibleBottom > visibleTop;
}

export function episodeAreaMatchesScrollOffsets(measuredPageOffset: number, currentPageOffset: number,
                                                measuredRailOffset: number, currentRailOffset: number): boolean {
  return Number.isFinite(measuredPageOffset) && Number.isFinite(currentPageOffset) &&
    Number.isFinite(measuredRailOffset) && Number.isFinite(currentRailOffset) &&
    Math.abs(measuredPageOffset - currentPageOffset) <= 0.5 &&
    Math.abs(measuredRailOffset - currentRailOffset) <= 0.5;
}

export interface SeriesEpisodeAreaSample {
  workId: string;
  generation: number;
  railId: string;
  episodeId: string;
  occurrence: number;
  pageOffset: number;
  railOffset: number;
  capturedAtMs: number;
}

/** Match a captured paired Area/offset sample to the resolved target without relabelling it. */
export function seriesEpisodeAreaSampleMatchesTarget(sample: SeriesEpisodeAreaSample,
  workId: string, generation: number, railId: string, episodeId: string, occurrence: number,
  currentPageOffset: number, currentRailOffset: number): boolean {
  return sample.workId === workId && sample.generation === generation && sample.railId === railId &&
    sample.episodeId === episodeId && sample.occurrence === occurrence &&
    Number.isInteger(sample.generation) && Number.isInteger(sample.occurrence) && sample.occurrence >= 0 &&
    Number.isInteger(sample.capturedAtMs) && sample.capturedAtMs > 0 &&
    episodeAreaMatchesScrollOffsets(sample.pageOffset, currentPageOffset, sample.railOffset, currentRailOffset);
}

/** Issues a void FocusController request, returning false only when it throws. */
export function issueEpisodeFocusRequest(request: () => void): boolean {
  try {
    request();
    return true;
  } catch (_error) {
    return false;
  }
}

export type EpisodeFocusDecision = 'request' | 'already-focused' | 'none';

/** A single route-entry focus claim that can be cancelled by user movement. */
export class EpisodeFocusGate {
  private state: 'pending' | 'requested' | 'cancelled' | 'claimed' = 'pending';
  private focusObserved: boolean = false;
  private focusedEpisodeId: string | null = null;

  cancel(): void {
    if (this.state === 'pending' || this.state === 'requested') {
      this.state = 'cancelled';
    }
  }

  isPending(): boolean {
    return this.state === 'pending';
  }

  beginRequest(): boolean {
    if (this.state !== 'pending') {
      return false;
    }
    if (this.focusObserved) {
      this.state = 'claimed';
      return false;
    }
    this.state = 'requested';
    return true;
  }

  rollbackRequest(): void {
    if (this.state === 'requested' && !this.focusObserved) {
      this.state = 'pending';
    }
  }

  recordCurrentFocus(focusedEpisodeId: string, targetEpisodeId: string | null): void {
    if (this.state !== 'pending' && this.state !== 'requested') {
      return;
    }
    this.focusObserved = isSeriesEpisodeTargetFocused(focusedEpisodeId, targetEpisodeId);
    this.focusedEpisodeId = this.focusObserved ? focusedEpisodeId : null;
    if (this.state === 'requested' && this.focusObserved) {
      this.state = 'claimed';
    }
  }

  claim(episodeId: string | null, cardMounted: boolean, cardHasVisibleArea: boolean): EpisodeFocusDecision {
    if (this.state !== 'pending' || episodeId === null || episodeId.length === 0) {
      return 'none';
    }
    if (this.focusObserved) {
      this.state = this.focusedEpisodeId === episodeId ? 'claimed' : 'cancelled';
      return this.state === 'claimed' ? 'already-focused' : 'none';
    }
    if (!cardMounted || !cardHasVisibleArea) {
      return 'none';
    }
    return 'request';
  }
}
