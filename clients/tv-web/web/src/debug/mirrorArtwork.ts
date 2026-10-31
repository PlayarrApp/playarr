// DEBUG BUILD ONLY. Cross-origin artwork (provider posters) cannot be rasterised by html-to-image, so before a frame
// is rendered each on-screen foreign image is fetched through the receiver's same-origin proxy and swapped for a data URL.
const MAX_IMAGES = 80;
// Data URLs are 100 KB or more each: a long browse would otherwise keep every poster ever shown. Twice a frame's worth is enough
// to serve the next frame from memory; the oldest entries go first (Map keeps insertion order).
export const MAX_CACHED_ARTWORK = MAX_IMAGES * 2;

export function trimArtworkCache(cache: Map<string, string | null>, max = MAX_CACHED_ARTWORK): void {
  while (cache.size > max) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

export function artworkProxyUrl(src: string, pageOrigin: string, token: string): string | null {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return null;
  try {
    const url = new URL(src, pageOrigin);
    if (url.origin === pageOrigin || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
    return `${pageOrigin}/__mirror/img?u=${encodeURIComponent(url.href)}&t=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

async function toDataUrl(fetcher: typeof fetch, proxyUrl: string): Promise<string | null> {
  try {
    const res = await fetcher(proxyUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${res.headers.get("content-type") || "image/jpeg"};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** Swap visible foreign images for data URLs; returns a function that restores the originals. */
export async function inlineArtwork(
  images: HTMLImageElement[],
  pageOrigin: string,
  token: string,
  cache: Map<string, string | null>,
  fetcher: typeof fetch = window.fetch.bind(window),
): Promise<() => void> {
  const swapped: Array<[HTMLImageElement, string, string]> = [];
  await Promise.all(images.slice(0, MAX_IMAGES).map(async (img) => {
    const original = img.currentSrc || img.src;
    const proxy = artworkProxyUrl(original, pageOrigin, token);
    if (!proxy) return;
    let dataUrl: string | null | undefined;
    if (cache.has(original)) dataUrl = cache.get(original);
    else {
      dataUrl = await toDataUrl(fetcher, proxy);
      cache.set(original, dataUrl);
      trimArtworkCache(cache);
    }
    if (dataUrl) {
      swapped.push([img, img.src, img.srcset]);
      img.srcset = "";
      img.src = dataUrl;
    }
  }));
  return () => swapped.forEach(([img, src, srcset]) => { img.src = src; img.srcset = srcset; });
}
