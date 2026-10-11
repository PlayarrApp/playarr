// core/DownloadTargets.ts: the files "Download" fetches for a title, as web MediaContextMenu's download scope:
// a movie's own file, every episode of a series, every track of an artist, each with a row title.
import type { WorkDetail, WorkChildrenArtist, WorkChildrenSeries } from "./Types/WorkDetail";

export interface DownloadTarget {
  mediaFileId: string;
  title: string;
}

export function downloadTargets(detail: WorkDetail): DownloadTarget[] {
  const targets: DownloadTarget[] = [];
  const base = detail.work.title;
  if (detail.media_file_id !== null && detail.media_file_id !== undefined && detail.media_file_id !== "") {
    targets.push({ mediaFileId: detail.media_file_id, title: base });
    return targets;
  }
  const series = (detail.children as WorkChildrenSeries).Series;
  if (series !== undefined) {
    const seasons = series.slice().sort((a, b) => a.season.season_number - b.season.season_number);
    for (const season of seasons) {
      const episodes = season.episodes.slice().sort((a, b) => a.episode.episode_number - b.episode.episode_number);
      for (const episode of episodes) {
        if (episode.media_file_id) {
          targets.push({
            mediaFileId: episode.media_file_id,
            title: base + " · S" + String(season.season.season_number) + "E" + String(episode.episode.episode_number),
          });
        }
      }
    }
    return targets;
  }
  const artist = (detail.children as WorkChildrenArtist).Artist;
  if (artist !== undefined) {
    for (const album of artist) {
      for (const track of album.tracks) {
        if (track.media_file_id) {
          targets.push({ mediaFileId: track.media_file_id, title: base + " · " + track.track.title });
        }
      }
    }
  }
  return targets;
}
