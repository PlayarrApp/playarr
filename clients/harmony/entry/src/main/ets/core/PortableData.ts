// core/PortableData.ts: the query strings and the human text web's Your data page builds (`YourData.tsx`).
import type { UserDataImportPreview, UserDataImportResult } from "./Types/PortableData.ts";

/** `include_preferences` and `progress_conflicts` as web's `importQuery`, plus the package hash when applying. */
export function importQuery(includePreferences: boolean, keepExisting: boolean, sha256: string): string {
  const parts: string[] = [];
  if (includePreferences) {
    parts.push("include_preferences=true");
  }
  parts.push("progress_conflicts=" + (keepExisting ? "keep_existing" : "newest"));
  if (sha256.length > 0) {
    parts.push("package_sha256=" + encodeURIComponent(sha256));
  }
  return parts.join("&");
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "";
  }
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** The preview lines of web's "What this import would do" list. */
export function previewLines(preview: UserDataImportPreview): string[] {
  const s = preview.summary;
  const lines: string[] = [
    "Progress: " + s.watch_progress.will_add + " new, " + s.watch_progress.will_update + " updated, " + s.watch_progress.already_present +
      " already here, " + s.watch_progress.conflicts_kept + " conflicts kept as they are.",
    "Playlists: " + s.playlists.new + " new, " + s.playlists.items_to_add + " items added, " + s.playlists.items_already_present + " items already present.",
  ];
  if (s.watchlist !== undefined && s.watchlist !== null) {
    lines.push("Watchlist: " + s.watchlist.will_add + " new, " + s.watchlist.already_present + " already here, " + s.watchlist.unmatched + " could not be placed.");
  }
  lines.push(s.unmatched_total + " records could not be placed in this library (" + s.watch_progress.ambiguous + " were ambiguous). You can download them afterwards.");
  if (s.preferred_audio_language_change !== null) {
    lines.push("Audio language would change to " + s.preferred_audio_language_change + ".");
  }
  if (s.playback_preferences_not_applied > 0) {
    lines.push(s.playback_preferences_not_applied + " per-title playback choices are server specific and will not be applied.");
  }
  return lines;
}

export function resultLine(result: UserDataImportResult): string {
  if (result.completed) {
    return "Import finished: " + (result.progress_added + result.progress_updated) + " progress records and " + result.playlist_items_added + " playlist items saved.";
  }
  return "The import stopped part way: " + (result.failure ?? "") + " Running it again is safe.";
}
