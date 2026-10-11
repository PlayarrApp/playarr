import type { DownloadRecord } from "./downloadsDb";

/** What a status means for a download's controls. */
export function isRunning(record: Pick<DownloadRecord, "status">): boolean {
  return record.status === "queued" || record.status === "processing" || record.status === "downloading";
}

export function isFailed(record: Pick<DownloadRecord, "status">): boolean {
  return record.status === "failed" || record.status === "canceled" || record.status === "expired";
}

/** Size and progress over a set of downloads. `totalBytes` is null while any total is still unknown. */
export interface DownloadAggregate {
  count: number;
  running: number;
  paused: number;
  ready: number;
  failed: number;
  bytesDownloaded: number;
  totalBytes: number | null;
  /** 0 to 100, or null while a total is unknown and nothing is finished. */
  percent: number | null;
}

export function aggregateDownloads(records: readonly DownloadRecord[]): DownloadAggregate {
  let bytesDownloaded = 0;
  let totalBytes: number | null = 0;
  let running = 0;
  let paused = 0;
  let ready = 0;
  let failed = 0;
  for (const record of records) {
    // A finished download counts as fully fetched whatever its byte counter says.
    const size = record.totalBytes ?? (record.status === "ready" ? record.bytesDownloaded : null);
    bytesDownloaded += record.status === "ready" && size !== null ? size : record.bytesDownloaded;
    totalBytes = totalBytes === null || size === null ? null : totalBytes + size;
    if (isRunning(record)) running += 1;
    else if (record.status === "paused") paused += 1;
    else if (record.status === "ready") ready += 1;
    else if (isFailed(record)) failed += 1;
  }
  const percent =
    totalBytes !== null && totalBytes > 0
      ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100))
      : records.length > 0 && ready === records.length
        ? 100
        : null;
  return { count: records.length, running, paused, ready, failed, bytesDownloaded, totalBytes, percent };
}

export interface EpisodeIdentity {
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
}

/** Series, season and episode of an episode download; older records carry them only in the subtitle ("Series · S01 · E02"). */
export function episodeIdentity(record: DownloadRecord): EpisodeIdentity | null {
  if (record.workKind !== "series") return null;
  if (record.seriesTitle && record.seasonNumber !== undefined && record.episodeNumber !== undefined) {
    return { seriesTitle: record.seriesTitle, seasonNumber: record.seasonNumber, episodeNumber: record.episodeNumber };
  }
  const match = record.subtitle?.match(/^(.*?)\s*·\s*S(\d+)\s*·\s*E(\d+)\s*$/);
  if (match) {
    return { seriesTitle: match[1] || record.title, seasonNumber: Number(match[2]), episodeNumber: Number(match[3]) };
  }
  return null;
}

export interface EpisodeNode {
  record: DownloadRecord;
  episodeNumber: number;
}

export interface SeasonNode {
  key: string;
  seasonNumber: number;
  episodes: EpisodeNode[];
  records: DownloadRecord[];
  aggregate: DownloadAggregate;
}

export interface SeriesNode {
  key: string;
  workId: string;
  title: string;
  seasons: SeasonNode[];
  records: DownloadRecord[];
  aggregate: DownloadAggregate;
}

export type DownloadListItem =
  | { type: "record"; record: DownloadRecord }
  | { type: "series"; series: SeriesNode };

/**
 * Groups TV downloads as series, then season, then episode (sorted by number); every other kind stays a flat record.
 * Groups are placed where their first member appeared, so the caller's ordering of records still shows through.
 */
export function buildDownloadTree(records: readonly DownloadRecord[]): DownloadListItem[] {
  const items: DownloadListItem[] = [];
  const seriesByWork = new Map<string, { node: SeriesNode; seasons: Map<number, SeasonNode> }>();
  for (const record of records) {
    const identity = episodeIdentity(record);
    if (!identity) {
      items.push({ type: "record", record });
      continue;
    }
    let entry = seriesByWork.get(record.workId);
    if (!entry) {
      const node: SeriesNode = {
        key: `series:${record.workId}`,
        workId: record.workId,
        title: identity.seriesTitle,
        seasons: [],
        records: [],
        aggregate: aggregateDownloads([]),
      };
      entry = { node, seasons: new Map() };
      seriesByWork.set(record.workId, entry);
      items.push({ type: "series", series: node });
    }
    let season = entry.seasons.get(identity.seasonNumber);
    if (!season) {
      season = {
        key: `season:${record.workId}:${identity.seasonNumber}`,
        seasonNumber: identity.seasonNumber,
        episodes: [],
        records: [],
        aggregate: aggregateDownloads([]),
      };
      entry.seasons.set(identity.seasonNumber, season);
      entry.node.seasons.push(season);
    }
    season.episodes.push({ record, episodeNumber: identity.episodeNumber });
    season.records.push(record);
    entry.node.records.push(record);
  }
  for (const { node } of seriesByWork.values()) {
    node.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    for (const season of node.seasons) {
      season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      season.aggregate = aggregateDownloads(season.records);
    }
    node.aggregate = aggregateDownloads(node.records);
  }
  return items;
}

export type DownloadKindFilter = "all" | "movies" | "tv" | "music";
export type DownloadStatusFilter = "all" | "downloading" | "paused" | "done" | "failed";
export type DownloadSort = "recent" | "title" | "size";

export interface DownloadFilters {
  kind: DownloadKindFilter;
  status: DownloadStatusFilter;
  sort: DownloadSort;
}

export const DEFAULT_DOWNLOAD_FILTERS: DownloadFilters = { kind: "all", status: "all", sort: "recent" };

export function activeFilterCount(filters: DownloadFilters): number {
  return (filters.kind !== "all" ? 1 : 0) + (filters.status !== "all" ? 1 : 0) + (filters.sort !== "recent" ? 1 : 0);
}

function matchesKind(record: DownloadRecord, kind: DownloadKindFilter): boolean {
  switch (kind) {
    case "all":
      return true;
    case "movies":
      return record.workKind === "movie" || record.workKind === "site";
    case "tv":
      return record.workKind === "series";
    case "music":
      return record.workKind === "artist";
  }
}

function matchesStatus(record: DownloadRecord, status: DownloadStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "downloading":
      return isRunning(record);
    case "paused":
      return record.status === "paused";
    case "done":
      return record.status === "ready";
    case "failed":
      return isFailed(record);
  }
}

/** Applies kind and status, then sorts. `recent` keeps the newest request first; `title` is A to Z; `size` is largest first. */
export function filterAndSortDownloads(records: readonly DownloadRecord[], filters: DownloadFilters): DownloadRecord[] {
  const kept = records.filter((record) => matchesKind(record, filters.kind) && matchesStatus(record, filters.status));
  const size = (record: DownloadRecord) => record.totalBytes ?? record.bytesDownloaded;
  const titleOf = (record: DownloadRecord) => (episodeIdentity(record)?.seriesTitle ?? record.title).toLowerCase();
  switch (filters.sort) {
    case "recent":
      return [...kept].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    case "title":
      return [...kept].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    case "size":
      return [...kept].sort((a, b) => size(b) - size(a));
  }
}
