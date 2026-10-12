#!/usr/bin/env node
// Downloads edit (owner 2026-10-12, "edit per each level"): the edit drawer changes quality as well as keep-until.
// A new quality re-converts through a NEW ticket (POST /downloads with the new quality) and then removes the old
// download; saving with the quality untouched only updates keep-until and requests no ticket. Keyboard and touch.
//   node scripts/downloads-edit-quality-e2e.mjs [--no-build] [--dist dir]
import { boot, USER_ID } from "./e2e-common.mjs";

const { check, open, finish, base, server } = await boot({ canDownload: true }, { realisticAuth: true });
const film = (id, over = {}) => ({
  id, workId: `w-${id}`, workKind: "movie", mediaFileId: `m-${id}`, userId: USER_ID, serverUrl: base, title: `Film ${id}`, subtitle: null,
  qualityId: "1080p", qualityLabel: "1080p", container: "mp4", totalBytes: 1000, bytesDownloaded: 1000, lastCompletedByteOffset: 0, status: "ready",
  keepUntil: { type: "forever" }, watchedAt: null, errorMessage: null, requestedAt: "2026-10-01T00:00:00.000Z", readyAt: "2026-10-01T00:01:00.000Z",
  storage: "idb-blob", runtimeMs: 60000, mimeType: "video/mp4", ...over,
});

async function seed(page, rows) {
  await page.evaluate(async (rows) => {
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
        const tx = o.result.transaction("downloads", "readwrite");
        tx.objectStore("downloads").clear();
        for (const r of rows) tx.objectStore("downloads").put(r);
        tx.oncomplete = () => { o.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      o.onerror = () => reject(o.error);
    });
  }, rows);
}
const rows = (page) =>
  page.evaluate(() => new Promise((resolve) => {
    const o = indexedDB.open("playarr-downloads", 1);
    o.onsuccess = () => {
      const req = o.result.transaction("downloads").objectStore("downloads").getAll();
      req.onsuccess = () => { o.result.close(); resolve(req.result.map((r) => ({ id: r.id, q: r.qualityId, keep: r.keepUntil.type, media: r.mediaFileId }))); };
    };
  }));

for (const [width, height, label] of [[1920, 1080, "TV"], [390, 845, "390px"]]) {
  server.downloadRequests.length = 0;
  const { context, page, errors } = await open("/downloads", { width, height });
  await seed(page, [film("a")]);
  await page.reload();
  await page.waitForSelector(".tv-download-row", { timeout: 15000 });
  await page.waitForTimeout(1000);
  const tag = (s) => `${label}: ${s}`;
  const edit = () => page.locator(".tv-download-row-actions button", { hasText: /^Edit$/ }).first().click();

  // Quality untouched: keep-until only, no ticket.
  await edit();
  await page.waitForSelector(".download-quality-drawer .ui-select-trigger");
  check(tag("the edit drawer has a quality select showing the current quality"), /1080p/.test(await page.locator(".download-quality-drawer .ui-select-trigger").innerText()));
  check(tag("no re-download hint while the quality is unchanged"), (await page.locator(".download-quality-drawer-hint", { hasText: /again|re-download/i }).count()) === 0);
  await page.locator(".download-quality-drawer button.is-primary").click();
  await page.waitForTimeout(800);
  check(tag("saving without a quality change requests no ticket"), server.downloadRequests.length === 0, JSON.stringify(server.downloadRequests));

  // New quality: new ticket with it, old download gone.
  await edit();
  await page.waitForSelector(".download-quality-drawer .ui-select-trigger");
  await page.locator(".download-quality-drawer .ui-select-trigger").click();
  await page.locator(".ui-select-option", { hasText: "720p" }).first().click();
  check(tag("changing the quality shows the re-download hint"), (await page.locator(".download-quality-drawer-hint", { hasText: /again/i }).count()) === 1);
  await page.locator(".download-quality-drawer button.is-primary").click();
  await page.waitForTimeout(1500);
  const after = await rows(page);
  check(tag("changing quality requests a new ticket for the same media file"), server.downloadRequests.length === 1 && server.downloadRequests[0].quality_id === "720p" && server.downloadRequests[0].media_file_id === "m-a", JSON.stringify(server.downloadRequests));
  check(tag("the old 1080p download is replaced by the 720p one"), after.length === 1 && after[0].q === "720p" && after[0].id !== "a", JSON.stringify(after));
  check(tag("no page errors"), errors.length === 0, errors.join("; "));
  await context.close();
}
await finish();
