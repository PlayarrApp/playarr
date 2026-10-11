// core/Playlists.ts: ordering and labels for the playlists page, as web pages/Playlists.tsx.
import type { PlaylistResponse, PlaylistItemResponse } from "./Types/Playlists";
import type { WorkDetail, WorkChildrenArtist } from "./Types/WorkDetail";
import { watchLeaves } from "./WatchLeaves";

/** Web sorts by name, numbers in natural order, ignoring case (`localeCompare` with `numeric` and base sensitivity). */
function naturalKey(name: string): string[] {
  const parts: string[] = [];
  let digits = "";
  let text = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name.charAt(i);
    if (ch >= "0" && ch <= "9") {
      if (text.length > 0) {
        parts.push(text.toLowerCase());
        text = "";
      }
      digits += ch;
    } else {
      if (digits.length > 0) {
        parts.push(digits.padStart(12, "0"));
        digits = "";
      }
      text += ch;
    }
  }
  if (text.length > 0) {
    parts.push(text.toLowerCase());
  }
  if (digits.length > 0) {
    parts.push(digits.padStart(12, "0"));
  }
  return parts;
}

function compareNames(a: string, b: string): number {
  const left = naturalKey(a).join("\u0001");
  const right = naturalKey(b).join("\u0001");
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Top-level playlists only (nested ones show inside their parent), by name in natural order. */
export function topLevelPlaylists(playlists: PlaylistResponse[]): PlaylistResponse[] {
  return playlists
    .filter((playlist) => playlist.parent_playlist_id === undefined || playlist.parent_playlist_id === null)
    .sort((a, b) => compareNames(a.name, b.name));
}

/** The playlists nested directly under `parentId`, by name. */
export function childPlaylists(playlists: PlaylistResponse[], parentId: string): PlaylistResponse[] {
  return playlists.filter((playlist) => playlist.parent_playlist_id === parentId).sort((a, b) => compareNames(a.name, b.name));
}

/** The caption under a playlist's name: its media class, and whether it is a System playlist. */
export function playlistCaption(playlist: PlaylistResponse): string {
  const media = playlist.media_type === "audio" ? "Music" : "Video";
  return playlist.is_system ? media + " · System playlist" : media + " · Playlist";
}

/** Items in playlist order. */
export function itemsInOrder(items: PlaylistItemResponse[]): PlaylistItemResponse[] {
  return items.slice().sort((a, b) => a.position - b.position);
}

/** The ids in `ids` with the one at `index` moved by `delta` places (up is negative); unchanged when it would leave the list. */
export function moveId(ids: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) {
    return ids.slice();
  }
  const next = ids.slice();
  const moved = next.splice(index, 1)[0];
  next.splice(target, 0, moved);
  return next;
}

/**
 * The file a playlist item plays: an audio item's own track, else the work's own file (a movie), else its first playable
 * file (an episode or track), as web resolves a playlist item. Null when nothing is playable yet.
 */
export function itemMediaFileId(detail: WorkDetail, trackId: string | null | undefined): string | null {
  if (trackId !== undefined && trackId !== null) {
    const albums = (detail.children as WorkChildrenArtist).Artist;
    if (albums !== undefined) {
      for (const album of albums) {
        for (const track of album.tracks) {
          if (track.track.id === trackId && track.media_file_id) {
            return track.media_file_id;
          }
        }
      }
    }
  }
  const leaves = watchLeaves(detail);
  return leaves.length > 0 ? leaves[0].mediaFileId : null;
}

/** Video playlists take movies, series and sites; audio playlists take music (web's playlist target by kind). */
export function playlistMediaTypeForKind(workKind: string): string {
  return workKind === "artist" ? "audio" : "video";
}

/** The playlists a title can be added to: the right media class, System ones only listed when `canEditSystem` (administrators). */
export function playlistsForKind(playlists: PlaylistResponse[], workKind: string, canEditSystem: boolean): PlaylistResponse[] {
  const mediaType = playlistMediaTypeForKind(workKind);
  return playlists
    .filter((playlist) => playlist.media_type === mediaType && (canEditSystem || !playlist.is_system))
    .sort((a, b) => compareNames(a.name, b.name));
}
