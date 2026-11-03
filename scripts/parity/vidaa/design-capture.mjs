#!/usr/bin/env node
// Design-report capture on the real Hisense VIDAA TV: every screen of design-screens.json that the TV can show, dark and light.
//   node design-capture.mjs --out <captures dir> [--themes dark,light] [--screens a,b] [--batch 8] [--resume]
// Goes through the vidaa CLI (keepalive broker, one MQTT session) and the debug-mirror receiver, like drivers/vidaa.mjs.
// Environment: PLAYARR_VIDAA_CLI, PARITY_SERVER_URL and PARITY_ACCOUNT_NAME (eval "$(node parity-config.mjs --shell)"), PLAYARR_VIDAA_FIXED_NOW.
// Memory: every route is a fresh page load, and the mirror stops after its render budget per load (PR 713); the run also pauses after each
// batch and stops at once when the TV stops answering. Writes <out>/<theme>/<id>.png (1920x1080, as the TV mirror renders it) and <out>/manifest.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDriver } from "../drivers/vidaa.mjs";
import { loadDesignScreens } from "../suite-design.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const out = resolve(opt("out", ""));
if (!opt("out")) throw new Error("--out <captures dir> is required");
const spec = loadDesignScreens();
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
const themes = opt("themes", "dark,light").split(",");
const wanted = opt("screens", "").split(",").filter(Boolean).map((id) => spec.aliases?.[id] ?? id);
const batch = Number(opt("batch", "8"));
const resume = args.includes("--resume");
const cli = process.env.PLAYARR_VIDAA_CLI;
const srv = (process.env.PARITY_SERVER_URL ?? "").replace(/\/$/, "");
if (!cli || !srv) throw new Error("PLAYARR_VIDAA_CLI and PARITY_SERVER_URL are required");

const secret = (name) => { for (const l of readFileSync(join(homedir(), ".secrets"), "utf8").split("\n")) if (l.startsWith(`${name}=`)) return l.slice(name.length + 1).trim().replace(/^["']|["']$/g, ""); throw new Error(`${name} is missing`); };
const tvState = () => execFileSync(cli, ["state"], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
const sendKey = (code) => execFileSync(cli, ["key", code, "--delay", "0.3"], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });

/** Static-server fixtures: log in once, add the playlist the frozen seed lacks (DESIGN-COMMON addendum), resolve the ids routes need. */
async function fixtures() {
  const r = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "vidaa-design", username: process.env.PARITY_ACCOUNT_NAME, password: secret("PLAYARR_PARITY_STATIC_PASSWORD") }) });
  if (!r.ok) throw new Error(`parity login ${r.status}`);
  const auth = { authorization: `Bearer ${(await r.json()).access_token}` };
  const get = async (p) => (await fetch(srv + p, { headers: auth })).json();
  const open = (id) => suite.screens.find((s) => s.id === id).open;
  const existing = await get("/api/v1/playlists");
  let list = Array.isArray(existing) ? existing : existing.items ?? existing.playlists ?? [];
  if (!list.length) {
    const c = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
    if (!c.ok) throw new Error(`create playlist ${c.status}`);
    const pl = await c.json();
    for (const w of [open("film-detail"), open("series-detail")].map((x) => x.split("/").pop()).concat(["4ec39b80-28c3-4d83-9f83-f07872e5f4c0"])) {
      const a = await fetch(`${srv}/api/v1/playlists/${pl.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: w }) });
      if (!a.ok) throw new Error(`add playlist item ${a.status}`);
    }
    list = [pl];
  }
  const artist = (await get("/api/v1/catalog?kind=artist")).items?.[0];
  const film = await get(`/api/v1/catalog/${open("film-detail").split("/").pop()}`);
  return { playlistId: list[0].id, artistId: artist?.id, mediaFileId: film.media_file_id };
}

/** Page expression for the player: hold the clip paused on its 2.000 s frame (seek while paused, never play-then-pause), wait until the seek bar shows it,
 * then either keep the controls (player-controls) or close them the way the app does for Back (Backspace, keyCode 8: player hides the overlay first). Ported from PR 661. */
const pinPlayer = (hideControls) => `(async function () {
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var v = document.querySelector("video");
  if (!v) return { held: false, why: "no video" };
  for (var i = 0; i < 80 && v.readyState < 2; i++) await wait(500);
  var ctl = function () { var c = document.querySelector(".player-controls"); return !!c && !c.classList.contains("is-hidden"); };
  var held = 0, state = null;
  for (var round = 0; round < 12 && held < 2; round++) {
    v.pause();
    if (Math.abs(v.currentTime - 2) > 0.0005) await new Promise(function (res) { v.addEventListener("seeked", res, { once: true }); v.currentTime = 2; setTimeout(res, 8000); });
    v.pause();
    if (v.requestVideoFrameCallback) await new Promise(function (res) { v.requestVideoFrameCallback(function () { res(); }); setTimeout(res, 3000); });
    var fill = document.querySelector(".player-seek-progress");
    var synced = function () { return !!fill && Math.abs(parseFloat(fill.style.width) - 100 * v.currentTime / v.duration) < 0.15; };
    for (var k = 0; k < 10 && !synced(); k++) { v.dispatchEvent(new Event("timeupdate")); await wait(400); }
    state = { paused: v.paused, t: Math.round(v.currentTime * 1000) / 1000, synced: synced(), controls: ctl() };
    held = state.paused && Math.abs(v.currentTime - 2) < 0.001 && state.synced && state.controls ? held + 1 : 0;
    await wait(700);
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (held >= 2 && ${hideControls ? "true" : "false"}) {
    var init = { key: "Backspace", code: "Backspace", keyCode: 8, which: 8, bubbles: true, cancelable: true };
    var target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", init)); target.dispatchEvent(new KeyboardEvent("keyup", init));
    for (var h = 0; h < 10 && ctl(); h++) await wait(300);
    await wait(600);
    state = { paused: v.paused, t: Math.round(v.currentTime * 1000) / 1000, synced: synced(), controls: ctl(), route: location.pathname };
  }
  return { held: held >= 2, hideControls: ${hideControls ? "true" : "false"}, state: state };
})()`;

const KEYS = (id) => suite.screens.find((s) => s.id === id)?.keys ?? [];
/** Per-id route and key steps. Throws {absent} for screens the mirror cannot show. */
function plan(s, fx) {
  if (s.absent) return { absent: s.absent };
  // Signed-out pages: the receiver's /__mirror/signedout page empties the TV page's saved sign-in (storage only; the account itself is untouched) and opens the route.
  // The driver accepts only the exact signed-out frame while this screen is captured; the run signs the parity account back in afterwards (resignIn).
  if (s.kind === "signedOut") return { route: `/__mirror/signedout?next=${encodeURIComponent(s.route)}`, signedOut: true };
  if (s.id === "search--keyboard") return { absent: "the TV search field opens the operating system's on-screen keyboard; it is not part of the page, so the debug mirror (which renders the page DOM) cannot show it" };
  let route = s.open === "suite" ? suite.screens.find((x) => x.id === s.id).open : s.route;
  if (s.id === "music-detail") route = `/music/${fx.artistId}`;
  if (s.id === "playlist-detail") route = `/playlists?playlist=${fx.playlistId}`;
  if (s.id === "search-results") route = "/search?q=the";
  if (s.id === "actions") return { route: suite.screens.find((x) => x.id === "film-detail").open, long: true, heroAction: true };
  if (s.id === "player" || s.id === "player-controls") return { route: `/player/${fx.mediaFileId}?mirrorAlwaysRender=1`, player: true, controls: s.controls };
  if (s.id === "home--focus-second-rail") return { route: "/", keys: ["down"] };
  if (s.id === "profiles--add") return { route: "/profiles", findAdd: true };
  return { route, heroAction: /^\/(?:movies|series)\/[^/]+\/?$/.test(route) };
}

const driver = await createDriver();
await driver.setDeterministicCapture({ fixedNow: process.env.PLAYARR_VIDAA_FIXED_NOW ?? "2026-10-07T12:00:00.000Z" });
const fx = await fixtures();
const screens = spec.screens.filter((s) => !wanted.length || wanted.includes(s.id));
const manifestFile = join(out, "manifest.json");
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { device: "hisense-vidaa", class: "real", screens: {} };
manifest.build = process.env.DESIGN_BUILD ?? manifest.build;
manifest.capturedAt = new Date().toISOString();
const save = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
mkdirSync(out, { recursive: true });

async function one(s, theme, file) {
  const p = plan(s, fx);
  if (p.absent) { manifest.screens[s.id] = { dark: null, light: null, absent: p.absent }; return "absent"; }
  driver.setSignedOutAllowed(!!p.signedOut);
  await driver.route(p.route);
  if (p.player) {
    // The route carries mirrorAlwaysRender so the frame that follows the pin is rendered afresh, never the picture of the ended clip.
    const { result, png } = await driver.pageJob(pinPlayer(!p.controls), { png: true });
    const st = result?.state;
    const ok = result?.held === true && st?.paused === true && Math.abs(st.t - 2) < 0.001 && st.controls === !!p.controls && (p.controls || /^\/player\//.test(st.route ?? ""));
    if (!ok) throw new Error(`player pin failed: ${JSON.stringify(result).slice(0, 200)}`);
    writeFileSync(file, png);
    if (png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080) throw new Error("player frame is not 1920x1080");
    manifest.screens[s.id] = { ...(manifest.screens[s.id] ?? {}), [theme]: `${theme}/${s.id}.png` };
    delete manifest.screens[s.id].absent;
    return "ok";
  }
  if (p.findAdd) {
    for (let i = 0; i < 10; i++) { const f = await driver.focused(); if (/add/i.test(f?.label ?? "")) break; await driver.key("right"); }
    const f = await driver.focused();
    if (!/add/i.test(f?.label ?? "")) throw new Error(`profiles--add: focus never reached the add tile (last ${JSON.stringify(f)})`);
    await driver.key("select");
  }
  if (p.heroAction) {
    // A title page lands with focus on the hero action (Play); the TV sometimes lands on a later rail. Step left/up until the focus is a hero button.
    for (let i = 0; i < 4; i++) { const f = await driver.focused(); if (/play|resume|watch/i.test(f?.label ?? "")) break; await driver.key(i % 2 ? "up" : "left"); }
    const f = await driver.focused();
    if (!/play|resume|watch/i.test(f?.label ?? "")) throw new Error(`focus is not on the hero action (${JSON.stringify(f)})`);
  }
  for (const k of p.keys ?? []) await driver.key(k);
  if (p.long) { sendKey("KEY_OK_LONG_PRESS"); await sleep(3000); }
  if (p.player) {
    // The player opens with its controls showing; a key press hides or shows them. Capture what the TV shows after the page settles.
    if (!p.controls) { await driver.key("back"); }
  }
  await driver.screenshot(file);
  const png = readFileSync(file);
  if (png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080 || png.toString("latin1", 1, 4) !== "PNG") throw new Error(`frame is not a 1920x1080 PNG (${png.readUInt32BE(16)}x${png.readUInt32BE(20)})`);
  manifest.screens[s.id] = { ...(manifest.screens[s.id] ?? {}), [theme]: `${theme}/${s.id}.png` };
  delete manifest.screens[s.id].absent;
  return "ok";
}

/** Sign the parity account back in (receiver seed page through the broker CLI), then prove a normal frame passes the full account guard. */
async function resignIn() {
  driver.setSignedOutAllowed(false);
  execFileSync(cli, ["open-debug", "--seed", "--path", "/", "--wait", "8"], { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  await driver.home(); // settled() runs the normal guard: throws unless the frame carries the allowlisted parity identity
  await driver.location();
  console.log("parity account signed back in; normal frame passed the guard");
}
let done = 0;
await driver.start({ theme: themes[0] });
for (const theme of themes) {
  mkdirSync(join(out, theme), { recursive: true });
  await driver.setTheme(theme);
  for (const s of screens) {
    const file = join(out, theme, `${s.id}.png`);
    if (resume && existsSync(file)) continue;
    if (done > 0 && done % batch === 0) { console.log(`batch pause after ${done} loads`); await sleep(30000); tvState(); }
    let result;
    for (let attempt = 1; ; attempt++) {
      try { result = await one(s, theme, file); break; }
      catch (e) {
        const msg = String(e.message).split("\n")[0];
        try { tvState(); } catch (down) { console.log(`TV UNREACHABLE after ${theme}/${s.id}: ${msg}`); save(); process.exit(3); }
        if (/memory guard|heap is|capture took/.test(msg)) { console.log(`TV HEALTH STOP at ${theme}/${s.id}: ${msg}`); save(); process.exit(4); }
        if (attempt >= 2) { result = `FAIL ${msg}`; manifest.screens[s.id] = { ...(manifest.screens[s.id] ?? {}), [theme]: null, error: msg }; break; }
        console.log(`retry ${theme}/${s.id}: ${msg}`);
      }
    }
    done++;
    console.log(`${result} ${theme} ${s.id}`);
    save();
    if (plan(s, fx).signedOut) {
      const next = screens[screens.indexOf(s) + 1];
      if (!next || !plan(next, fx).signedOut) {
        if (result !== "ok" && result !== "absent") console.log("signed-out capture failed; signing the parity account back in before anything else");
        await resignIn();
        await sleep(30000); tvState();
      }
    }
  }
}
console.log("captured");
