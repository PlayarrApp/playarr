// core/Types/Playlists.ts: the parts of `GET /api/v1/playlists` and `GET /api/v1/playlists/{id}/items` the playlists page reads.

export interface PlaylistResponse {
  id: string;
  name: string;
  is_system: boolean;
  media_type: string;
  parent_playlist_id?: string | null;
}

export interface PlaylistItemResponse {
  id: string;
  work_id: string;
  position: number;
  track_id?: string | null;
}
