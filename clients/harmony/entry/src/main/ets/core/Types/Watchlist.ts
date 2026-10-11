// core/Types/Watchlist.ts: the parts of `GET /api/v1/watchlist` the watchlist page reads (WatchlistResponse).

export interface WatchlistTitleSource {
  source: string;
  label: string;
  work_id?: string | null;
}

export interface WatchlistTitle {
  title_key: string;
  kind: string;
  title: string;
  year?: number | null;
  sources: WatchlistTitleSource[];
}

export interface WatchlistAction {
  action: string;
  enabled: boolean;
  reason?: string | null;
}

export interface WatchlistEntry {
  title: WatchlistTitle;
  actions: WatchlistAction[];
  added_at: string;
}

export interface WatchlistResponse {
  items: WatchlistEntry[];
}
