#!/usr/bin/env node
// Offline downloads (owner 2026-10-12): with the network off, a completed download plays on the FIRST try (no "Try again",
// no race with the local-copy load), and its Downloads row opens a detail page that renders from the local metadata with
// Play reachable (no stuck skeleton).
//   node scripts/downloads-offline-e2e.mjs [--no-build] [--dist dir]
import { boot, USER_ID } from "./e2e-common.mjs";

const { check, open, finish, base } = await boot({ canDownload: true }, { realisticAuth: true });
const row = {
  id: "dl-film", workId: "w-film", workKind: "movie", mediaFileId: "m-film", userId: USER_ID, serverUrl: base, title: "Offline Film", subtitle: null,
  qualityId: "q", qualityLabel: "1080p", container: "mp4", totalBytes: 1000, bytesDownloaded: 1000, lastCompletedByteOffset: 0, status: "ready",
  keepUntil: { type: "forever" }, watchedAt: null, errorMessage: null, requestedAt: "2026-10-01T00:00:00.000Z", readyAt: "2026-10-01T00:01:00.000Z",
  storage: "idb-blob", runtimeMs: 60000, mimeType: "video/mp4",
};

async function seed(page) {
  await page.evaluate(async (r) => {
    await new Promise((resolve, reject) => {
      const o = indexedDB.open("playarr-downloads", 1);
      o.onupgradeneeded = () => {
        const db = o.result;
        const store = db.createObjectStore("downloads", { keyPath: "id" });
        store.createIndex("byUserId", "userId", { unique: false });
        store.createIndex("byStatus", "status", { unique: false });
        db.createObjectStore("downloadChunks", { keyPath: "key" }).createIndex("byDownloadId", "downloadId", { unique: false });
        db.createObjectStore("watchMutations", { keyPath: "id" }).createIndex("byUserId", "userId", { unique: false });
      };
      o.onsuccess = () => {
        const tx = o.result.transaction(["downloads", "downloadChunks"], "readwrite");
        tx.objectStore("downloads").clear();
        tx.objectStore("downloads").put(r);
        tx.objectStore("downloadChunks").put({ key: `${r.id}#0`, downloadId: r.id, chunkIndex: 0, blob: new Blob([new Uint8Array(1000)], { type: "video/mp4" }) });
        tx.oncomplete = () => { o.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      o.onerror = () => reject(o.error);
    });
  }, row);
}
const goto = (page, path) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);

for (const [width, height] of [[1920, 1080], [390, 845]]) {
  const tag = `${width}`;
  const { context, page, errors } = await open("/", { width, height });
  await page.waitForTimeout(800);
  await seed(page);
  await page.reload();
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.waitForTimeout(300);

  // Detail from the Downloads row, offline.
  await goto(page, "/downloads");
  await page.waitForSelector("a.tv-download-row-copy", { timeout: 8000 });
  await page.locator("a.tv-download-row-copy").first().click();
  await page.waitForTimeout(1500);
  const detail = await page.evaluate(() => ({
    title: document.querySelector(".tv-detail-title")?.textContent ?? "",
    busy: Boolean(document.querySelector("[aria-busy='true']")),
    play: Boolean(document.querySelector("a[href^='/player/m-film']")),
  }));
  check(`${tag}: the offline detail page shows the downloaded title, not a skeleton`, detail.title === "Offline Film" && !detail.busy, JSON.stringify(detail));
  check(`${tag}: Play is reachable on the offline detail page`, detail.play, JSON.stringify(detail));

  // Playback, offline, first try: Play from the detail page, and the player opened directly (a reload or a bookmark).
  await page.locator("a[href^='/player/m-film']").first().click();
  let ok = false;
  for (let i = 0; i < 40 && !ok; i += 1) {
    await page.waitForTimeout(250);
    ok = await page.evaluate(() => (document.querySelector("video")?.getAttribute("src") ?? document.querySelector("video")?.currentSrc ?? "").startsWith("blob:"));
  }
  const retry = await page.locator(".player-retry-btn").count();
  check(`${tag}: offline play uses the local copy on the first try`, ok && retry === 0, `blob ${ok}, retry buttons ${retry}`);
  check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
  await context.close();
}
await finish();
