// core/Downloads.ts: the Downloads page's grouping and labels, as web pages/Downloads.tsx and lib/downloadsDb.ts.

export interface DownloadRecord {
  id: string;
  title: string;
  /** queued, processing, downloading, paused, ready, failed, canceled or expired. */
  status: string;
  sizeBytes?: number | null;
  downloadedBytes?: number | null;
  errorMessage?: string | null;
  /** The engine's own fields, absent on a plain page row. */
  mediaFileId?: string;
  workId?: string;
  workKind?: string;
  qualityId?: string;
  /** The server's download ticket for this record. */
  ticketId?: string;
  /** When the server says the ticket (and its file) expires, ISO 8601. */
  ticketExpiresAt?: string | null;
  keepUntil?: KeepUntil;
  /** When the title was last played from this download, ISO 8601, for "keep N days after watched". */
  watchedAt?: string | null;
  /** The saved file in the app sandbox. */
  filePath?: string;
  readyAt?: string | null;
}

/** How long a downloaded file is kept (web `DownloadKeepUntilPolicy`): forever, until a date, or N days or weeks after it was watched. */
export interface KeepUntil {
  kind: string;
  /** For kind `date`: the day, `YYYY-MM-DD`. */
  date?: string;
  /** For kind `afterWatched`: how many. */
  amount?: number;
  /** For kind `afterWatched`: `days` or `weeks`. */
  unit?: string;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  processing: "Preparing",
  downloading: "Downloading",
  paused: "Paused",
  ready: "Downloaded",
  failed: "Failed",
  canceled: "Canceled",
  expired: "Expired",
};

export function downloadStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export interface DownloadSections {
  active: DownloadRecord[];
  needsAttention: DownloadRecord[];
  downloaded: DownloadRecord[];
}

/** Web's three groups, in its order: active (queued, preparing, downloading), needs attention (failed, canceled, expired), downloaded. Paused sits in no group, as on web. */
export function downloadSections(records: DownloadRecord[]): DownloadSections {
  return {
    active: records.filter((r) => r.status === "queued" || r.status === "processing" || r.status === "downloading"),
    needsAttention: records.filter((r) => r.status === "failed" || r.status === "canceled" || r.status === "expired"),
    downloaded: records.filter((r) => r.status === "ready"),
  };
}

/** Bytes as a short size ("1.5 GB"), decimal units as web `formatBytes`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return String(Math.round(bytes)) + " B";
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value = value / 1000;
    unit++;
  }
  const text = value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return text + " " + units[unit];
}

/** The row's meta parts: type-free here, so status then size (downloaded of total while downloading). */
export function downloadMetaParts(record: DownloadRecord): string[] {
  const parts: string[] = [downloadStatusLabel(record.status)];
  const total = record.sizeBytes;
  const done = record.downloadedBytes;
  if (record.status === "downloading" && total !== undefined && total !== null && total > 0 && done !== undefined && done !== null) {
    parts.push(formatBytes(done) + " of " + formatBytes(total));
  } else if (total !== undefined && total !== null && total > 0) {
    parts.push(formatBytes(total));
  }
  return parts;
}
