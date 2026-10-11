// core/WatchLeaves.ts: the files a title's "Mark as watched" touches, as web lib/playableLeaves.ts (movie file,
// episodes in season order, album tracks; books are not in web's list).
import type { WorkChildrenArtist, WorkChildrenSeries, WorkDetail } from "./Types/WorkDetail.ts";

export interface WatchLeaf {
  mediaFileId: string;
  runtimeMs: number;
}

export function watchLeaves(detail: WorkDetail): WatchLeaf[] {
  if (detail.media_file_id !== null && detail.media_file_id !== undefined && detail.media_file_id !== "") {
    return [{ mediaFileId: detail.media_file_id, runtimeMs: detail.runtime_ms ?? 0 }];
  }
  const children = detail.children;
  const leaves: WatchLeaf[] = [];
  if (typeof children !== "object" || children === null) {
    return leaves;
  }
  const series = (children as WorkChildrenSeries).Series;
  const artist = (children as WorkChildrenArtist).Artist;
  if (series !== undefined) {
    const seasons = series.slice().sort((a, b) => a.season.season_number - b.season.season_number);
    for (const season of seasons) {
      const episodes = season.episodes.slice().sort((a, b) => a.episode.episode_number - b.episode.episode_number);
      for (const episode of episodes) {
        if (episode.media_file_id) {
          leaves.push({ mediaFileId: episode.media_file_id, runtimeMs: episode.runtime_ms ?? 0 });
        }
      }
    }
  } else if (artist !== undefined) {
    for (const album of artist) {
      for (const track of album.tracks) {
        if (track.media_file_id) {
          leaves.push({ mediaFileId: track.media_file_id,
            runtimeMs: track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1000 });
        }
      }
    }
  }
  return leaves;
}
