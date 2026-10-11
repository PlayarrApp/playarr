/**
 * The device's downloads. shortcut: HarmonyOS has no download engine here yet (no ticket requests, no local file
 * store, no keep-until policy), so there is never a record to show; this is the one place the page reads from, so the
 * engine plugs in here without touching the page. Build it on the platform request agent when downloads are scheduled.
 */

import { DownloadRecord } from '../core/Downloads.ts';

export async function listDownloads(): Promise<DownloadRecord[]> {
  const none: DownloadRecord[] = [];
  return none;
}
