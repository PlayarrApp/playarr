// core/Playlists.ts: ordering and labels for the playlists page, as web pages/Playlists.tsx.
import type { PlaylistResponse, PlaylistItemResponse } from "./Types/Playlists.ts";

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
