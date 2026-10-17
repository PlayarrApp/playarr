#!/usr/bin/env node
// Page content must never overlap the shell action column (the right-hand Filters / Notifications / Calendar-link bar),
// at any width, in either theme. Walks every routed page at 1920x1080, 1280x720, a tablet width and phone widths
// (the parity-ref sizes) and fails when a visible content element's box intersects the column's box.
//   node scripts/action-bar-overlap-e2e.mjs [--no-build] [--dist dir]
import { boot, USER_ID } from "./e2e-common.mjs";

const { check, open, finish, base } = await boot({ canDownload: true, movies: 24, series: 8, artists: 4 }, { realisticAuth: true });
const movieId = (await (await fetch(`${base}/api/v1/catalog?kind=movie&limit=1`, { headers: { authorization: "Bearer t" } })).json()).items[0]?.id;

const T = (n) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();
const rec = (id, over) => ({
  id, workId: "w-movie", workKind: "movie", mediaFileId: `m-${id}`, userId: USER_ID, serverUrl: base, title: id, subtitle: null, qualityId: "q", qualityLabel: "1080p",
  container: "mp4", totalBytes: 1_000_000, bytesDownloaded: 1_000_000, lastCompletedByteOffset: 0, status: "ready", keepUntil: { type: "forever" }, watchedAt: null,
  errorMessage: null, requestedAt: T(0), readyAt: T(1), storage: "idb-blob", runtimeMs: 1000, mimeType: "video/mp4", ...over,
});
const SEED = [rec("Film One", {}), rec("Film Two", { status: "failed", bytesDownloaded: 0, errorMessage: "broken" }), rec("Track One", { workKind: "artist", workId: "ar1" })];

async function seed(page) {
  await page.evaluate(async (rows) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("playarr-downloads", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore("downloads", { keyPath: "id" });
        store.createIndex("byUserId", "userId", { unique: false });
        store.createIndex("byStatus", "status", { unique: false });
        db.createObjectStore("downloadChunks", { keyPath: "key" }).createIndex("byDownloadId", "downloadId", { unique: false });
        db.createObjectStore("watchMutations", { keyPath: "id" }).createIndex("byUserId", "userId", { unique: false });
      };
      req.onsuccess = () => {
        const tx = req.result.transaction("downloads", "readwrite");
        for (const row of rows) tx.objectStore("downloads").put(row);
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, SEED);
}

const ROUTES = [
  ["home", "/"], ["downloads", "/downloads"], ["movies", "/movies"], ["series", "/series"], ["music", "/music"], ["sites", "/sites"],
  ["search", "/search?q=a"], ["watchlist", "/watchlist"], ["requests", "/requests"], ["playlists", "/playlists"], ["calendar", "/calendar"],
  ["calendar-month", "/calendar?view=month&date=2026-10-07"], ["folders", "/folders"], ["settings", "/settings"], ["settings-appearance", "/settings/appearance"],
  ["settings-home", "/settings/home"], ["settings-server", "/settings/server"], ["detail", `/movies/${movieId}`], ["clients", "/clients"],
];
const SIZES = [[1920, 1080], [1280, 720], [820, 1180], [390, 844]];

function overlaps() {
  const column = document.querySelector("[data-shell-action-column]");
  const c = column?.getBoundingClientRect();
  if (!c || c.width === 0 || c.height === 0) return { column: false, hits: [] };
  const skip = "[data-shell-action-column], .app-nav, .page-header, .tv-key-art, .tv-stage-wash, .app-clock, .skeleton-state, [aria-hidden='true']";
  const hits = [];
  for (const el of document.querySelectorAll("[data-page-id] *")) {
    if (el.closest(skip) || el.closest("[data-profile-chip], .profile-chip")) continue;
    const css = getComputedStyle(el);
    if (css.visibility === "hidden" || css.display === "none" || Number(css.opacity) === 0) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own && !/^(BUTTON|A|INPUT|SELECT|IMG|CANVAS|TEXTAREA)$/.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Content scrolled out of its clipping ancestor is not painted under the bar.
    let clipped = false;
    for (let p = el.parentElement; p && !clipped; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(o.overflowX + o.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (r.right <= pr.left || r.left >= pr.right || r.bottom <= pr.top || r.top >= pr.bottom) clipped = true;
      }
    }
    if (clipped) continue;
    if (r.left < c.right - 0.5 && r.right > c.left + 0.5 && r.top < c.bottom - 0.5 && r.bottom > c.top + 0.5) {
      hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} [${Math.round(r.left)}-${Math.round(r.right)}] vs bar [${Math.round(c.left)}-${Math.round(c.right)}]`);
    }
  }
  return { column: true, hits: hits.slice(0, 3) };
}

for (const theme of ["dark", "light"]) {
  for (const [width, height] of SIZES) {
    for (const [name, route] of ROUTES) {
      const { context, page } = await open(route, { width, height, init: `localStorage.setItem("playarr-theme", "${theme}")` });
      if (name === "downloads") {
        await seed(page);
        await page.reload();
        await page.waitForSelector(".tv-download-row", { timeout: 15000 }).catch(() => undefined);
      }
      await page.waitForTimeout(700);
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
      const result = await page.evaluate(overlaps);
      check(`${name} ${width}x${height} ${theme}${result.column ? "" : " (no action bar)"}`, result.hits.length === 0, result.hits.join(" | "));
      await context.close();
    }
  }
}
await finish();
