// core/DownloadEngine.ts: the offline download engine's logic, as web lib/downloadEngine.ts and lib/downloadsDb.ts.
// Pure and unit-tested: the ArkTS runner (`download/DownloadEngine.ets`) only does the I/O (HTTP, files, timers).
//
// A download is one server ticket plus one local file:
//   1. POST /api/v1/downloads {media_file_id, quality_id}: "original" is ready at once, a named quality is queued.
//   2. Poll GET /api/v1/downloads/{id} until the ticket is ready (or failed, expired or canceled).
//   3. GET /api/v1/downloads/{id}/file in `Range` chunks into the sandbox, resuming from the bytes already saved.
//   4. Keep it until its keep-until policy lapses, then delete the file and the record.

import type { DownloadRecord, KeepUntil } from "./Downloads";
import { formatBytes } from "./Downloads";

export interface DownloadTicket {
  id: string;
  media_file_id: string;
  quality_id: string;
  status: string;
  container: string;
  size_bytes: number | null;
  requested_at: string;
  ready_at: string | null;
  expires_at: string | null;
  error_message: string | null;
}

/** Chunk size for the ranged file download: small enough to retry cheaply and keep memory low, large enough to be quick. */
export const CHUNK_BYTES: number = 8 * 1024 * 1024;

/** How often a queued ticket is polled, milliseconds. */
export const TICKET_POLL_MS: number = 3000;

/** Failed chunks retry this many times before the download is marked failed (the engine resumes from the saved bytes later). */
export const CHUNK_MAX_ATTEMPTS: number = 4;

export const DEFAULT_KEEP_UNTIL: KeepUntil = { kind: "forever" };

export type EngineStep = "createTicket" | "pollTicket" | "fetchChunk" | "done" | "stop";

/**
 * What to do next for a record, given the server's ticket (null before one exists or when it could not be read) and
 * the bytes already saved. `stop` means nothing runs: paused, failed, canceled, expired or ready with every byte saved.
 */
export function nextStep(record: DownloadRecord, ticket: DownloadTicket | null): EngineStep {
  if (record.status === "paused" || record.status === "failed" || record.status === "canceled" || record.status === "expired") {
    return "stop";
  }
  if (record.ticketId === undefined || record.ticketId === "") {
    return "createTicket";
  }
  if (ticket === null) {
    return "pollTicket";
  }
  if (ticket.status === "failed" || ticket.status === "canceled" || ticket.status === "expired") {
    return "stop";
  }
  if (ticket.status !== "ready") {
    return "pollTicket";
  }
  const size = ticket.size_bytes !== null ? ticket.size_bytes : (record.sizeBytes !== undefined && record.sizeBytes !== null ? record.sizeBytes : 0);
  const saved = record.downloadedBytes !== undefined && record.downloadedBytes !== null ? record.downloadedBytes : 0;
  if (size > 0 && saved >= size) {
    return "done";
  }
  return "fetchChunk";
}

/** The local status a record takes from its server ticket, keeping `downloading` once bytes are being fetched. */
export function statusFromTicket(ticketStatus: string, savedBytes: number, sizeBytes: number | null): string {
  if (ticketStatus === "queued") {
    return "queued";
  }
  if (ticketStatus === "processing") {
    return "processing";
  }
  if (ticketStatus === "ready") {
    return sizeBytes !== null && sizeBytes > 0 && savedBytes >= sizeBytes ? "ready" : "downloading";
  }
  if (ticketStatus === "failed" || ticketStatus === "expired" || ticketStatus === "canceled") {
    return ticketStatus;
  }
  return "queued";
}

export interface ChunkRange {
  /** First byte, inclusive. */
  from: number;
  /** Last byte, inclusive. */
  to: number;
}

/** The next `Range` to ask for, or null when every byte is saved (an unknown size asks for one open-ended chunk). */
export function nextChunkRange(savedBytes: number, sizeBytes: number | null, chunkBytes: number = CHUNK_BYTES): ChunkRange | null {
  if (sizeBytes === null || sizeBytes <= 0) {
    return { from: savedBytes, to: savedBytes + chunkBytes - 1 };
  }
  if (savedBytes >= sizeBytes) {
    return null;
  }
  return { from: savedBytes, to: Math.min(savedBytes + chunkBytes, sizeBytes) - 1 };
}

export function rangeHeader(range: ChunkRange): string {
  return "bytes=" + String(range.from) + "-" + String(range.to);
}

/** A chunk reply is usable when the server honoured the range (206) or sent the whole file from byte 0 (200). */
export function chunkReplyOk(status: number, requestedFrom: number): boolean {
  return status === 206 || (status === 200 && requestedFrom === 0);
}

/** Whether a failed chunk is worth retrying: network trouble and server errors are, a refusal or a gone file is not. */
export function chunkRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** A 409 means the file is not ready yet (poll again); 410 means the ticket expired or was canceled. */
export function chunkFailureStatus(status: number): string {
  if (status === 410) {
    return "expired";
  }
  return "failed";
}

/** The record after `bytes` more bytes were saved. */
export function withSavedBytes(record: DownloadRecord, bytes: number): DownloadRecord {
  const saved = (record.downloadedBytes !== undefined && record.downloadedBytes !== null ? record.downloadedBytes : 0) + bytes;
  const next: DownloadRecord = { ...record, downloadedBytes: saved };
  next.status = statusFromTicket("ready", saved, record.sizeBytes !== undefined ? record.sizeBytes : null);
  return next;
}

// ---- keep-until ----------------------------------------------------------------------------------------------------

export function normaliseKeepUntil(raw: KeepUntil | undefined): KeepUntil {
  if (raw === undefined) {
    return DEFAULT_KEEP_UNTIL;
  }
  if (raw.kind === "date" && raw.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    return { kind: "date", date: raw.date };
  }
  if (raw.kind === "afterWatched" && raw.amount !== undefined && raw.amount > 0 && (raw.unit === "days" || raw.unit === "weeks")) {
    return { kind: "afterWatched", amount: Math.floor(raw.amount), unit: raw.unit };
  }
  return DEFAULT_KEEP_UNTIL;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a ready download has outlived its policy at `nowMs`: a date ends at the end of that UTC day; "after watched" ends
 * N days or weeks after the last watch (and never expires before the title has been watched); forever never ends.
 */
export function keepUntilLapsed(record: DownloadRecord, nowMs: number): boolean {
  const policy = normaliseKeepUntil(record.keepUntil);
  if (policy.kind === "date" && policy.date !== undefined) {
    return nowMs >= Date.parse(policy.date + "T00:00:00Z") + DAY_MS;
  }
  if (policy.kind === "afterWatched" && policy.amount !== undefined) {
    if (record.watchedAt === undefined || record.watchedAt === null) {
      return false;
    }
    const watched = Date.parse(record.watchedAt);
    if (isNaN(watched)) {
      return false;
    }
    const span = policy.amount * (policy.unit === "weeks" ? 7 : 1) * DAY_MS;
    return nowMs >= watched + span;
  }
  return false;
}

/** The label under a download, as web: "Keep forever", "Keep until 12/10/2026" or "Keep 3 days after watched". */
export function keepUntilLabel(keepUntil: KeepUntil | undefined): string {
  const policy = normaliseKeepUntil(keepUntil);
  if (policy.kind === "date" && policy.date !== undefined) {
    const parts = policy.date.split("-");
    return "Keep until " + parts[2] + "/" + parts[1] + "/" + parts[0];
  }
  if (policy.kind === "afterWatched" && policy.amount !== undefined) {
    return "Keep " + String(policy.amount) + " " + (policy.unit === "weeks" ? "weeks" : "days") + " after watched";
  }
  return "Keep forever";
}

/** The ids of ready downloads whose policy lapsed: the engine deletes their files and records. */
export function lapsedDownloadIds(records: DownloadRecord[], nowMs: number): string[] {
  const ids: string[] = [];
  for (const record of records) {
    if (record.status === "ready" && keepUntilLapsed(record, nowMs)) {
      ids.push(record.id);
    }
  }
  return ids;
}

// ---- the saved index -----------------------------------------------------------------------------------------------

/** The records as the JSON text the store keeps. */
export function serializeIndex(records: DownloadRecord[]): string {
  return JSON.stringify(records);
}

/** The records back from the saved text; anything unreadable is dropped, and a download that was mid-flight resumes as queued. */
export function parseIndex(text: string): DownloadRecord[] {
  let raw: DownloadRecord[];
  try {
    raw = JSON.parse(text) as DownloadRecord[];
  } catch (err) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const records: DownloadRecord[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && typeof item.id === "string" && typeof item.title === "string" && typeof item.status === "string") {
      const record: DownloadRecord = { ...item };
      if (record.status === "downloading" || record.status === "processing") {
        record.status = "queued";
      }
      records.push(record);
    }
  }
  return records;
}

/** The sandbox file name for a download: the ticket id with the container as its extension (the server picks the container). */
export function downloadFileName(ticketId: string, container: string): string {
  const safeId = ticketId.replace(/[^A-Za-z0-9-]/g, "");
  const safeExt = container.replace(/[^A-Za-z0-9]/g, "");
  return safeExt.length > 0 ? safeId + "." + safeExt : safeId;
}

// ---- the quality choice --------------------------------------------------------------------------------------------

/** One entry of `GET /api/v1/media/{id}/download-options`: Original or a transcode profile. */
export interface DownloadOption {
  id: string;
  label: string;
  /** null only for an unknown Original size. */
  estimated_size_bytes: number | null;
  /** True for a transcode profile (its size is estimated from bitrate and duration); false for Original (a real count). */
  size_is_estimate: boolean;
}

export interface DownloadOptionsResponse {
  media_file_id: string;
  container: string;
  options: DownloadOption[];
}

/** The choice's label as web shows it: the name and its size, "~" marking an estimate, "per item" for a container of many files. */
export function downloadOptionLabel(option: DownloadOption, fileCount: number): string {
  if (option.estimated_size_bytes === null || option.estimated_size_bytes <= 0) {
    return option.label;
  }
  const size = (option.size_is_estimate ? "~" : "") + formatBytes(option.estimated_size_bytes);
  return option.label + " · " + size + (fileCount > 1 ? " per item" : "");
}

/** The chosen quality if the server still offers it, else Original (always first). */
export function validQuality(options: DownloadOption[], wanted: string): string {
  for (const option of options) {
    if (option.id === wanted) {
      return wanted;
    }
  }
  return "original";
}

// ---- keep-until presets (the Downloads page's Edit and the title actions' Download choice share these) ----------------

export interface KeepPreset {
  value: string;
  label: string;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** forever, 7 or 30 days after watched, or until a date 30 days from now. */
export function keepPresets(nowMs: number): KeepPreset[] {
  return [
    { value: "forever", label: "Keep forever" },
    { value: "watched7", label: "Keep 7 days after watched" },
    { value: "watched30", label: "Keep 30 days after watched" },
    { value: "date30", label: "Keep until " + isoDay(nowMs + 30 * DAY_MS) },
  ];
}

export function keepUntilFromPreset(value: string, nowMs: number): KeepUntil {
  if (value === "watched7") {
    return { kind: "afterWatched", amount: 7, unit: "days" };
  }
  if (value === "watched30") {
    return { kind: "afterWatched", amount: 30, unit: "days" };
  }
  if (value === "date30") {
    return { kind: "date", date: isoDay(nowMs + 30 * DAY_MS) };
  }
  return DEFAULT_KEEP_UNTIL;
}
