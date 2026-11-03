#!/usr/bin/env node
// Writes captures/<device>/manifest.json for the design report from the PNGs on disk, copying the alias states.
// usage: write-manifest.mjs <captures dir> <build sha>
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const THEMES = ["dark", "light"];
const EXISTING = ["home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "player-controls", "actions"];
const NEW = ["login-qr", "downloads", "playlists", "watchlist", "requests", "playlist-detail", "music-detail", "search-results", "player",
  "settings-appearance", "settings-profile-avatar", "settings-language", "settings-player", "settings-server", "settings-profile-lock",
  "search--keyboard", "profiles--add"];
// The same native page serves two ids (the Link page is the QR and the device code in one).
const SAME_PAGE = { link: "login-qr" };
const ALIASES = { "movies--filters-open": "filters", "film-detail--actions-open": "actions", "player--controls": "player-controls" };
const ABSENT = {
  login: "No credential form: clients/sailfish/qml has no username or password field. Sign-in is the device link (LinkPage.qml, captured as login-qr).",
  signup: "No account creation: grep -rniE 'sign.?up|create account' clients/sailfish/qml clients/sailfish/src finds nothing; the app only pairs through LinkPage.qml.",
  household: "No household page or route: grep -rni household clients/sailfish/qml clients/sailfish/src finds nothing.",
  sites: "No sites library: NavBar.qml tabs are downloads, search, home, series, movies, music, playlists; kind 'site' is only handled inside HomeView.qml and ActionsPage.qml for items.",
  "episode-detail": "Same screen as series-detail: DetailPage.qml shows the next-up episode panel and the season grid in one page (epMode).",
  folders: "No folders page: grep -rni folder clients/sailfish/qml clients/sailfish/src finds nothing; NavBar.qml has no such tab.",
  "settings-invite": "SettingsView.qml rows are appearance, avatar, language, player, server, lock, calendar, watchlist, requests; no invite row or page (grep -rni invite finds nothing).",
  "settings-request-latency": "No such settings row or page (SettingsView.qml rows listed above; grep -rni latency finds nothing).",
  "settings-remote": "No such settings row or page (SettingsView.qml rows listed above; the only 'remote' in the app is Nemo remote actions for download notifications).",
  "settings-your-data": "No such settings row or page (SettingsView.qml rows listed above; grep -rniE 'your.?data' finds nothing).",
  "settings-home": "No such settings row or page: the only home setting is the artwork choice inside Appearance (SettingsSubPage.qml section appearance), captured as settings-appearance.",
  "not-found": "No unknown-route screen: the app has no URL routing (pages are pushed from code; startRoute.js picks link, profiles or main). grep -rniE 'not.?found' clients/sailfish/qml finds nothing.",
  "home--focus-second-rail": "Touch phone with no D-pad focus state at rest (D-pad is not applicable to Sailfish OS, see docs/parity/DEVICES.md); no focus ring exists to capture.",
};

const dir = resolve(process.argv[2] ?? "");
const build = process.argv[3];
if (!process.argv[2] || !build) throw new Error("usage: write-manifest.mjs <captures dir> <build sha>");
const has = (theme, id) => existsSync(join(dir, theme, `${id}.png`));
for (const [alias, base] of Object.entries(ALIASES)) for (const t of THEMES) if (has(t, base)) copyFileSync(join(dir, t, `${base}.png`), join(dir, t, `${alias}.png`));
for (const [id, base] of Object.entries(SAME_PAGE)) for (const t of THEMES) if (has(t, base)) copyFileSync(join(dir, t, `${base}.png`), join(dir, t, `${id}.png`));
const screens = {};
for (const id of [...EXISTING, ...NEW, ...Object.keys(ALIASES), ...Object.keys(SAME_PAGE)]) {
  const entry = {};
  for (const t of THEMES) entry[t] = has(t, id) ? `${t}/${id}.png` : null;
  if (SAME_PAGE[id]) entry.note = `Same native page as ${SAME_PAGE[id]} (LinkPage.qml shows the QR and the device code together).`;
  if (ALIASES[id]) entry.note = `Same state as ${ALIASES[id]}.`;
  screens[id] = entry;
}
for (const [id, reason] of Object.entries(ABSENT)) screens[id] = { dark: null, light: null, absent: reason };
const missing = Object.entries(screens).filter(([, e]) => !e.absent && (!e.dark || !e.light)).map(([id]) => id);
writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({
  device: "sailfish-os", class: "emulated", build, capturedAt: new Date().toISOString(),
  note: "Sailfish OS SDK emulator (VirtualBox), 768 x 1344, static parity server, fixture clock 2026-10-07T12:00:00Z. Build is the app source commit; the installed QML equals clients/sailfish/qml at that commit (sha256 per file).",
  screens,
}, null, 2)}\n`);
console.log(missing.length ? `missing captures: ${missing.join(", ")}` : "manifest complete");
