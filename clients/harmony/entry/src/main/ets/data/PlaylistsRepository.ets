/** `GET /api/v1/playlists` and its items (web `listPlaylists`, `listPlaylistItems`). Read-only here. */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { playlistsUrl, playlistItemsUrl } from '../core/Endpoints.ts';
import { PlaylistResponse, PlaylistItemResponse } from '../core/Types/Playlists.ts';

export function listPlaylists(): Promise<ApiResult<PlaylistResponse[]>> {
  return getPlayarrClient().getJson<PlaylistResponse[]>(playlistsUrl());
}

export function listPlaylistItems(id: string): Promise<ApiResult<PlaylistItemResponse[]>> {
  return getPlayarrClient().getJson<PlaylistItemResponse[]>(playlistItemsUrl(id));
}
