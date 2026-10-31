import { describe, expect, it } from "vitest";
import { artworkProxyUrl, inlineArtwork, trimArtworkCache } from "./mirrorArtwork";

describe("debug mirror artwork", () => {
  it("proxies only foreign http(s) images", () => {
    const origin = "http://tv.local:1";
    expect(artworkProxyUrl("https://img.example/p.jpg", origin, "tok")).toBe(
      "http://tv.local:1/__mirror/img?u=https%3A%2F%2Fimg.example%2Fp.jpg&t=tok");
    expect(artworkProxyUrl("/local.png", origin, "tok")).toBeNull();
    expect(artworkProxyUrl("data:image/gif;base64,AA", origin, "tok")).toBeNull();
    expect(artworkProxyUrl("ftp://x/y.png", origin, "tok")).toBeNull();
  });

  it("swaps a foreign image for the proxied data URL and restores it", async () => {
    const img = { currentSrc: "https://img.example/p.jpg", src: "https://img.example/p.jpg", srcset: "" } as HTMLImageElement;
    const fetcher = (async () => new Response(new Blob(["x"], { type: "image/jpeg" }))) as typeof fetch;
    const restore = await inlineArtwork([img], "http://tv.local:1", "tok", new Map(), fetcher);
    expect(img.src.startsWith("data:image/jpeg")).toBe(true);
    restore();
    expect(img.src).toBe("https://img.example/p.jpg");
  });

  it("keeps the data-URL cache bounded, oldest entry first", () => {
    const cache = new Map<string, string | null>();
    for (let i = 0; i < 10; i += 1) cache.set(`u${i}`, `d${i}`);
    trimArtworkCache(cache, 4);
    expect([...cache.keys()]).toEqual(["u6", "u7", "u8", "u9"]);
  });

  it("bounds the cache while swapping many distinct images", async () => {
    const fetcher = (async () => new Response(new Blob(["x"], { type: "image/jpeg" }))) as typeof fetch;
    const cache = new Map<string, string | null>();
    for (let round = 0; round < 5; round += 1) {
      const imgs = Array.from({ length: 80 }, (_, i) => ({ currentSrc: `https://img.example/${round}-${i}.jpg`, src: "", srcset: "" }) as HTMLImageElement);
      (await inlineArtwork(imgs, "http://tv.local:1", "tok", cache, fetcher))();
    }
    expect(cache.size).toBeLessThanOrEqual(160);
  });
});
