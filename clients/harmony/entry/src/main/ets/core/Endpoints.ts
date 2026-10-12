// core/Endpoints.ts
//
// One exported function per Playarr Server endpoint, each a pure function of its
// parameters returning the exact server-relative path string. This is the
// ONLY file under core/ allowed to contain the literal "/api/" substring;
// every other layer must build request paths by calling these functions,
// never by hand-writing a path.
//
// App endpoints live under /api/v1/...; system probes live under
// /api/system/.... Query-string construction (limit, offset, kind, etc.) is
// deliberately left to the caller (data/ repositories) so this file stays a
// pure, dependency-free path table.
//
// No ArkUI, no @kit./@ohos. imports, no decorators: plain, Linux-testable
// TypeScript.

// -- 4.13 Version / compatibility -------------------------------------------

export function systemVersionUrl(): string {
  return "/api/system/version";
}

// -- 4.3 Device authorisation (RFC 8628) ------------------------------------

export function deviceCodeUrl(): string {
  return "/api/v1/oauth/device/code";
}

export function tokenUrl(): string {
  return "/api/v1/oauth/token";
}

// -- 4.5 Token refresh -------------------------------------------------------

export function refreshUrl(): string {
  return "/api/v1/auth/refresh";
}

// -- 4.6 Login ----------------------------------------------------------------

export function loginUrl(): string {
  return "/api/v1/auth/login";
}

// -- 4.7 Profiles --------------------------------------------------------------

export function profilesUrl(): string {
  return "/api/v1/users/profiles";
}

export function verifyPinUrl(profileId: string): string {
  return "/api/v1/users/profiles/" + profileId + "/verify-pin";
}

export function capabilitiesUrl(): string {
  return "/api/v1/users/me/capabilities";
}

export function playerPreferencesUrl(): string {
  return "/api/v1/users/me/player-preferences";
}

// -- 4.8 Catalog -----------------------------------------------------------

export function catalogUrl(): string {
  return "/api/v1/catalog";
}

/** `POST /api/v1/watchlist` (add a title snapshot). */
export function watchlistUrl(): string {
  return "/api/v1/watchlist";
}

/** `DELETE /api/v1/watchlist/{title_key}`. */
export function watchlistItemUrl(titleKey: string): string {
  return `/api/v1/watchlist/${encodeURIComponent(titleKey)}`;
}

/** `POST /api/v1/discover/resolve`: a title snapshot resolved for the caller (its `title_key`). */
export function discoverResolveUrl(): string {
  return "/api/v1/discover/resolve";
}

/** `GET /api/v1/calendar?start=&end=` (inclusive UTC days, at most 92 apart). */
export function calendarUrl(start: string, end: string): string {
  return `/api/v1/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}

/** `GET`/`POST /api/v1/calendar/feed` (the viewer's iCal link; `rotate` replaces it). */
export function calendarFeedUrl(rotate: boolean = false): string {
  return rotate ? "/api/v1/calendar/feed?rotate=true" : "/api/v1/calendar/feed";
}

/** `GET /api/v1/requests`: the viewer's title requests (administrators see everyone's). */
export function requestsUrl(): string {
  return "/api/v1/requests";
}

/** `GET /api/v1/playlists`: the viewer's playlists (their own and System ones). */
export function playlistsUrl(): string {
  return "/api/v1/playlists";
}

/** `PATCH`/`DELETE /api/v1/playlists/{id}`. */
export function playlistUrl(id: string): string {
  return `/api/v1/playlists/${encodeURIComponent(id)}`;
}

/** `PUT /api/v1/playlists/{id}/items/order`. */
export function playlistItemOrderUrl(id: string): string {
  return `/api/v1/playlists/${encodeURIComponent(id)}/items/order`;
}

/** `DELETE /api/v1/playlists/{id}/items/{item_id}`. */
export function playlistItemUrl(id: string, itemId: string): string {
  return `/api/v1/playlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`;
}

/** `GET /api/v1/playlists/{id}/items`. */
export function playlistItemsUrl(id: string): string {
  return `/api/v1/playlists/${encodeURIComponent(id)}/items`;
}

/** `POST`/`GET /api/v1/downloads`: create a download ticket, list the caller's tickets. */
export function downloadsUrl(): string {
  return "/api/v1/downloads";
}

/** `GET`/`DELETE /api/v1/downloads/{id}`: poll or cancel one ticket. */
export function downloadTicketUrl(id: string): string {
  return `/api/v1/downloads/${encodeURIComponent(id)}`;
}

/** `GET /api/v1/downloads/{id}/file`: the range-resumable file. */
export function downloadFileUrl(id: string): string {
  return `/api/v1/downloads/${encodeURIComponent(id)}/file`;
}

/** `GET /api/v1/media/{id}/download-options`: the qualities one media file can be downloaded at. */
export function downloadOptionsUrl(mediaFileId: string): string {
  return `/api/v1/media/${encodeURIComponent(mediaFileId)}/download-options`;
}

/** `GET /api/v1/home/rails`: the server-curated Home rails web TV Home renders. */
export function homeRailsUrl(): string {
  return "/api/v1/home/rails";
}

export function catalogKindsUrl(): string {
  return "/api/v1/catalog/kinds";
}

export function catalogSearchUrl(): string {
  return "/api/v1/catalog/search";
}

export function catalogDetailUrl(id: string): string {
  return "/api/v1/catalog/" + id;
}

/** `GET /api/v1/catalog/{id}/resume-plan`: where a series plays from (404 on a server without it). */
export function catalogResumePlanUrl(id: string): string {
  return "/api/v1/catalog/" + id + "/resume-plan";
}

/** `GET /api/v1/catalog/{id}/credits`: the work's cast and crew (empty, not 404, for a work with none). */
export function catalogCreditsUrl(id: string): string {
  return "/api/v1/catalog/" + id + "/credits";
}

/** `GET` and `PATCH /api/v1/media/{media_file_id}/playback-options`: the file's quality, audio and subtitle choices and the saved preferences. */
export function mediaPlaybackOptionsUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/playback-options";
}

export function catalogSimilarUrl(id: string): string {
  return "/api/v1/catalog/" + id + "/similar";
}

export function viewsUrl(): string {
  return "/api/v1/views";
}

export function viewResolveUrl(id: string): string {
  return "/api/v1/views/" + id + "/resolve";
}

// -- 4.9 Artwork -----------------------------------------------------------

export function artworkWorkUrl(workId: string, kind: string): string {
  return "/api/v1/artwork/work/" + workId + "/" + kind;
}

export function artworkAlbumUrl(artistWorkId: string, albumId: string, kind: string): string {
  return "/api/v1/artwork/album/" + artistWorkId + "/" + albumId + "/" + kind;
}

export function mediaThumbnailUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/thumbnail";
}

// -- 4.10 Playback negotiation ------------------------------------------------

export function playbackInfoUrl(mediaFileId: string): string {
  return "/api/v1/playback/" + mediaFileId;
}

// -- 4.11 Fetching bytes -----------------------------------------------------

export function mediaStreamUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/stream";
}

export function mediaChaptersUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/chapters";
}

export function mediaMetadataUrl(mediaFileId: string): string {
  return "/api/v1/media/" + mediaFileId + "/metadata";
}

export function mediaSubtitleUrl(mediaFileId: string, streamIndex: number): string {
  return "/api/v1/media/" + mediaFileId + "/subtitles/" + String(streamIndex);
}

// -- 4.12 Playback session reporting ------------------------------------------

export function playbackEventsUrl(sessionId: string): string {
  return "/api/v1/playback/sessions/" + sessionId + "/events";
}

export function playbackProgressListUrl(): string {
  return "/api/v1/playback/progress";
}

export function playbackProgressUrl(mediaFileId: string): string {
  return "/api/v1/playback/" + mediaFileId + "/progress";
}

// -- Hosted TV link broker (used before the client knows a server address) --

export const HOSTED_LINK_ORIGIN = "https://playarr.app";

export function hostedLinkCodeUrl(): string {
  return HOSTED_LINK_ORIGIN + "/api/link/code";
}

export function hostedLinkClaimUrl(deviceCode: string): string {
  return HOSTED_LINK_ORIGIN + "/api/link/code/" + encodeURIComponent(deviceCode);
}
