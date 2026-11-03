#!/usr/bin/env node
// Design-report capture of the native Tizen TV app: every screen of docs "SCREENS-ALL" the app has, both themes, plain screenshots.
//   node tizen-native/design-capture.mjs --out <captures/samsung-tizen-native> [--only home,downloads] [--themes dark,light]
// Runs under the parity account lock and canonical state like suite-run.mjs (same pinned clock, seeded deck), through the
// tizen-native driver. No layout export, no scoring. Screens the app does not have are listed in ABSENT with their evidence.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { expandKeys, pinCapture, pinnedCatalogFiles } from "../suite-lib.mjs";
import { FIXTURE_CLOCK } from "../../fixtures/catalog.mjs";
import { resolveCaptureEnvironment, withCaptureState } from "../capture-state.mjs";
import { applyCanonicalDeck } from "../canonical-deck.mjs";
import { readSecrets } from "../dpad-account.mjs";
import { createDriver } from "../drivers/tizen-native.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const out = resolve(opt("out", "captures-out"));
const themes = opt("themes", "dark,light").split(",");
const only = opt("only", "").split(",").filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.env.PARITY_NO_LAYOUT = "1"; // pictures only
process.env.PLAYARR_TIZEN_CROP ??= "1920x1080+6+35"; // the app area inside the decorated emulator window

// Screens the native app does not have: id -> evidence (file searched in clients/tizen-native/src/Playarr.Tizen).
export const ABSENT = {
  login: "no username/password sign-in: the TV app signs in by QR code only (LoginScreen.cs, web redirects TVs to /login/qr as well); captured as login-qr",
  signup: "no sign-up flow in the app (no route in Pages.cs, no screen class)",
  link: "no device link approval page: the app shows the code (login-qr) and a phone approves it; Pages.cs has no /link route",
  household: "no household screen: Pages.cs has no /household route and no screen class for it",
  sites: "no sites library: Pages.cs has no /sites route; the nav rail has no Sites item (Shell.cs)",
  "music-detail": "Music artists open no detail page: Pages.cs routes only /movies/:id and /series/:id (Guid) to detail screens",
  "episode-detail": "episodes are rows of the series detail page (SeriesDetailScreen.cs); there is no separate episode page, same view as series-detail",
  folders: "no folders screen: Pages.cs has no /folders route",
  "settings-profile-avatar": "SettingsScreen.cs: only Appearance and Player open a panel; the other options show a toast 'not available in this app yet'",
  "settings-language": "SettingsScreen.cs: option shows a toast 'not available in this app yet' (no panel)",
  "settings-server": "SettingsScreen.cs: option shows a toast 'not available in this app yet' (no panel)",
  "settings-profile-lock": "SettingsScreen.cs: option shows a toast 'not available in this app yet' (no panel)",
  "settings-invite": "SettingsScreen.cs: option shows a toast 'not available in this app yet' (no panel)",
  "settings-request-latency": "no Request latency option in SettingsScreen.cs (Options list has ten entries, none of them request latency)",
  "settings-remote": "SettingsScreen.cs: Phone remote shows a toast 'not available in this app yet' (no panel)",
  "settings-your-data": "SettingsScreen.cs: option shows a toast 'not available in this app yet' (no panel)",
  "settings-home": "SettingsScreen.cs: Customise Home shows a toast 'not available in this app yet' (no panel)",
  "search--keyboard": "Search screen has no on-screen keyboard: typing goes through the TV IME and nothing is drawn in the app (screenshot of the focused field shows no keyboard)",
  "not-found": "Pages.Create returns null for an unknown route and Shell.Navigate keeps the current page; there is no not-found screen",
  "profiles--add": "ProfilesScreen.cs: the add tile ('sign in, add another profile') calls SignOut and lands on the QR sign-in screen (login-qr); there is no add-profile form",
};

// Navigation per screen. keys = D-pad presses from Home; route = deep link; after = extra steps once there.
const NEW = {
  downloads: { route: "/downloads" },
  playlists: { route: "/playlists" },
  "playlist-detail": { route: "/playlists", keys: ["select"] },
  watchlist: { route: "/watchlist", note: "UnavailableScreen placeholder: the app says the section is not available in this app yet" },
  requests: { route: "/requests", note: "UnavailableScreen placeholder: the app says the section is not available in this app yet" },
  "search-results": { route: "/search", text: "the" },
  "settings-appearance": { route: "/settings" },
  "settings-player": { route: "/settings", keys: ["down*2", "left", "down*2", "select"] },
  player: { player: true, from: "player-controls" },
  "home--focus-second-rail": { route: "/", keys: ["down"] },
};

const steps = [];
for (const s of suite.screens) steps.push({ id: s.id, ...(s.open ? { route: s.open } : { route: "/", keys: s.keys }) });
for (const [id, v] of Object.entries(NEW)) steps.push({ id, ...(v.from ? { keys: suite.screens.find((x) => x.id === v.from).keys, route: "/" } : {}), ...v });
const wanted = steps.filter((s) => !only.length || only.includes(s.id));

async function run(snapshot) {
  const driver = await createDriver({ out, args });
  const fixedNow = process.env.PARITY_FIXED_NOW ?? FIXTURE_CLOCK;
  await pinCapture(driver, { fixedNow, explicit: true });
  await driver.start({ theme: themes[0] });
  const identity = await driver.captureBuildIdentity();
  const press = async (keys) => { for (const { key, long } of expandKeys(keys)) await driver.key(key, { long }); };
  const take = (file) => execFileSync("import", ["-window", process.env.PLAYARR_TIZEN_WINDOW ?? "root", "-crop", process.env.PLAYARR_TIZEN_CROP, "+repage", file], { env: { ...process.env, DISPLAY: process.env.PLAYARR_TIZEN_DISPLAY ?? ":25" } });
  const post = (p, body) => fetch(`http://127.0.0.1:${process.env.PLAYARR_TIZEN_FORWARD ?? 18890}${p}`, { method: "POST", body: body ?? "" }).then((r) => r.json());
  const get = (p) => fetch(`http://127.0.0.1:${process.env.PLAYARR_TIZEN_FORWARD ?? 18890}${p}`).then((r) => r.json());
  const results = {};
  for (const theme of themes) {
    await driver.setTheme(theme);
    mkdirSync(join(out, theme), { recursive: true });
    for (const s of wanted) {
      const file = join(out, theme, `${s.id}.png`);
      try {
        await driver.home();
        if (s.player) {
          // the player route of the first catalogue film, clip paused at 2 s, controls hidden (Back hides them first, as on web)
          await press(s.keys);
          if (!(await get("/state")).route.startsWith("/player/")) throw new Error("player route not reached");
          await driver.pausePlayerAtTwoSeconds();
          if ((await get("/state")).controls) await driver.key("back");
          const st = await get("/state");
          if (st.controls) throw new Error("player controls still visible");
          if (st.playing) throw new Error("player not paused");
          await sleep(1500);
          take(file);
        } else {
          if (s.route && s.route !== "/") await driver.route(s.route);
          if (s.keys) await press(s.keys);
          if (s.text) { await post(`/text?value=${encodeURIComponent(s.text)}`); await driver.settle(3000); }
          await driver.screenshot(file);
        }
        results[s.id] ??= {}; results[s.id][theme] = `${theme}/${s.id}.png`;
        console.log(`ok ${theme} ${s.id}`);
      } catch (e) { console.log(`FAIL ${theme} ${s.id}: ${String(e.message).split("\n")[0]}`); results[s.id] ??= {}; results[s.id][theme] = null; }
    }
  }
  writeFileSync(join(out, ".run-results.json"), JSON.stringify({ identity, results }, null, 2));
  await driver.stop?.();
}

if (!existsSync(out)) mkdirSync(out, { recursive: true });
process.env.PARITY_SEED_CANONICAL ??= "1";
const captureEnv = resolveCaptureEnvironment(process.env.PARITY_CLIENT ?? "tizen-native");
const catalogFiles = await pinnedCatalogFiles(suite, captureEnv, { required: true });
const stateFiles = [...new Set([...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file), ...catalogFiles])];
await withCaptureState({ client: "tizen-native", files: stateFiles, env: captureEnv }, async (context) => {
  Object.assign(process.env, context.env);
  const seeded = await applyCanonicalDeck(context, process.env, readSecrets());
  if (!seeded) await context.clearResumeChoices();
  // Fixture the frozen seed lacks (design-report addendum): one playlist of pinned titles, created through the API on the throw-away DB copy.
  const srv = context.env.PLAYARR_SERVER_URL.replace(/\/$/, "");
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: context.env.PLAYARR_USERNAME, password: context.env.PLAYARR_PASSWORD }) });
  if (!lr.ok) throw new Error(`login ${lr.status}`);
  const auth = { authorization: `Bearer ${(await lr.json()).access_token}` };
  const existing = await (await fetch(`${srv}/api/v1/playlists`, { headers: auth })).json();
  if (!(Array.isArray(existing) ? existing : existing.items ?? existing.playlists ?? []).length) {
    const created = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
    if (!created.ok) throw new Error(`create playlist ${created.status}`);
    const playlist = await created.json();
    for (const workId of ["film-detail", "series-detail"].map((id) => suite.screens.find((x) => x.id === id).open.split("/").pop()).concat(["4ec39b80-28c3-4d83-9f83-f07872e5f4c0"])) {
      const added = await fetch(`${srv}/api/v1/playlists/${playlist.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: workId }) });
      if (!added.ok) throw new Error(`add playlist item ${added.status}`);
    }
  }
  await run(seeded ?? await context.snapshotNow());
});
