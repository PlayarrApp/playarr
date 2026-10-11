/**
 * Builds authed artwork URLs directly, rather than fetching a `Blob` the
 * way `@playarr-tv/api-client`'s `getWorkArtwork`/`getAlbumArtwork` (and
 * the web app's own `lib/artwork.tsx`) do.
 *
 * That Blob-based approach cannot port to Vega as-is: it exists specifically
 * so a browser can wrap the response in `URL.createObjectURL(blob)` for a
 * plain `<img src>`, keeping the bearer token out of the URL entirely.
 * React Native's `Blob` is not spec-complete and there is no
 * `URL.createObjectURL` at all (design doc assumption A4). The RN
 * replacement strategy is the opposite of hiding the token: hand
 * `<Image source={{uri, headers}}>` the real URL these functions build,
 * plus an `Authorization` header (assumed to actually reach the native
 * image loader -- `platform/capabilities.ts`'s `artworkRequestHeaders`
 * flag is the one place that assumption is recorded and would need
 * flipping if it turns out wrong; `components/ArtworkImage.tsx`, a later
 * step, is what actually renders against these two exports and owns the
 * data-URI fallback for if it does).
 *
 * Every path template below is copied character-for-character from
 * `@playarr-tv/api-client/src/index.ts`'s own `getWorkArtwork`/
 * `getAlbumArtwork` -- both of those operations are also in that file's
 * `PROTECTED_OPERATIONS` list, confirming the `Authorization` header these
 * URLs need is not optional.
 */
import type {Album, ImageKind, Work} from '@playarr-tv/api-client';

/**
 * `client.resolveUrl('/')` ends in a slash, and a `//api/...` path is a 404 on the server (found on a real Fire TV:
 * every poster rendered as a grey box because the native image loader got a double slash), so the base never keeps one.
 */
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * The width the web asks the artwork endpoint for (`defaultArtworkWidth` in the web's lib/artwork.tsx). The server snaps it up
 * to 160, 240, 360, 540, 780, 1280 or 1920 and never upscales, so the device decodes the same pixels the browser does.
 */
export function defaultArtworkWidth(kind: ImageKind): number {
  switch (kind) {
    case 'poster':
      return 360;
    case 'banner':
    case 'backdrop':
      return 780;
    default:
      return 540;
  }
}

/** `GET /api/v1/artwork/work/{work_id}/{kind}` -- a work's own poster/backdrop/etc. */
export function workArtworkUrl(baseUrl: string, workId: string, kind: ImageKind, width: number = defaultArtworkWidth(kind)): string {
  return `${trimBase(baseUrl)}/api/v1/artwork/work/${encodeURIComponent(workId)}/${encodeURIComponent(kind)}?w=${width}`;
}

/** `GET /api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}` -- an album's own artwork, scoped to the artist's visible library. */
export function albumArtworkUrl(
  baseUrl: string,
  artistWorkId: string,
  albumId: string,
  kind: ImageKind,
  width: number = defaultArtworkWidth(kind)
): string {
  return `${trimBase(baseUrl)}/api/v1/artwork/album/${encodeURIComponent(artistWorkId)}/${encodeURIComponent(
    albumId
  )}/${encodeURIComponent(kind)}?w=${width}`;
}

/** The one header every artwork request needs -- `undefined` (no header at all) when no token is available yet, matching every other protected call's convention in this app. */
export function artworkAuthHeaders(accessToken: string | undefined): Record<string, string> | undefined {
  return accessToken ? {Authorization: `Bearer ${accessToken}`} : undefined;
}

/**
 * The first `kind` (in caller-supplied preference order) this work or
 * album actually has an image for, or `null` if none of the requested
 * kinds are available. Ported from the web app's `lib/artwork.tsx` --
 * pure, DOM-free logic over `Work`/`Album`'s own `images` field, unchanged
 * by the Blob-vs-URL difference above.
 */
export function preferredArtworkKind(
  work: Pick<Work, 'images'> | Pick<Album, 'images'>,
  kinds: readonly ImageKind[]
): ImageKind | null {
  return kinds.find((kind) => work.images.some((image) => image.kind === kind)) ?? null;
}

/** A frame extracted from a media file (the web's `getMediaThumbnail`); the server defaults to 30 s in. */
export function mediaThumbnailUrl(baseUrl: string, mediaFileId: string, positionMs?: number): string {
  const path = `${trimBase(baseUrl)}/api/v1/media/${encodeURIComponent(mediaFileId)}/thumbnail`;
  return positionMs === undefined ? path : `${path}?position_ms=${positionMs}`;
}

/** An episode's own still (the web's `getEpisodeArtwork`). */
export function episodeArtworkUrl(baseUrl: string, seriesWorkId: string, episodeId: string, kind: ImageKind = 'thumb', width: number = defaultArtworkWidth(kind)): string {
  return `${trimBase(baseUrl)}/api/v1/artwork/episode/${encodeURIComponent(seriesWorkId)}/${encodeURIComponent(episodeId)}/${encodeURIComponent(kind)}?w=${width}`;
}
