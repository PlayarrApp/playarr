/**
 * Your data (web `startUserDataExport` and friends): the TV flow, which moves the package between devices through a
 * one-time link shown as a QR code, so nothing here touches a file. Every function wraps the one `PlayarrClient`.
 */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import {
  dataExportsUrl,
  dataExportUrl,
  dataExportTransferLinkUrl,
  dataImportSessionsUrl,
  dataImportSessionUrl,
} from '../core/Endpoints.ts';
import { importQuery } from '../core/PortableData.ts';
import {
  UserDataExportJob,
  UserDataTransferLink,
  UserDataImportSession,
  UserDataImportPreview,
  UserDataImportResult,
} from '../core/Types/PortableData.ts';

/** `POST data-exports`: starts (or returns the unfinished) export of this account's own data. */
export function startDataExport(): Promise<ApiResult<UserDataExportJob>> {
  return getPlayarrClient().postJson<Object, UserDataExportJob>(dataExportsUrl(), new Object());
}

export function getDataExport(id: string): Promise<ApiResult<UserDataExportJob>> {
  return getPlayarrClient().getJson<UserDataExportJob>(dataExportUrl(id));
}

/** `POST data-exports/{id}/transfer-link`: a one-time download link for another device. */
export function createExportTransferLink(id: string): Promise<ApiResult<UserDataTransferLink>> {
  return getPlayarrClient().postJson<Object, UserDataTransferLink>(dataExportTransferLinkUrl(id), new Object());
}

/** `POST data-import-sessions`: a session whose one-time upload link another device uses. */
export function createImportSession(): Promise<ApiResult<UserDataImportSession>> {
  return getPlayarrClient().postJson<Object, UserDataImportSession>(dataImportSessionsUrl(), new Object());
}

export function getImportSession(id: string): Promise<ApiResult<UserDataImportSession>> {
  return getPlayarrClient().getJson<UserDataImportSession>(dataImportSessionUrl(id));
}

export function deleteImportSession(id: string): Promise<ApiResult<Object>> {
  return getPlayarrClient().deleteJson<Object>(dataImportSessionUrl(id));
}

/** `POST .../preview`: what the uploaded package would change; nothing is written. */
export function previewImportSession(id: string, includePreferences: boolean, keepExisting: boolean): Promise<ApiResult<UserDataImportPreview>> {
  return getPlayarrClient().postJson<Object, UserDataImportPreview>(
    dataImportSessionUrl(id) + '/preview?' + importQuery(includePreferences, keepExisting, ''), new Object());
}

/** `POST .../apply`: applies the previewed package, bound by its SHA-256. */
export function applyImportSession(id: string, sha256: string, includePreferences: boolean, keepExisting: boolean): Promise<ApiResult<UserDataImportResult>> {
  return getPlayarrClient().postJson<Object, UserDataImportResult>(
    dataImportSessionUrl(id) + '/apply?' + importQuery(includePreferences, keepExisting, sha256), new Object());
}
