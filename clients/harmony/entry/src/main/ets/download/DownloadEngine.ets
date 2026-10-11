/**
 * The offline download engine's runner (logic in `core/DownloadEngine.ts`, which is unit-tested; this file does the
 * I/O): creates the server ticket, polls it until ready, then fetches the file in `Range` chunks into the files
 * directory, resuming from the bytes already saved after a restart, and deletes a download when its keep-until
 * lapses. One record is processed at a time. Listeners are told after every change so the Downloads page can redraw.
 *
 * Not verified on a device (written without one): the HTTP and file calls reuse the shapes the rest of the client
 * already uses (`net/HttpTransport.ets`, `util/Sandbox.ets`), but the first run on hardware must check them.
 */

import { common } from '@kit.AbilityKit';

import { getPlayarrClient, getServerDirectory, getSessionManager } from '../AppContainer';
import { sendHttpRequest, HttpTransportResponse } from '../net/HttpTransport';
import { buildHeaders } from '../core/Headers.ts';
import { downloadsUrl, downloadTicketUrl, downloadFileUrl } from '../core/Endpoints.ts';
import { absoluteUrl } from '../core/Url.ts';
import { clientVersion, resolveClientPlatform } from '../core/AppConfig.ts';
import { DownloadRecord, KeepUntil } from '../core/Downloads.ts';
import {
  DownloadTicket,
  CHUNK_MAX_ATTEMPTS,
  TICKET_POLL_MS,
  DEFAULT_KEEP_UNTIL,
  nextStep,
  statusFromTicket,
  nextChunkRange,
  rangeHeader,
  chunkReplyOk,
  chunkRetryable,
  chunkFailureStatus,
  withSavedBytes,
  lapsedDownloadIds,
  normaliseKeepUntil,
  downloadFileName,
} from '../core/DownloadEngine.ts';
import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';
import { DeviceProfile } from '../core/DeviceProfile.ts';
import { initDownloadStore, loadIndex, saveIndex, downloadPath, appendBytes, fileSize, deleteFile } from './DownloadStore';
import { logWarn } from '../util/Log';

const LOG_TAG: string = 'DownloadEngine';

interface CreateTicketBody {
  media_file_id: string;
  quality_id: string;
}

function platformWireName(): string {
  const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
  return profile !== undefined ? profile.platformWireName : resolveClientPlatform('phone');
}

class Engine {
  private records: DownloadRecord[] = [];
  private listeners: (() => void)[] = [];
  private running: boolean = false;
  private started: boolean = false;

  /** Loads the saved index, drops lapsed downloads and resumes the unfinished ones. Call once the app container is up. */
  public start(context: common.Context): void {
    if (this.started) {
      return;
    }
    this.started = true;
    initDownloadStore(context);
    this.records = loadIndex();
    this.sweep();
    this.kick();
  }

  public list(): DownloadRecord[] {
    return this.records.slice();
  }

  public subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  public unsubscribe(listener: () => void): void {
    this.listeners = this.listeners.filter((item: () => void): boolean => item !== listener);
  }

  /** Queues a download of one media file at a quality (`original` or a transcode profile id). */
  public enqueue(mediaFileId: string, workId: string, title: string, workKind: string, qualityId: string, keepUntil: KeepUntil): void {
    for (const record of this.records) {
      if (record.mediaFileId === mediaFileId && record.qualityId === qualityId && record.status !== 'canceled' && record.status !== 'failed' && record.status !== 'expired') {
        return;
      }
    }
    const record: DownloadRecord = {
      id: 'dl-' + String(Date.now()) + '-' + String(this.records.length),
      title: title,
      status: 'queued',
      mediaFileId: mediaFileId,
      workId: workId,
      workKind: workKind,
      qualityId: qualityId,
      keepUntil: normaliseKeepUntil(keepUntil),
      downloadedBytes: 0,
    };
    this.records.push(record);
    this.changed();
    this.kick();
  }

  /** Stops an unfinished download and tells the server to cancel the ticket. The record stays, marked canceled. */
  public async cancel(id: string): Promise<void> {
    const record = this.find(id);
    if (record === undefined) {
      return;
    }
    record.status = 'canceled';
    this.changed();
    if (record.ticketId !== undefined && record.ticketId.length > 0) {
      await getPlayarrClient().deleteJson<Object>(downloadTicketUrl(record.ticketId));
    }
  }

  /** Starts a failed, canceled or expired download again from nothing (a new ticket). */
  public retry(id: string): void {
    const record = this.find(id);
    if (record === undefined) {
      return;
    }
    this.deleteLocalFile(record);
    record.status = 'queued';
    record.ticketId = '';
    record.downloadedBytes = 0;
    record.errorMessage = null;
    record.filePath = '';
    this.changed();
    this.kick();
  }

  /** Removes a download: its file, its record, and (best effort) the server ticket. */
  public async remove(id: string): Promise<void> {
    const record = this.find(id);
    if (record === undefined) {
      return;
    }
    this.deleteLocalFile(record);
    this.records = this.records.filter((item: DownloadRecord): boolean => item.id !== id);
    this.changed();
    if (record.ticketId !== undefined && record.ticketId.length > 0 && record.status !== 'canceled') {
      await getPlayarrClient().deleteJson<Object>(downloadTicketUrl(record.ticketId));
    }
  }

  public setKeepUntil(id: string, keepUntil: KeepUntil): void {
    const record = this.find(id);
    if (record !== undefined) {
      record.keepUntil = normaliseKeepUntil(keepUntil);
      this.changed();
    }
  }

  /** The title was played: starts the "after watched" clock for its downloads. */
  public markWatched(mediaFileId: string): void {
    const now = new Date().toISOString();
    let any = false;
    for (const record of this.records) {
      if (record.mediaFileId === mediaFileId && record.status === 'ready') {
        record.watchedAt = now;
        any = true;
      }
    }
    if (any) {
      this.changed();
    }
  }

  /** The saved file for a ready download of this media file, or '' when there is none (offline playback reads it). */
  public localFileFor(mediaFileId: string): string {
    for (const record of this.records) {
      if (record.mediaFileId === mediaFileId && record.status === 'ready' && record.filePath !== undefined && record.filePath.length > 0) {
        return record.filePath;
      }
    }
    return '';
  }

  private find(id: string): DownloadRecord | undefined {
    for (const record of this.records) {
      if (record.id === id) {
        return record;
      }
    }
    return undefined;
  }

  private deleteLocalFile(record: DownloadRecord): void {
    if (record.filePath !== undefined && record.filePath.length > 0) {
      deleteFile(record.filePath);
    }
  }

  private changed(): void {
    saveIndex(this.records);
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Deletes the files and records of ready downloads whose keep-until lapsed. */
  private sweep(): void {
    const lapsed = lapsedDownloadIds(this.records, Date.now());
    if (lapsed.length === 0) {
      return;
    }
    for (const id of lapsed) {
      const record = this.find(id);
      if (record !== undefined) {
        this.deleteLocalFile(record);
      }
    }
    this.records = this.records.filter((record: DownloadRecord): boolean => lapsed.indexOf(record.id) < 0);
    this.changed();
  }

  private kick(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop();
  }

  private async loop(): Promise<void> {
    while (true) {
      const next = this.nextUnfinished();
      if (next === undefined) {
        break;
      }
      await this.process(next);
    }
    this.running = false;
  }

  private nextUnfinished(): DownloadRecord | undefined {
    for (const record of this.records) {
      if (record.status === 'queued' || record.status === 'processing' || record.status === 'downloading') {
        return record;
      }
    }
    return undefined;
  }

  /** Runs one record until it is ready, stopped or failed. */
  private async process(record: DownloadRecord): Promise<void> {
    let ticket: DownloadTicket | null = null;
    while (true) {
      const step = nextStep(record, ticket);
      if (step === 'stop' || step === 'done') {
        if (step === 'done') {
          record.status = 'ready';
          record.readyAt = new Date().toISOString();
          this.changed();
        } else if (ticket !== null && (ticket.status === 'failed' || ticket.status === 'expired' || ticket.status === 'canceled')) {
          record.status = statusFromTicket(ticket.status, 0, null);
          record.errorMessage = ticket.error_message;
          this.changed();
        }
        return;
      }
      if (step === 'createTicket') {
        const created = await this.createTicket(record);
        if (!created) {
          return;
        }
        continue;
      }
      if (step === 'pollTicket') {
        ticket = await this.readTicket(record);
        if (ticket === null || ticket.status === 'queued' || ticket.status === 'processing') {
          if (ticket !== null) {
            record.status = statusFromTicket(ticket.status, 0, null);
            this.changed();
          }
          await this.sleep(TICKET_POLL_MS);
        }
        continue;
      }
      // fetchChunk
      if (ticket === null) {
        ticket = await this.readTicket(record);
        continue;
      }
      record.sizeBytes = ticket.size_bytes;
      record.ticketExpiresAt = ticket.expires_at;
      if (record.filePath === undefined || record.filePath.length === 0) {
        record.filePath = downloadPath(downloadFileName(ticket.id, ticket.container));
      }
      // The file is the truth for resuming: bytes saved before a restart count.
      record.downloadedBytes = fileSize(record.filePath);
      const ok = await this.fetchChunk(record, ticket);
      if (!ok) {
        return;
      }
    }
  }

  private async createTicket(record: DownloadRecord): Promise<boolean> {
    const body: CreateTicketBody = { media_file_id: record.mediaFileId !== undefined ? record.mediaFileId : '', quality_id: record.qualityId !== undefined ? record.qualityId : 'original' };
    const result = await getPlayarrClient().postJson<CreateTicketBody, DownloadTicket>(downloadsUrl(), body);
    if (result.kind === 'ok') {
      record.ticketId = result.value.id;
      record.status = statusFromTicket(result.value.status, 0, result.value.size_bytes);
      this.changed();
      return true;
    }
    record.status = 'failed';
    record.errorMessage = result.kind === 'http_failure' && result.status === 403 ? 'Downloads are not allowed for this account.' : 'The download could not be started.';
    this.changed();
    return false;
  }

  private async readTicket(record: DownloadRecord): Promise<DownloadTicket | null> {
    const ticketId = record.ticketId !== undefined ? record.ticketId : '';
    const result = await getPlayarrClient().getJson<DownloadTicket>(downloadTicketUrl(ticketId));
    if (result.kind === 'ok') {
      return result.value;
    }
    if (result.kind === 'http_failure' && result.status === 404) {
      record.status = 'canceled';
      this.changed();
    }
    return null;
  }

  /** Fetches and saves one chunk; false when the record stopped (failed, expired or canceled). */
  private async fetchChunk(record: DownloadRecord, ticket: DownloadTicket): Promise<boolean> {
    const saved = record.downloadedBytes !== undefined && record.downloadedBytes !== null ? record.downloadedBytes : 0;
    const range = nextChunkRange(saved, ticket.size_bytes);
    if (range === null) {
      return true;
    }
    const baseUrl = getServerDirectory().getActiveBaseUrl();
    if (baseUrl === null) {
      record.status = 'failed';
      record.errorMessage = 'No Playarr server is configured.';
      this.changed();
      return false;
    }
    const url = absoluteUrl(baseUrl, downloadFileUrl(ticket.id));
    let attempt = 0;
    while (attempt < CHUNK_MAX_ATTEMPTS) {
      attempt = attempt + 1;
      const headers: Map<string, string> = buildHeaders(platformWireName(), clientVersion, getSessionManager().getAccessToken());
      headers.set('Range', rangeHeader(range));
      const response: HttpTransportResponse = await sendHttpRequest(url, { method: 'GET', headers: headers, dataType: 'array_buffer' });
      if (response.status === 401) {
        await getSessionManager().refreshAccessToken();
        continue;
      }
      if (response.status === 409) {
        // Not ready after all: go back to polling the ticket.
        await this.sleep(TICKET_POLL_MS);
        return true;
      }
      if (chunkReplyOk(response.status, range.from) && response.bodyBytes !== undefined) {
        if (!appendBytes(record.filePath !== undefined ? record.filePath : '', response.bodyBytes)) {
          record.status = 'failed';
          record.errorMessage = 'The file could not be saved on this device.';
          this.changed();
          return false;
        }
        const next = withSavedBytes(record, response.bodyBytes.byteLength);
        record.downloadedBytes = next.downloadedBytes;
        record.status = next.status;
        this.changed();
        return true;
      }
      if (!chunkRetryable(response.status)) {
        record.status = chunkFailureStatus(response.status);
        record.errorMessage = response.status === 410 ? 'The download expired on the server.' : 'The server refused the download.';
        this.changed();
        return false;
      }
      logWarn(LOG_TAG, 'chunk attempt ' + String(attempt) + ' failed with status ' + String(response.status));
      await this.sleep(1000 * attempt);
    }
    // Out of attempts: leave the saved bytes, mark failed so the user can retry (retry resumes by a new ticket).
    record.status = 'failed';
    record.errorMessage = 'The connection kept failing. Try again.';
    this.changed();
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }
}

/** The one engine for the process. */
export const downloadEngine: Engine = new Engine();
