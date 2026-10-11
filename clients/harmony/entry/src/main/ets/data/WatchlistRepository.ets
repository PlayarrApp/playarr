/** The watchlist toggle's calls (web `WatchlistToggle`): add a snapshot, or resolve it and remove by key. */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { discoverResolveUrl, watchlistItemUrl, watchlistUrl } from '../core/Endpoints.ts';
import { TitleSnapshot } from '../core/Types/Calendar.ts';
import { WatchlistResponse } from '../core/Types/Watchlist.ts';

export interface TitleRef {
  title_key: string;
}

export interface ResolvedTitleKey {
  title: TitleRef;
}

export function addToWatchlist(snapshot: TitleSnapshot): Promise<ApiResult<ResolvedTitleKey>> {
  return getPlayarrClient().postJson<TitleSnapshot, ResolvedTitleKey>(watchlistUrl(), snapshot);
}

export function resolveTitle(snapshot: TitleSnapshot): Promise<ApiResult<ResolvedTitleKey>> {
  return getPlayarrClient().postJson<TitleSnapshot, ResolvedTitleKey>(discoverResolveUrl(), snapshot);
}

export function removeFromWatchlist(titleKey: string): Promise<ApiResult<Object>> {
  return getPlayarrClient().deleteJson<Object>(watchlistItemUrl(titleKey));
}

/** `GET /api/v1/watchlist`: the viewer's watchlist (web `loadWatchlist`). */
export function listWatchlist(): Promise<ApiResult<WatchlistResponse>> {
  return getPlayarrClient().getJson<WatchlistResponse>(watchlistUrl());
}
