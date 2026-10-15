#!/usr/bin/env node
// Music player (owner report 2026-10-15): with a track playing the controls sit inside the viewport under the
// coverflow, currentTime advances, and no mini player is drawn on the active music page. A stalled or failing
// stream shows a visible error with Retry instead of sitting silent, and Retry starts it.
//
//   node scripts/music-controls-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ artists: 3, artistAlbums: 3 });

// 30 s of silent 8 kHz 8-bit mono WAV.
const WAV = (() => {
  const n = 8000 * 30;
  const b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
})();
const stream = (route) => route.fulfill({ status: 200, body: WAV, headers: { "content-type": "audio/wav", "accept-ranges": "bytes" } });
const negotiate = (route) => {
  const url = new URL(route.request().url());
  if (/\/progress$/.test(url.pathname) || !/^\/api\/v1\/playback\/[^/]+$/.test(url.pathname)) return route.fallback();
  return route.fulfill({
    json: {
      mode: "direct", url: "/mock-audio.wav", mime_type: "audio/wav", session_id: "00000000-0000-4000-8000-0000000000aa",
      selected_quality_id: "original", quality_options: [], audio_tracks: [], subtitle_tracks: [], duration_ms: 30_000, source_offset_ms: 0,
    },
  });
};

// The service worker would answer the media request before page.route sees it.
const SW = { serviceWorkers: "block" };

async function playFirstTrack(page) {
  await page.waitForSelector("a[href^='/music/']");
  await page.locator("a[href^='/music/']").first().click();
  await page.waitForSelector("button[aria-label^='Play']");
  await page.locator("button[aria-label^='Play']").first().click({ force: true });
}
// The player clock in seconds (the engine position the UI shows); on a phone the element is re-parented into the page flow.
const clock = () => { const t = /(\d+):(\d+)/.exec(document.querySelector(".player-time")?.textContent ?? ""); return t ? Number(t[1]) * 60 + Number(t[2]) : -1; };
const PLAYING = () => { const t = /(\d+):(\d+)/.exec(document.querySelector(".player-time")?.textContent ?? ""); return t ? Number(t[1]) * 60 + Number(t[2]) >= 1 : false; };
const audioTime = (page) => page.evaluate(clock);

for (const [width, height, theme] of [[1920, 1080, "dark"], [1920, 1080, "light"], [1366, 768, "dark"], [390, 844, "dark"]]) {
  const label = `${width}x${height} ${theme}`;
  const { context, page } = await open("/music", { width, height, theme, contextOptions: { ...SW, colorScheme: theme } });
  await page.route(/\/api\/v1\/playback\//, negotiate);
  await page.route(/mock-audio\.wav/, stream);
  await playFirstTrack(page);
  await page.waitForFunction(PLAYING, null, { timeout: 15000 }).catch(() => {});
  const t0 = await audioTime(page);
  await page.waitForTimeout(2300);
  const t1 = await audioTime(page);
  check(`${label}: the track plays (currentTime advances)`, t1 > t0 && t0 >= 0, `${t0} -> ${t1}`);
  const geo = await page.evaluate(() => {
    const controls = document.querySelector(".player-shell-inline-music .player-controls")?.getBoundingClientRect();
    const flow = document.querySelector(".tv-music-album-cover-flow")?.getBoundingClientRect();
    return { controls: controls && { top: controls.top, bottom: controls.bottom, left: controls.left, right: controls.right, height: controls.height }, flowBottom: flow?.bottom, vw: innerWidth, vh: innerHeight };
  });
  const c = geo.controls;
  check(`${label}: the controls are inside the viewport`, Boolean(c) && c.height > 0 && c.top >= 0 && c.bottom <= geo.vh && c.left >= 0 && c.right <= geo.vw, JSON.stringify(geo));
  check(`${label}: the controls sit under the coverflow`, Boolean(c) && geo.flowBottom !== undefined && c.top >= geo.flowBottom - 1, JSON.stringify(geo));
  const mini = await page.locator(".mini-player-hit-target, .player-inline-music-mini").count();
  check(`${label}: no mini player on the active music page`, mini === 0, `count ${mini}`);
  await context.close();
}

// Away from the active music page the mini player stays.
{
  const { context, page } = await open("/music", { width: 1920, height: 1080, contextOptions: SW });
  await page.route(/\/api\/v1\/playback\//, negotiate);
  await page.route(/mock-audio\.wav/, stream);
  await playFirstTrack(page);
  await page.waitForFunction(PLAYING, null, { timeout: 15000 }).catch(() => {});
  await page.locator("[data-navigation-focus-key='nav:movies'], a[href='/movies']").first().click({ force: true });
  await page.waitForTimeout(1200);
  check("playing, away from the music page: the mini player is drawn", (await page.locator(".mini-player-hit-target").count()) === 1);
  await context.close();
}

// A stream that never answers: after the stall notice the user sees an error and Retry; Retry plays.
{
  const { context, page } = await open("/music", { width: 1920, height: 1080, contextOptions: SW });
  await page.route(/\/api\/v1\/playback\//, negotiate);
  let hang = true;
  await page.route(/mock-audio\.wav/, (route) => (hang ? new Promise(() => {}) : stream(route)));
  await playFirstTrack(page);
  const alert = page.locator(".player-inline-music-status[role='alert']");
  await alert.waitFor({ timeout: 25000 }).catch(() => {});
  check("stalled stream: an error with Retry is shown", (await alert.count()) === 1 && (await alert.getByRole("button").count()) === 1);
  hang = false;
  await alert.getByRole("button").click().catch(() => {});
  await page.waitForFunction(PLAYING, null, { timeout: 15000 }).catch(() => {});
  check("stalled stream: Retry starts playback", (await audioTime(page)) > 0, String(await audioTime(page)));
  await context.close();
}

// The stream request fails outright (as in a redeploy): the same visible state.
{
  const { context, page } = await open("/music", { width: 1920, height: 1080, contextOptions: SW });
  await page.route(/\/api\/v1\/playback\//, negotiate);
  let fail = true;
  let hits = 0;
  await page.route(/mock-audio\.wav/, (route) => { hits += 1; return fail ? route.fulfill({ status: 503, body: "unavailable" }) : stream(route); });
  await playFirstTrack(page);
  const alert = page.locator(".player-inline-music-status[role='alert']");
  // A 503 surfaces as MEDIA_ERR_SRC_NOT_SUPPORTED, which the player treats as a decode failure and answers once with a
  // silent forced-transcode renegotiation: a second stream request. Retry only after that one has failed as well, or
  // it races the automatic attempt (and the alert is briefly gone while the attempt loads).
  for (let waited = 0; waited < 25000 && hits < 2; waited += 100) await page.waitForTimeout(100);
  await alert.waitFor({ timeout: 25000 }).catch(() => {});
  check("failing stream: an error with Retry is shown", (await alert.count()) === 1 && (await alert.getByRole("button").count()) === 1);
  fail = false;
  await alert.getByRole("button").click().catch(() => {});
  await page.waitForFunction(PLAYING, null, { timeout: 15000 }).catch(() => {});
  await page.locator(".player-shell-inline-music .player-controls").waitFor({ timeout: 15000 }).catch(() => {});
  check("failing stream: Retry brings the controls back", (await alert.count()) === 0 && (await page.locator(".player-shell-inline-music .player-controls").count()) === 1);
  await page.waitForFunction(PLAYING, null, { timeout: 15000 }).catch(() => {});
  check("failing stream: after Retry the track plays", (await audioTime(page)) >= 1, String(await audioTime(page)));
  await context.close();
}

await finish();
