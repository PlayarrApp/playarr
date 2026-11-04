#!/usr/bin/env node
// Design-report capture of the screens that the parity suite does not walk (design-report/SCREENS-ALL.md), on the real Roku.
//   ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> node design-capture.mjs <out-dir> <dark|light> [screen-id ...]
// Writes <out-dir>/<theme>/<id>.png (the device's JPEG frame converted losslessly by the driver) next to <id>.png.capture.json.
// Static parity server only; the channel is launched with the pinned clock. Never plays or changes a stored preference except the theme.
import { createDriver } from "../drivers/roku.mjs";

/** id -> how the screen is reached. route: the web path the channel opens itself; run: a key sequence on top of a start. */
export const DESIGN_SCREENS = {
  "login-qr": { route: "/login/qr" },
  household: { route: "/household" },
  "music-detail": { route: "/music/bfcdc905-c5b9-52fd-ab24-d4ab0f735088" }, // first artist of the frozen catalogue (static/catalogue.mjs)
  "search-results": { route: "/search?q=the" },
  watchlist: { route: "/watchlist" },
  requests: { route: "/requests" },
  playlists: { route: "/playlists" },
  "playlist-detail": { route: "/playlists", keys: ["Select"] },
  sites: { route: "/sites" },
  player: { player: "bare" },
  "settings-appearance": { route: "/settings/appearance" },
  "settings-profile-avatar": { route: "/settings/profile-avatar" },
  "settings-language": { route: "/settings/language" },
  "settings-player": { route: "/settings/player" },
  "settings-server": { route: "/settings/server" },
  "settings-profile-lock": { route: "/settings/profile-lock" },
  "settings-invite": { route: "/settings/invite" },
  "settings-request-latency": { route: "/settings/request-latency" },
  "settings-remote": { route: "/settings/remote" },
  "settings-your-data": { route: "/settings/your-data" },
  "settings-home": { route: "/settings/home" },
  clients: { route: "/clients" },
  "home--focus-second-rail": { home: ["Down"] },
  "search--keyboard": { route: "/search", keys: ["Select"] },
  "profiles--add": { profiles: ["Right", "Right", "Right"] },
};

const [out, theme, ...ids] = process.argv.slice(2);
if (!out || !["dark", "light"].includes(theme)) { console.error("usage: design-capture.mjs <out-dir> <dark|light> [id ...]"); process.exit(2); }
const wanted = ids.length ? ids : Object.keys(DESIGN_SCREENS);
const driver = createDriver({ out, args: ["--only", "screens", "--screens", "home"] });
await driver.start();
let failed = 0;
try {
  await driver.setTheme(theme);
  for (const id of wanted) {
    const spec = DESIGN_SCREENS[id];
    if (!spec) { console.error(`unknown screen ${id}`); failed += 1; continue; }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        if (spec.route) await driver.designRoute(spec.route);
        else if (spec.home) await driver.designHome();
        else if (spec.profiles) await driver.designProfiles();
        else if (spec.player) await driver.designPlayer({ bare: spec.player === "bare" });
        if (spec.keys) await driver.designKeys(spec.keys);
        if (spec.home) await driver.designKeys(spec.home);
        if (spec.profiles) await driver.designKeys(spec.profiles);
        await driver.screenshot(`${out}/${theme}/${id}.png`);
        console.log(`ok ${theme} ${id}`);
        break;
      } catch (error) {
        console.error(`fail ${theme} ${id} attempt ${attempt}: ${String(error?.message ?? error).split("\n")[0]}`);
        if (attempt === 2) failed += 1;
      }
    }
  }
} finally {
  await driver.stop();
}
process.exit(failed ? 1 : 0);
