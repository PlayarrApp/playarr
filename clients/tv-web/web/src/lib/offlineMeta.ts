import type { ApiClient, WorkDetail } from "@playarr-tv/api-client";

/**
 * Metadata and artwork kept on the device for downloaded titles, so their detail page looks the same offline as online:
 * the work's detail tree (synopsis, cast list, seasons and episodes, albums and tracks), credits, poster, backdrop,
 * episode stills, album covers and the cast headshots. Written when a download is requested, read only when the server
 * cannot answer (the device is offline, or the request failed), and removed with the last download of the work.
 */
const DB_NAME = "playarr-offline-meta";
const STORE = "meta";

interface MetaRow {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const request = work(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Writes run one after another: each also updates the work's key index (a read-modify-write).
let writes: Promise<unknown> = Promise.resolve();
function put(workId: string, key: string, value: unknown): Promise<void> {
  const next = writes.then(async () => {
    await run("readwrite", (s) => s.put({ key, value } satisfies MetaRow));
    const index = ((await get<string[]>(`index|${workId}`)) ?? []).filter((k) => k !== key);
    await run("readwrite", (s) => s.put({ key: `index|${workId}`, value: [...index, key] } satisfies MetaRow));
  });
  writes = next.catch(() => undefined);
  return next;
}

async function get<T>(key: string): Promise<T | undefined> {
  const row = await run<MetaRow | undefined>("readonly", (s) => s.get(key));
  return row?.value as T | undefined;
}

/** Removes everything stored for a work (called when its last download goes). */
export async function deleteWorkMeta(workId: string): Promise<void> {
  const keys = (await get<string[]>(`index|${workId}`)) ?? [];
  for (const key of [...keys, `index|${workId}`]) await run("readwrite", (s) => s.delete(key));
}

let downloadedMediaFiles: () => ReadonlySet<string> = () => new Set();
/** The provider tells the store which media files are downloaded, so a stored detail tree lists only those. */
export function setDownloadedMediaFiles(supplier: () => ReadonlySet<string>): void {
  downloadedMediaFiles = supplier;
}

/** Keeps only the leaves (episodes, tracks) that are downloaded; a movie keeps its own file. */
export function filterDetailToDownloaded(detail: WorkDetail, have: ReadonlySet<string>): WorkDetail {
  const c = detail.children;
  if (typeof c !== "object" || c === null) return detail;
  if ("Series" in c) {
    const Series = c.Series.map((s) => ({ ...s, episodes: s.episodes.filter((e) => e.media_file_id && have.has(e.media_file_id)) })).filter((s) => s.episodes.length > 0);
    return { ...detail, children: { Series } };
  }
  if ("Artist" in c) {
    const Artist = c.Artist.map((a) => ({ ...a, tracks: a.tracks.filter((t) => t.media_file_id && have.has(t.media_file_id)) })).filter((a) => a.tracks.length > 0);
    return { ...detail, children: { Artist } };
  }
  return detail;
}

async function tryOnline<T>(key: string, call: () => Promise<T>, fromStore: (stored: unknown) => T | undefined): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const stored = await get<unknown>(key).catch(() => undefined);
    const value = stored === undefined ? undefined : fromStore(stored);
    if (value !== undefined) return value;
  }
  try {
    return await call();
  } catch (error) {
    const stored = await get<unknown>(key).catch(() => undefined);
    const value = stored === undefined ? undefined : fromStore(stored);
    if (value !== undefined) return value;
    throw error;
  }
}

/** Makes the client's detail, credits and artwork calls fall back to the stored copies when the server cannot answer. */
export function withOfflineMeta(client: ApiClient): ApiClient {
  const getWork = client.getWork.bind(client);
  const getWorkCredits = client.getWorkCredits.bind(client);
  const getWorkArtwork = client.getWorkArtwork.bind(client);
  const getEpisodeArtwork = client.getEpisodeArtwork.bind(client);
  const getAlbumArtwork = client.getAlbumArtwork.bind(client);
  const getPersonArtwork = client.getPersonArtwork.bind(client);
  const blob = (v: unknown) => (v instanceof Blob ? v : undefined);
  client.getWork = (id, options) =>
    tryOnline(`detail|${id}`, () => getWork(id, options), (v) => filterDetailToDownloaded(v as WorkDetail, downloadedMediaFiles()));
  client.getWorkCredits = (id) => tryOnline(`credits|${id}`, () => getWorkCredits(id), (v) => v as Awaited<ReturnType<typeof getWorkCredits>>);
  client.getWorkArtwork = (id, kind, size) => tryOnline(`art|${id}|${kind}`, () => getWorkArtwork(id, kind, size), blob);
  client.getEpisodeArtwork = (series, episode, kind = "thumb", size) =>
    tryOnline(`ep|${series}|${episode}|${kind}`, () => getEpisodeArtwork(series, episode, kind, size), blob);
  client.getAlbumArtwork = (artist, album, kind, size) =>
    tryOnline(`album|${artist}|${album}|${kind}`, () => getAlbumArtwork(artist, album, kind, size), blob);
  client.getPersonArtwork = (id, width) => tryOnline(`person|${id}`, () => getPersonArtwork(id, width), blob);
  return client;
}

const CAST_HEADSHOTS = 24;

/**
 * Stores a work's detail, credits and artwork (web's sizes: poster 360, backdrop 1920, thumbs 540, covers, headshots 240).
 * Best effort: a failed piece is skipped. Does nothing offline or when the work is already stored.
 */
export async function cacheWorkForOffline(client: ApiClient, workId: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if ((await get(`index|${workId}`).catch(() => undefined)) !== undefined) return;
  const settle = async (key: string, job: () => Promise<unknown>) => {
    try {
      await put(workId, key, await job());
    } catch {
      /* a missing piece just stays online-only */
    }
  };
  let detail: WorkDetail;
  try {
    detail = await client.getWork(workId);
  } catch {
    return;
  }
  await put(workId, `detail|${workId}`, detail);
  const jobs: Array<Promise<void>> = [];
  for (const image of detail.work.images) {
    if (image.kind === "poster") jobs.push(settle(`art|${workId}|poster`, () => client.getWorkArtwork(workId, "poster", { width: 360 })));
    if (image.kind === "backdrop") jobs.push(settle(`art|${workId}|backdrop`, () => client.getWorkArtwork(workId, "backdrop", { width: 1920 })));
  }
  jobs.push(
    settle(`credits|${workId}`, async () => {
      const credits = await client.getWorkCredits(workId);
      for (const credit of [...credits.cast, ...credits.crew].slice(0, CAST_HEADSHOTS)) {
        if (credit.person.headshot_url) jobs.push(settle(`person|${credit.person.id}`, () => client.getPersonArtwork(credit.person.id, 240)));
      }
      return credits;
    })
  );
  const children = detail.children;
  if (typeof children === "object" && children !== null) {
    if ("Series" in children) {
      for (const season of children.Series) {
        for (const e of season.episodes) {
          if (e.episode.images.some((i) => i.kind === "thumb")) jobs.push(settle(`ep|${workId}|${e.episode.id}|thumb`, () => client.getEpisodeArtwork(workId, e.episode.id, "thumb", { width: 540 })));
        }
      }
    } else if ("Artist" in children) {
      for (const a of children.Artist) {
        for (const image of a.album.images) {
          jobs.push(settle(`album|${workId}|${a.album.id}|${image.kind}`, () => client.getAlbumArtwork(workId, a.album.id, image.kind, { width: image.kind === "backdrop" ? 780 : 540 })));
        }
      }
    }
  }
  // The credits job adds headshot jobs while it runs: wait until none are left.
  let done = 0;
  while (done < jobs.length) {
    const batch = jobs.slice(done);
    done = jobs.length;
    await Promise.all(batch);
  }
}
