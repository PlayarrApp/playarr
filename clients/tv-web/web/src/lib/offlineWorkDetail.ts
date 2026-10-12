import { useMemo } from "react";
import type { AsyncState } from "@playarr-tv/api-client/react";
import type { WorkDetail } from "@playarr-tv/api-client";
import { useDownloads } from "./DownloadsProvider";
import { useOnlineStatus } from "./useOnlineStatus";
import type { DownloadRecord } from "./downloadsDb";

/**
 * The detail page's data built from the completed local downloads of one work, for when the device is offline and the
 * server cannot answer. Only what a record stores is known (title, season and episode numbers, runtime, the media
 * file), so artwork, synopsis and credits are empty. `null` when no playable local copy exists for the work.
 */
export function offlineWorkDetail(records: readonly DownloadRecord[], workId: string): WorkDetail | null {
  const ready = records.filter((r) => r.workId === workId && r.status === "ready");
  const first = ready[0];
  if (!first) return null;
  const kind = first.workKind ?? "movie";
  const added = first.requestedAt;
  const work: WorkDetail["work"] = {
    id: workId,
    kind,
    title: first.seriesTitle ?? first.title,
    sort_title: first.seriesTitle ?? first.title,
    overview: null,
    genres: [],
    tags: [],
    images: [],
    external_refs: [],
    monitored: false,
    availability: "available",
    added_at: added,
  };
  if (kind === "series") {
    const bySeason = new Map<number, DownloadRecord[]>();
    for (const r of ready) bySeason.set(r.seasonNumber ?? 1, [...(bySeason.get(r.seasonNumber ?? 1) ?? []), r]);
    const seasons = [...bySeason.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seasonNumber, rows]) => {
        const seasonId = `${workId}:s${seasonNumber}`;
        return {
          season: { id: seasonId, series_work_id: workId, season_number: seasonNumber, monitored: false, availability: "available" as const },
          episodes: [...rows]
            .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
            .map((r) => ({
              episode: { id: r.mediaFileId, season_id: seasonId, episode_number: r.episodeNumber ?? 0, title: r.title, images: [], monitored: false, availability: "available" as const },
              media_file_id: r.mediaFileId,
              runtime_ms: r.runtimeMs,
            })),
        };
      });
    return { work, children: { Series: seasons }, available_on: [] };
  }
  if (kind === "artist") {
    // A track record carries "Artist · Album" as its subtitle; tracks are numbered in the order they were requested.
    const byAlbum = new Map<string, DownloadRecord[]>();
    for (const r of ready) {
      const album = r.subtitle?.split(" · ").slice(1).join(" · ") || r.title;
      byAlbum.set(album, [...(byAlbum.get(album) ?? []), r]);
    }
    const Artist = [...byAlbum.entries()].map(([albumTitle, rows]) => {
      const albumId = `${workId}:${albumTitle}`;
      return {
        album: { id: albumId, artist_work_id: workId, title: albumTitle, album_type: "studio" as const, images: [], monitored: false, availability: "available" as const },
        tracks: [...rows]
          .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
          .map((r, i) => ({
            track: { id: r.mediaFileId, album_id: albumId, title: r.title, track_number: i + 1, disc_number: 1, duration_seconds: Math.round(r.runtimeMs / 1000), availability: "available" as const },
            media_file_id: r.mediaFileId,
            runtime_ms: r.runtimeMs,
          })),
      };
    });
    return { work: { ...work, title: first.seriesTitle ?? first.title }, children: { Artist }, available_on: [] };
  }
  return { work, children: "Movie", media_file_id: first.mediaFileId, runtime_ms: first.runtimeMs, available_on: [] };
}

/**
 * The detail page's state with the local-downloads fallback: while the device is offline (or the server failed) and the
 * work has local copies, the page renders from them instead of a skeleton or an error.
 */
export function useOfflineAwareDetail(serverState: AsyncState<WorkDetail>, workId: string | undefined): AsyncState<WorkDetail> {
  const online = useOnlineStatus();
  const { downloads } = useDownloads();
  const offlineDetail = useMemo(
    () => ((online && serverState.status !== "error") || !workId ? null : offlineWorkDetail(downloads, workId)),
    [online, serverState.status, workId, downloads]
  );
  return useMemo(
    (): AsyncState<WorkDetail> => (offlineDetail && serverState.status !== "ready" ? { status: "ready", data: offlineDetail } : serverState),
    [offlineDetail, serverState]
  );
}
