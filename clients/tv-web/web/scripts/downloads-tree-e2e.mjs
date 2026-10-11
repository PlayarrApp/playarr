#!/usr/bin/env node
// Downloads (owner 2026-10-11): TV shows are grouped series, then season, then episode, every level has Pause/Resume,
// Edit, Cancel and Delete acting on everything inside it, with the totals at each level; movies and music stay flat; the
// page has a Filters drawer (type, status, sort). Checked at the TV size and at 390px, by touch and by D-pad.
//   node scripts/downloads-tree-e2e.mjs [--no-build] [--dist dir]
import { boot, USER_ID } from "./e2e-common.mjs";

const { check, open, finish, base } = await boot({ canDownload: true }, { realisticAuth: true });

const T = (n) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();
function rec(id, over) {
  return {
    id, workId: "w-movie", workKind: "movie", mediaFileId: `m-${id}`, userId: USER_ID, serverUrl: base, title: id, subtitle: null,
    qualityId: "q", qualityLabel: "1080p", container: "mp4", totalBytes: 1_000_000, bytesDownloaded: 1_000_000, lastCompletedByteOffset: 0,
    status: "ready", keepUntil: { type: "forever" }, watchedAt: null, errorMessage: null, requestedAt: T(0), readyAt: T(1), storage: "idb-blob",
    runtimeMs: 1000, mimeType: "video/mp4", ...over,
  };
}
const ep = (id, workId, series, season, episode, over) =>
  rec(id, { workId, workKind: "series", title: `Pilot ${id}`, subtitle: `${series} · S${String(season).padStart(2, "0")} · E${String(episode).padStart(2, "0")}`, seriesTitle: series, seasonNumber: season, episodeNumber: episode, requestedAt: T(episode + season * 10), ...over });
const SEED = [
  ep("a11", "s1", "Alpha Show", 1, 1),
  ep("a12", "s1", "Alpha Show", 1, 2, { status: "paused", bytesDownloaded: 400_000 }),
  ep("a21", "s1", "Alpha Show", 2, 1, { status: "processing", bytesDownloaded: 0, storage: null, totalBytes: null }),
  ep("a22", "s1", "Alpha Show", 2, 2, { status: "failed", bytesDownloaded: 0, errorMessage: "nope" }),
  ep("b11", "s2", "Beta Show", 1, 1),
  rec("Film One", { requestedAt: T(50) }),
  rec("Film Two", { status: "failed", bytesDownloaded: 0, errorMessage: "broken", requestedAt: T(51) }),
  rec("Track One", { workKind: "artist", workId: "ar1", requestedAt: T(52) }),
];

async function seed(page) {
  await page.evaluate(async (rows) => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("playarr-downloads", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("downloads")) {
          const store = db.createObjectStore("downloads", { keyPath: "id" });
          store.createIndex("byUserId", "userId", { unique: false });
          store.createIndex("byStatus", "status", { unique: false });
        }
        if (!db.objectStoreNames.contains("downloadChunks")) db.createObjectStore("downloadChunks", { keyPath: "key" }).createIndex("byDownloadId", "downloadId", { unique: false });
        if (!db.objectStoreNames.contains("watchMutations")) db.createObjectStore("watchMutations", { keyPath: "id" }).createIndex("byUserId", "userId", { unique: false });
      };
      open.onsuccess = () => {
        const tx = open.result.transaction("downloads", "readwrite");
        const store = tx.objectStore("downloads");
        store.clear();
        for (const row of rows) store.put(row);
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, SEED);
}

const dbRows = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("playarr-downloads", 1);
        open.onsuccess = () => {
          const req = open.result.transaction("downloads").objectStore("downloads").getAll();
          req.onsuccess = () => { open.result.close(); resolve(Object.fromEntries(req.result.map((r) => [r.id, r.status]))); };
        };
      })
  );

const rowTitles = (page) => page.evaluate(() => [...document.querySelectorAll(".tv-download-row")].map((r) => (r.querySelector("strong")?.textContent ?? "").replace(/^[▸▾]/, "").trim()));
const groupRow = (page, title) => page.locator(".tv-download-group-row", { has: page.locator("strong", { hasText: title }) }).first();

for (const [width, height, label] of [[1920, 1080, "TV"], [390, 844, "390px"]]) {
  const { context, page } = await open("/downloads", { width, height, theme: "dark" });
  await seed(page);
  await page.reload();
  await page.waitForSelector(".tv-download-row", { timeout: 15000 });
  await page.waitForTimeout(1200);
  const tag = (s) => `${label}: ${s}`;

  // Grouping: series rows (collapsed), movies and music flat, no episode listed flat.
  let titles = await rowTitles(page);
  check(tag("two series groups, collapsed"), titles.includes("Alpha Show") && titles.includes("Beta Show") && !titles.some((x) => x.startsWith("Pilot")) && !titles.some((x) => x.startsWith("E0")), titles.join(" | "));
  check(tag("movies and music stay flat"), ["Film One", "Film Two", "Track One"].every((x) => titles.includes(x)), titles.join(" | "));

  // Totals at the series level: the size line shows downloaded of total while something is in flight.
  const seriesText = await groupRow(page, "Alpha Show").innerText();
  check(tag("series row shows seasons, episodes and the aggregate size"), /2 seasons/.test(seriesText) && /4 episodes/.test(seriesText) && /of/.test(seriesText), seriesText.replace(/\n/g, " "));

  // Each level has the four controls.
  const buttonsOf = async (row) => (await row.locator(".tv-download-row-actions button").allInnerTexts()).map((x) => x.trim());
  let buttons = await buttonsOf(groupRow(page, "Alpha Show"));
  check(tag("series row has Pause, Edit, Cancel, Delete"), ["Pause", "Edit", "Cancel", "Delete"].every((x) => buttons.includes(x)), buttons.join(","));

  // Expand series, then season 1 and season 2.
  await groupRow(page, "Alpha Show").locator(".tv-download-group-toggle").click();
  await page.waitForTimeout(300);
  titles = await rowTitles(page);
  check(tag("expanding a series shows its seasons"), titles.includes("Season 1") && titles.includes("Season 2"), titles.join(" | "));
  buttons = await buttonsOf(groupRow(page, "Season 2"));
  check(tag("season row has Pause, Edit, Cancel, Delete"), ["Pause", "Edit", "Cancel", "Delete"].every((x) => buttons.includes(x)), buttons.join(","));
  await groupRow(page, "Season 1").locator(".tv-download-group-toggle").click();
  await groupRow(page, "Season 2").locator(".tv-download-group-toggle").click();
  await page.waitForTimeout(300);
  titles = await rowTitles(page);
  check(tag("expanding a season shows its episodes in order"), titles.indexOf("E01 · Pilot a11") >= 0 && titles.indexOf("E01 · Pilot a11") < titles.indexOf("E02 · Pilot a12") && titles.includes("E02 · Pilot a22"), titles.join(" | "));
  const epRow = page.locator(".tv-download-row:not(.tv-download-group-row)", { has: page.locator("strong", { hasText: "E02 · Pilot a12" }) });
  buttons = await buttonsOf(epRow);
  check(tag("episode row has Resume (paused), Edit, Cancel, Delete"), ["Resume", "Edit", "Cancel", "Delete"].every((x) => buttons.includes(x)), buttons.join(","));

  // 390px: nothing runs off the right edge.
  if (width < 600) {
    const off = await page.evaluate(() => [...document.querySelectorAll(".tv-download-row, .tv-download-row-actions button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).length);
    check(tag("no row or control runs off the right edge"), off === 0, `${off} elements`);
  }

  // A season-level Pause pauses what is running inside it; Resume continues it.
  await groupRow(page, "Season 2").locator(".tv-download-row-actions button", { hasText: "Pause" }).click();
  await page.waitForTimeout(600);
  let rows = await dbRows(page);
  check(tag("season Pause paused the running episode"), rows.a21 === "paused" && rows.a11 === "ready", JSON.stringify(rows));
  await groupRow(page, "Season 2").locator(".tv-download-row-actions button", { hasText: "Resume" }).click();
  await page.waitForTimeout(600);
  rows = await dbRows(page);
  check(tag("season Resume continued it"), rows.a21 !== "paused", JSON.stringify(rows));

  // Series-level Delete asks first, then removes every episode in it and nothing else.
  await groupRow(page, "Alpha Show").locator(".tv-download-row-actions button", { hasText: "Delete" }).click();
  await page.waitForSelector(".download-quality-drawer", { timeout: 5000 });
  const confirmText = await page.locator(".download-quality-drawer").innerText();
  check(tag("deleting a series asks first, naming how many"), /Delete Alpha Show\?/.test(confirmText) && /4 downloaded items/.test(confirmText), confirmText.replace(/\n/g, " "));
  await page.locator(".download-quality-drawer .is-primary").click();
  await page.waitForTimeout(1200);
  rows = await dbRows(page);
  check(tag("series Delete removed all its episodes only"), !("a11" in rows) && !("a12" in rows) && !("a21" in rows) && !("a22" in rows) && "b11" in rows && "Film One" in rows, JSON.stringify(rows));

  // Filters: Type TV leaves only the series; Status Failed leaves the failed movie.
  await page.getByRole("button", { name: /filters/i }).first().click();
  await page.waitForSelector("#downloads-filters", { timeout: 5000 });
  await page.locator("#downloads-filters").getByRole("button", { name: "TV", exact: true }).click();
  await page.waitForTimeout(400);
  titles = await rowTitles(page);
  check(tag("Filters: type TV leaves the series only"), titles.includes("Beta Show") && !titles.includes("Film One") && !titles.includes("Track One"), titles.join(" | "));
  await page.locator("#downloads-filters").getByRole("button", { name: "All", exact: true }).first().click();
  await page.locator("#downloads-filters").getByRole("button", { name: "Music", exact: true }).click();
  await page.waitForTimeout(400);
  titles = await rowTitles(page);
  check(tag("Filters: type Music leaves the track"), titles.length === 1 && titles[0] === "Track One", titles.join(" | "));
  await page.locator("#downloads-filters").getByRole("button", { name: "All", exact: true }).first().click();
  const status = page.locator("#downloads-filters .ui-select, #downloads-filters [role=combobox]").first();
  await status.click();
  await page.getByRole("option", { name: "Failed" }).click();
  await page.waitForTimeout(400);
  titles = await rowTitles(page);
  check(tag("Filters: status Failed leaves the failed film"), titles.includes("Film Two") && !titles.includes("Film One"), titles.join(" | "));

  // D-pad: Enter on a group toggles it; Right moves from the row text to its controls.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await context.close();
}

{
  // Keyboard (D-pad) at the TV size on a fresh page.
  const { context, page } = await open("/downloads", { width: 1920, height: 1080, theme: "dark" });
  await seed(page);
  await page.reload();
  await page.waitForSelector(".tv-download-group-toggle", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.locator(".tv-download-group-toggle").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const expanded = await page.locator(".tv-download-group-toggle").first().getAttribute("aria-expanded");
  check("D-pad: Enter on a series row expands it", expanded === "true", String(expanded));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const onControl = await page.evaluate(() => document.activeElement?.closest(".tv-download-row-actions") !== null);
  check("D-pad: Right moves from the series row to its controls", onControl);
  await context.close();
}

await finish();
