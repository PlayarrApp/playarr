/**
 * The download engine's storage: the saved index (`index.json`) and the downloaded files, in the app's durable files
 * directory (`context.filesDir/downloads`). Unlike `util/Sandbox.ets` (scratch, ten minutes), these survive restarts.
 * Never throws across its boundary: a failure is logged and reported as false, 0 or an empty list.
 */

import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';

import { DownloadRecord } from '../core/Downloads.ts';
import { serializeIndex, parseIndex } from '../core/DownloadEngine.ts';
import { logError } from '../util/Log';

const LOG_TAG: string = 'DownloadStore';
const DIRECTORY: string = 'downloads';
const INDEX_FILE: string = 'index.json';

let appContext: common.Context | null = null;

export function initDownloadStore(context: common.Context): void {
  appContext = context;
}

function directory(): string {
  if (appContext === null) {
    throw new Error('DownloadStore: initDownloadStore(context) must be called before use');
  }
  const path = appContext.filesDir + '/' + DIRECTORY;
  if (!fileIo.accessSync(path)) {
    fileIo.mkdirSync(path);
  }
  return path;
}

/** The absolute path of a download file by its file name (`core/DownloadEngine.ts#downloadFileName`). */
export function downloadPath(fileName: string): string {
  return directory() + '/' + fileName;
}

export function loadIndex(): DownloadRecord[] {
  try {
    const path = directory() + '/' + INDEX_FILE;
    if (!fileIo.accessSync(path)) {
      const none: DownloadRecord[] = [];
      return none;
    }
    return parseIndex(fileIo.readTextSync(path));
  } catch (err) {
    logError(LOG_TAG, 'failed to read the download index: ' + (err as Error).message);
    const none: DownloadRecord[] = [];
    return none;
  }
}

/** Writes the whole index (truncating the old one). */
export function saveIndex(records: DownloadRecord[]): boolean {
  let file: fileIo.File | null = null;
  try {
    file = fileIo.openSync(directory() + '/' + INDEX_FILE, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    fileIo.writeSync(file.fd, serializeIndex(records));
    return true;
  } catch (err) {
    logError(LOG_TAG, 'failed to write the download index: ' + (err as Error).message);
    return false;
  } finally {
    if (file !== null) {
      fileIo.closeSync(file.fd);
    }
  }
}

/** Appends bytes to a download file (creating it), the way a ranged download grows it. */
export function appendBytes(path: string, data: ArrayBuffer): boolean {
  let file: fileIo.File | null = null;
  try {
    file = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.APPEND);
    fileIo.writeSync(file.fd, data);
    return true;
  } catch (err) {
    logError(LOG_TAG, 'failed to append to a download file: ' + (err as Error).message);
    return false;
  } finally {
    if (file !== null) {
      fileIo.closeSync(file.fd);
    }
  }
}

/** The bytes saved in a download file, 0 when it does not exist. */
export function fileSize(path: string): number {
  try {
    return fileIo.accessSync(path) ? fileIo.statSync(path).size : 0;
  } catch (err) {
    return 0;
  }
}

export function deleteFile(path: string): void {
  try {
    if (fileIo.accessSync(path)) {
      fileIo.unlinkSync(path);
    }
  } catch (err) {
    logError(LOG_TAG, 'failed to delete a download file: ' + (err as Error).message);
  }
}
