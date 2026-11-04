// Design-report captures the shared suite does not take (docs: design-report/SCREENS-ALL.md). Plain 1920x1080 PNGs, no layout export.
//   XBOX_IO=... XBOX_DESIGN=1 node xbox/design-captures.mjs --theme dark|light --out <dir>   writes <dir>/<theme>/<id>.png and
//   <dir>/<theme>/design.json (per screen: ok, or the reason it failed). The suite (XBOX_DESIGN=1) takes the 15 existing screens.
// Every screen is verified through the app's own parity trace (the page it reports) before the picture is taken; a screen that
// does not reach its page is recorded as failed, never captured as something else. The signed-out pages come last (signing out ends the session).
import { writeFileSync, mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDriver } from "./driver.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const theme = arg("theme"), out = arg("out");
if (!["dark", "light"].includes(theme) || !out) throw new Error("usage: design-captures.mjs --theme dark|light --out <dir>");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Rail items (1920x1080 pixels): the 73.59 px pitch of ShellChrome, groups Downloads/Search, Home..Music, Playlists..Calendar.
const RAIL = { downloads: [81, 157], playlists: [81, 635], watchlist: [81, 709], requests: [81, 782] };
const SECTION = { "settings-appearance": 0, "settings-profile-avatar": 1, "settings-language": 2, "settings-player": 3, "settings-server": 4, "settings-profile-lock": 5, "settings-invite": 6, "settings-remote": 7, "settings-your-data": 8, "settings-home": 9 };

// Fixture the frozen seed lacks: one playlist of pinned titles, created through the API on the throw-away DB copy (skipped when one exists).
async function seedPlaylist() {
  const srv = process.env.PLAYARR_SERVER_URL.replace(/\/$/, "");
  const suite = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "suite.json"), "utf8"));
  const open = (id) => suite.screens.find((s) => s.id === id).open;
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: process.env.PLAYARR_USERNAME, password: process.env.PLAYARR_PASSWORD }) });
  if (!lr.ok) throw new Error(`login ${lr.status}`);
  const auth = { authorization: `Bearer ${(await lr.json()).access_token}` };
  const existing = await (await fetch(`${srv}/api/v1/playlists`, { headers: auth })).json();
  if ((Array.isArray(existing) ? existing : existing.items ?? existing.playlists ?? []).length) return;
  const created = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
  if (!created.ok) throw new Error(`create playlist ${created.status}`);
  const playlist = await created.json();
  for (const workId of [open("film-detail"), open("series-detail")].map((r) => r.split("/").pop()).concat(["4ec39b80-28c3-4d83-9f83-f07872e5f4c0"])) {
    const added = await fetch(`${srv}/api/v1/playlists/${playlist.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: workId }) });
    if (!added.ok) throw new Error(`add playlist item ${added.status}`);
  }
}

await seedPlaylist();
const d = await createDriver();
const result = {};
const file = (id) => join(out, theme, `${id}.png`);
async function take(id, fn) {
  try { await fn(); result[id] = "ok"; console.log(`ok ${theme} ${id}`); }
  catch (e) { result[id] = `failed: ${String(e.message).split("\n")[0]}`; console.log(`FAIL ${theme} ${id}: ${result[id]}`); }
}
const expectScreen = async (screen, seconds = 40) => d.waitFor((t) => t.screen === screen, seconds, `the ${screen} page`);
const shot = async (id, opts) => { await d.parkPointer(); await sleep(2500); await d.shotPlain(file(id), opts); };
const railTo = async (id, screen) => { await d.clickAt(...RAIL[id], 10); await expectScreen(screen); await sleep(6000); };

await d.start();
await d.setTheme(theme);
await d.home();
await take("home--focus-second-rail", async () => {
  const before = (await d.trace()).focus;
  await d.pressKey("down", 3);
  const after = (await d.trace()).focus;
  if (!after || after === before) throw new Error(`focus did not move to the second rail (${before} -> ${after})`);
  await shot("home--focus-second-rail");
});
for (const [id, screen] of [["downloads", "downloads"], ["watchlist", "watchlist"], ["requests", "requests"]]) {
  await take(id, async () => { await railTo(id, screen); await shot(id); });
}
await take("playlists", async () => { await railTo("playlists", "playlists"); await shot("playlists"); });
await take("playlist-detail", async () => {
  await railTo("playlists", "playlists");
  await d.pressKey("ret", 8);
  await expectScreen("playlist", 30);
  await shot("playlist-detail");
});
await take("music-detail", async () => {
  await d.route("/music/:id");
  await d.waitFor((t) => t.screen === "detail", 40, "the artist detail page");
  await sleep(6000);
  await shot("music-detail");
});
await take("search-results", async () => {
  await d.route("/search");
  await expectScreen("search");
  await d.ui("search:the", { wait: 10 });
  await shot("search-results");
});
const sections = Object.entries(SECTION);
await take("settings-route", async () => { await d.route("/settings"); });
for (const [id, index] of sections) {
  await take(id, async () => {
    await d.waitFor((t) => t.screen === "settings", 30, "Settings");
    await d.ui(`section:${index}`, { wait: 6 });
    await shot(id);
  });
}
await take("player", async () => {
  await d.route("/player/x"); // paused at 0:02 with the controls up
  await d.parkPointer();
  await d.pressKey("esc", 2.5); // the first Back hides the controls
  const t = await d.trace();
  if (t.screen !== "playback") throw new Error(`Back left the player (${t.screen})`);
  await sleep(1500);
  await d.shotPlain(file("player"));
});
await take("profiles--add", async () => {
  await d.route("/profiles");
  await expectScreen("profiles");
  await sleep(4000);
  await d.ui("addprofile", { wait: 4 });
  await shot("profiles--add", { unguarded: true }); // the dialog scrim dims the top strip the theme guard samples
  await d.pressKey("esc", 1.5); // Cancel
});
await d.home(); // the picker again: pick the profile so Settings has its rail
// Signed-out pages: sign out from Settings > Server, then the QR sign-in page, then manual sign-in.
await take("login-qr", async () => {
  await d.route("/settings");
  await d.waitFor((t) => t.screen === "settings", 30, "Settings");
  await d.ui("section:4", { wait: 3 });
  await d.ui("signout", { wait: 4 });
  await d.waitFor((t) => t.screen === "pairing" && t.code, 60, "the sign-in page with a pairing code");
  await sleep(4000);
  await d.shotPlain(file("login-qr"), { anon: true });
});
await take("login", async () => {
  await d.ui("manual", { anon: true, wait: 4 });
  await sleep(2000);
  await d.shotPlain(file("login"), { anon: true });
});
mkdirSync(join(out, theme), { recursive: true });
writeFileSync(join(out, theme, "design.json"), `${JSON.stringify(result, null, 1)}\n`);
