/** `/api/v1/playlists` and its items (web `listPlaylists`, `listPlaylistItems`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `reorderPlaylistItems`, `removePlaylistItem`). */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { playlistsUrl, playlistItemsUrl, playlistUrl, playlistItemOrderUrl, playlistItemUrl } from '../core/Endpoints.ts';
import { PlaylistResponse, PlaylistItemResponse } from '../core/Types/Playlists.ts';

export function listPlaylists(): Promise<ApiResult<PlaylistResponse[]>> {
  return getPlayarrClient().getJson<PlaylistResponse[]>(playlistsUrl());
}

export function listPlaylistItems(id: string): Promise<ApiResult<PlaylistItemResponse[]>> {
  return getPlayarrClient().getJson<PlaylistItemResponse[]>(playlistItemsUrl(id));
}

interface CreatePlaylistBody {
  name: string;
  media_type: string;
  parent_playlist_id?: string | null;
}

interface UpdatePlaylistBody {
  name: string;
  parent_playlist_id?: string | null;
}

interface ReorderBody {
  item_ids: string[];
}

export function createPlaylist(name: string, mediaType: string, parentId: string | null): Promise<ApiResult<PlaylistResponse>> {
  const body: CreatePlaylistBody = { name: name, media_type: mediaType, parent_playlist_id: parentId };
  return getPlayarrClient().postJson<CreatePlaylistBody, PlaylistResponse>(playlistsUrl(), body);
}

/** Renames a playlist, keeping its place in the tree (`parentId` as it is). */
export function renamePlaylist(id: string, name: string, parentId: string | null): Promise<ApiResult<PlaylistResponse>> {
  const body: UpdatePlaylistBody = { name: name, parent_playlist_id: parentId };
  return getPlayarrClient().patchJson<UpdatePlaylistBody, PlaylistResponse>(playlistUrl(id), body);
}

export function deletePlaylist(id: string): Promise<ApiResult<Object>> {
  return getPlayarrClient().deleteJson<Object>(playlistUrl(id));
}

/** Every item id of the playlist, in the new order. */
export function reorderPlaylistItems(id: string, itemIds: string[]): Promise<ApiResult<Object>> {
  const body: ReorderBody = { item_ids: itemIds };
  return getPlayarrClient().putJson<ReorderBody, Object>(playlistItemOrderUrl(id), body);
}

export function removePlaylistItem(id: string, itemId: string): Promise<ApiResult<Object>> {
  return getPlayarrClient().deleteJson<Object>(playlistItemUrl(id, itemId));
}
