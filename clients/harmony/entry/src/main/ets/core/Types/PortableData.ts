/** Portable user data wire types (`backend/openapi/playarr.yaml`; web `packages/api-client` UserData*). */

export interface UserDataExportJob {
  id: string;
  /** "queued", "running", "ready", "failed" or "expired". */
  status: string;
  expires_at: string | null;
  progress: { stage: string; done: number; total: number };
  counts: { watch_progress: number; playlists: number };
  size_bytes: number | null;
}

/** A one-time, 15-minute link for another device (shown as a QR code). `url` is absolute when present. */
export interface UserDataTransferLink {
  path: string;
  url?: string | null;
  expires_at: string;
}

export interface UserDataImportSession {
  id: string;
  /** "waiting", "uploading" or "uploaded". */
  status: string;
  upload_path: string | null;
  upload_url?: string | null;
  expires_at: string;
  size_bytes: number | null;
}

export interface UserDataImportPreview {
  package_sha256: string;
  warnings: string[];
  summary: {
    watch_progress: { will_add: number; will_update: number; already_present: number; conflicts_kept: number; ambiguous: number };
    playlists: { new: number; items_to_add: number; items_already_present: number };
    watchlist?: { will_add: number; already_present: number; unmatched: number } | null;
    preferred_audio_language_change: string | null;
    playback_preferences_not_applied: number;
    unmatched_total: number;
  };
}

export interface UserDataImportResult {
  completed: boolean;
  progress_added: number;
  progress_updated: number;
  playlist_items_added: number;
  failure: string | null;
}
