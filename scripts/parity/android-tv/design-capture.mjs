// Design-report capture for the screens beyond the 15 parity screens (Android TV, native app).
//   node design-capture.mjs <out-dir> <dark|light> [screen-id ...]
// Writes <out-dir>/<theme>/<screen>.png straight from the emulator (adb screencap). Uses the parity driver for launch, theme,
// pinned clock/zone/locale and D-pad keys; every screen is a debug-build route plus D-pad steps, no taps. Lane-local: the shared
// suite and screen list are untouched. Needs the same setup as run.sh (signed-in debug APK, static parity server).
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createDriver } from "../drivers/android-tv.mjs";

const [outArg, theme, ...only] = process.argv.slice(2);
if (!outArg || !["dark", "light"].includes(theme)) { console.error("usage: design-capture.mjs <out-dir> <dark|light> [screen ...]"); process.exit(2); }
const out = resolve(outArg, theme);
mkdirSync(out, { recursive: true });
const adbBin = process.env.ANDROID_HOME ? `${process.env.ANDROID_HOME}/platform-tools/adb` : "adb";
const adb = (...a) => execFileSync(adbBin, a, { encoding: "utf8", timeout: 30_000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const downN = (n) => Array.from({ length: n }, () => "down");

// id: [app route, D-pad steps after the route settled]
const settingsRow = (n) => ["settings", downN(n)];
const SCREENS = {
  sites: ["sites", []],
  "music-detail": ["music", ["select"]],
  "search-results": ["search", ["type:the"]],
  "home--focus-second-rail": ["home", ["down"]],
  "profiles--add": ["profiles", ["right"]],
  // The pinned film played through the player route; the debug build pauses at 0:02, and the controls auto-hide while we wait.
  player: ["player/FILE", ["wait:20000"]],
  "search--keyboard": ["search", ["select"]],
  watchlist: ["watchlist", []],
  requests: ["requests", []],
  playlists: ["playlists", ["down", "down"]],
  "playlist-detail": ["playlists", ["down", "down", "select"]],
  folders: ["folders", []],
  downloads: ["downloads", []],
  "settings-appearance": settingsRow(0),
  "settings-profile-avatar": settingsRow(1),
  "settings-language": settingsRow(2),
  "settings-player": settingsRow(3),
  "settings-server": settingsRow(4),
  "settings-profile-lock": settingsRow(5),
  "settings-invite": settingsRow(6),
  "settings-remote": settingsRow(7),
  "settings-your-data": settingsRow(8),
  "settings-home": settingsRow(9),
};
// Media file of the pinned film (the web refs open the same one), looked up through the API as the parity account.
async function pinnedFile() {
  const { readSecrets } = await import("../dpad-account.mjs");
  const suite = JSON.parse((await import("node:fs")).readFileSync(new URL("../suite.json", import.meta.url), "utf8"));
  const srv = process.env.PARITY_SERVER_URL.replace(/\/$/, "");
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: process.env.PARITY_ACCOUNT_NAME, password: readSecrets().PLAYARR_PARITY_STATIC_PASSWORD }) });
  const token = (await lr.json()).access_token;
  const film = await (await fetch(`${srv}/api/v1/catalog/${suite.screens.find((x) => x.id === "film-detail").open.split("/").pop()}`, { headers: { authorization: `Bearer ${token}` } })).json();
  return film.media_file_id;
}
const ids = only.length ? only : Object.keys(SCREENS);

const driver = createDriver({ readinessTimeoutMs: Number(process.env.PARITY_READINESS_TIMEOUT_MS ?? 120_000) });
await driver.setDeterministicCapture({ fixedNow: process.env.PARITY_CLOCK ?? "2026-10-07T12:00:00Z", disableAnimations: true, timeZone: "UTC", locale: "en-GB" });
await driver.start();
await driver.setTheme(theme);
const failed = [];
for (const id of ids) {
  const spec = SCREENS[id];
  if (!spec) { console.error(`unknown screen ${id}`); failed.push(id); continue; }
  let [route, keys] = spec;
  if (route === "player/FILE") route = "player/" + await pinnedFile();
  try {
    // A screen with nothing focusable (an empty list) never settles focus: the app is already launched, so capture it as it is.
    try { await driver.route("/" + route); } catch (e) { if (!/no stable accessibility focus/.test(e.message)) throw e; console.log(`note ${id}: no focusable node, captured unfocused`); }
    for (const k of keys) {
      if (k.startsWith("wait:")) await sleep(Number(k.slice(5)));
      else if (k.startsWith("type:")) { adb("shell", "input", "text", k.slice(5)); await sleep(3000); } else await driver.key(k);
    }
    await sleep(Number(process.env.DESIGN_SETTLE_MS ?? 4000));
    // Two identical frames in a row (artwork loaded, no focus animation left).
    let prev = null, shot = null;
    for (let i = 0; i < 12; i++) {
      shot = execFileSync(adbBin, ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20, timeout: 30_000 });
      if (prev && prev.equals(shot)) break;
      prev = shot; await sleep(1200);
    }
    writeFileSync(`${out}/${id}.png`, shot);
    console.log(`ok ${theme}/${id}`);
  } catch (e) { console.error(`FAIL ${theme}/${id}: ${String(e.message).split("\n")[0]}`); failed.push(id); }
}
await driver.stop?.();
process.exit(failed.length ? 1 : 0);
