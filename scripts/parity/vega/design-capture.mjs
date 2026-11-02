#!/usr/bin/env node
// Design report capture of every Fire TV (Vega OS) screen, dark and light, on the Vega virtual device against the static parity server.
//   node scripts/parity/vega/design-capture.mjs <out-dir> [--screens a,b] [--themes dark,light]
// Writes <out-dir>/<theme>/<screen>.png and <out-dir>/manifest.json (docs: design-report/SCREENS-ALL.md). Needs the same setup as run.sh
// (app built with PLAYARR_PARITY_CONTROL=1, device signed in to the static server's parity account, env of drivers/firetv.mjs).
// Same pinning as suite-run.mjs: fixture clock, canonical On deck, isolated account state under the capture lock.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const parity = join(here, "..");
const imp = (f) => import(pathToFileURL(join(parity, f)).href);
const { pinnedCatalogFiles, pinCapture, routeMatches } = await imp("suite-lib.mjs");
const { resolveCaptureEnvironment, withCaptureState } = await imp("capture-state.mjs");
const { applyCanonicalDeck } = await imp("canonical-deck.mjs");
const { readSecrets } = await imp("dpad-account.mjs");
const { FIXTURE_CLOCK } = await import(pathToFileURL(join(parity, "..", "fixtures", "catalog.mjs")).href);

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const out = resolve(args.find((a) => !a.startsWith("--")) ?? "design-out");
const themes = opt("themes", "dark,light").split(",");
const want = opt("screens", "").split(",").filter(Boolean);
const suite = JSON.parse(readFileSync(join(parity, "suite.json"), "utf8"));
const suiteScreen = (id) => suite.screens.find((s) => s.id === id);
const FIRST_ARTIST = "bfcdc905-c5b9-52fd-ab24-d4ab0f735088"; // first artist of the seeded catalogue (GET /api/v1/catalog?kind=artist&sort=title)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// kind "suite": the shared suite entry (route, or pinned `open` title); "route": a web path; "special": a function.
const SCREENS = [
  ...["home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "actions"].map((id) => ({ id, kind: "suite" })),
  { id: "player-controls", kind: "player", raise: true },
  { id: "player", kind: "player", raise: false },
  { id: "link", kind: "route", path: "/link", expect: /^\/link/ },
  { id: "downloads", kind: "route", path: "/downloads", expect: /^\/downloads/ },
  { id: "sites", kind: "route", path: "/sites", expect: /^\/sites/ },
  { id: "music-detail", kind: "route", path: `/music/${FIRST_ARTIST}`, expect: /^\/musicdetail/ },
  { id: "search-results", kind: "route", path: "/search?q=the", expect: /^\/search/, dismissKeyboard: true },
  { id: "watchlist", kind: "route", path: "/watchlist", expect: /^\/watchlist/ },
  { id: "requests", kind: "route", path: "/requests", expect: /^\/requests/ },
  { id: "playlists", kind: "route", path: "/playlists", expect: /^\/playlists/ },
  ...["appearance", "profile-avatar", "language", "player", "server", "profile-lock", "invite", "request-latency", "remote", "your-data", "home"].map((s) => ({ id: `settings-${s}`, kind: "route", path: `/settings/${s}`, expect: /^\/settings/ })),
  { id: "not-found", kind: "route", path: "/does-not-exist", expect: /^\/notfound/ },
  { id: "home--focus-second-rail", kind: "home-down" },
  { id: "search--keyboard", kind: "keyboard" },
];

const ABSENT = {
  login: "The Fire TV app has no password sign-in: its only signed-out screen is Link (QR and code), captured as `link`. Searched clients/fire-tv/src/navigation/routes.ts (ROUTES has link and profiles, no login) and clients/fire-tv/src/screens (LinkScreen.tsx only).",
  "login-qr": "No separate QR sign-in screen: the QR code is part of LinkScreen (`link`). clients/fire-tv/src/navigation/routes.ts has no login or qr route.",
  signup: "No sign-up screen in the Fire TV app: accounts are created on the web and the device is linked with a code. clients/fire-tv/src/navigation/routes.ts has no signup route.",
  household: "No routed household page: clients/fire-tv/src/navigation/AppShellNavigator.tsx shows HouseholdBlockedScreen only as an overlay while the server reports a household block (GET /api/v1/household/status). The seeded parity account is never blocked, so the overlay cannot be reached without faking the server answer.",
  "episode-detail": "Same screen as series-detail: WorkDetailScreen lists the episodes inline (clients/fire-tv/src/screens/WorkDetailScreen.tsx); ROUTES has no episode route.",
  "playlist-detail": "The seeded parity catalogue has no playlists (GET /api/v1/playlists returns []), so there is no first playlist to open; the Playlists screen is captured as `playlists`.",
  folders: "No Folders screen in the Fire TV app: clients/fire-tv/src/navigation/routes.ts has no folders route and AppShellNavigator.tsx registers none.",
  "profiles--add": "The Add profile tile on the Fire TV profile picker navigates to the Link screen (ProfilesScreen AddProfileTile, ROUTES.link), captured as `link`; there is no add-profile form.",
};

mkdirSync(out, { recursive: true });
const manifestPath = join(out, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { screens: {} };
const installed = (() => { try { return JSON.parse(readFileSync(process.env.PLAYARR_FIREFTV_BUILD_INFO ?? process.env.PLAYARR_FIRETV_BUILD_INFO, "utf8")); } catch { return {}; } })();
manifest.device = "fire-tv-vega";
manifest.class = "emulated";
manifest.build = installed.sha ?? execFileSync("git", ["-C", here, "rev-parse", "--short", "HEAD"]).toString().trim();
manifest.capturedAt = new Date().toISOString();
for (const [id, reason] of Object.entries(ABSENT)) manifest.screens[id] = { dark: null, light: null, absent: reason };
const save = () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
save();

const fixedNow = process.env.PARITY_FIXED_NOW ?? FIXTURE_CLOCK;
const selected = SCREENS.filter((s) => !want.length || want.includes(s.id));

async function run() {
  const driver = await (await import(pathToFileURL(join(parity, "drivers", "firetv.mjs")).href)).createDriver({ out });
  await pinCapture(driver, { fixedNow, explicit: true });
  await driver.start({ theme: themes[0] });
  async function reach(s) {
    await driver.home();
    if (s.kind === "suite") {
      const e = suiteScreen(s.id);
      if (e.open) await driver.route(e.open, { screenId: s.id });
      else await driver.route(e.route, { screenId: s.id });
      const at = await driver.location();
      if (!routeMatches(e.match ?? e.route, at)) throw new Error(`${s.id}: ended on ${at}, expected ${e.route}`);
    } else if (s.kind === "player") {
      await driver.playerControls({ raise: s.raise });
    } else if (s.kind === "route") {
      await driver.route(s.path, { screenId: s.id });
      if (s.dismissKeyboard) { await driver.raw.press("Escape"); await sleep(2500); }
      const at = await driver.location();
      if (!s.expect.test(String(at))) throw new Error(`${s.id}: ended on ${at}`);
    } else if (s.kind === "home-down") {
      await driver.key("down");
    } else if (s.kind === "keyboard") {
      await driver.raw.command({ cmd: "route", path: "/search" }, 4000);
      await sleep(9000);
    }
  }
  for (const theme of themes) {
    await driver.setTheme(theme);
    mkdirSync(join(out, theme), { recursive: true });
    for (const s of selected) {
      const file = join(out, theme, `${s.id}.png`);
      let done = false;
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        try {
          await reach(s);
          await driver.grab(file);
          done = true;
          console.log(`ok ${theme} ${s.id}${attempt > 1 ? ` (attempt ${attempt})` : ""} ${statSync(file).size} bytes`);
        } catch (e) { console.log(`FAIL ${theme} ${s.id} attempt ${attempt}: ${String(e.message).split("\n")[0]}`); }
      }
      manifest.screens[s.id] ??= { dark: null, light: null };
      manifest.screens[s.id][theme] = done ? `${theme}/${s.id}.png` : null;
      if (!done) manifest.screens[s.id].failed = `${theme}: capture failed after 3 attempts, see the run log`;
      else if (manifest.screens[s.id].failed?.startsWith(theme)) delete manifest.screens[s.id].failed;
      manifest.capturedAt = new Date().toISOString();
      save();
    }
  }
  await driver.stop?.();
}

process.env.PARITY_CLIENT ??= "firetv";
const captureEnv = resolveCaptureEnvironment(process.env.PARITY_CLIENT);
const catalogFiles = await pinnedCatalogFiles(suite, captureEnv, { required: true });
const stateFiles = [...new Set([...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file), ...catalogFiles])];
await withCaptureState({ client: process.env.PARITY_CLIENT, files: stateFiles, env: captureEnv }, async (context) => {
  Object.assign(process.env, context.env);
  const seeded = await applyCanonicalDeck(context, process.env, readSecrets());
  if (!seeded) { await context.clearResumeChoices(); await context.snapshotNow(); }
  await run();
});
