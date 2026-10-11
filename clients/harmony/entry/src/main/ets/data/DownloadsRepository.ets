/**
 * The device's downloads: reads and changes them through the download engine (`download/DownloadEngine.ets`), so the
 * Downloads page and the title actions never touch the engine directly.
 */

import { DownloadRecord, KeepUntil } from '../core/Downloads.ts';
import { downloadEngine } from '../download/DownloadEngine';
import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { downloadOptionsUrl } from '../core/Endpoints.ts';
import { DownloadOptionsResponse } from '../core/DownloadEngine.ts';

export async function listDownloads(): Promise<DownloadRecord[]> {
  return downloadEngine.list();
}

/** Calls `listener` after every change to the downloads (progress included); returns what to pass to `unsubscribeDownloads`. */
export function subscribeDownloads(listener: () => void): void {
  downloadEngine.subscribe(listener);
}

export function unsubscribeDownloads(listener: () => void): void {
  downloadEngine.unsubscribe(listener);
}

export function cancelDownload(id: string): void {
  downloadEngine.cancel(id);
}

export function retryDownload(id: string): void {
  downloadEngine.retry(id);
}

export function removeDownload(id: string): void {
  downloadEngine.remove(id);
}

export function setDownloadKeepUntil(id: string, keepUntil: KeepUntil): void {
  downloadEngine.setKeepUntil(id, keepUntil);
}

/** Queues a download of one media file at a quality (`original` or a transcode profile). */
export function enqueueDownload(mediaFileId: string, workId: string, title: string, workKind: string, qualityId: string, keepUntil: KeepUntil): void {
  downloadEngine.enqueue(mediaFileId, workId, title, workKind, qualityId, keepUntil);
}

/** `GET /api/v1/media/{id}/download-options`: Original and the transcode profiles this file can be downloaded at. */
export function getDownloadOptions(mediaFileId: string): Promise<ApiResult<DownloadOptionsResponse>> {
  return getPlayarrClient().getJson<DownloadOptionsResponse>(downloadOptionsUrl(mediaFileId));
}
