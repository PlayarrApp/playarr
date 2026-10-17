// DEBUG BUILD ONLY. Cross-origin artwork (provider posters) cannot be rasterised by html-to-image, so before a frame
// is rendered each on-screen foreign image is fetched through the receiver's same-origin proxy and swapped for a data URL.
const MAX_IMAGES = 80;

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
    if (!cache.has(original)) cache.set(original, await toDataUrl(fetcher, proxy));
    const dataUrl = cache.get(original);
    if (dataUrl) {
      swapped.push([img, img.src, img.srcset]);
      img.srcset = "";
      img.src = dataUrl;
    }
  }));
  return () => swapped.forEach(([img, src, srcset]) => { img.src = src; img.srcset = srcset; });
}
