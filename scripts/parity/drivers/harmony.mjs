// Suite driver (docs/parity/SUITE.md) for the HarmonyOS Previewer behind the bridge of scripts/harmony-wall/harmony_vnc.py.
//   HARMONY_CTL=40017 (the bridge's control port; 40117 for the phone profile)
// Keys go through the Previewer's command channel; the route and the focused item come from the preview-only parity state the patched
// app reports to the bridge (scripts/harmony-wall/patch_state.py). Run it against a signed-in Previewer (scripts/harmony-wall/capture.py).
import { writeFileSync } from "node:fs";

const CTL = `http://127.0.0.1:${process.env.HARMONY_CTL ?? "40017"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path) => {
  const res = await fetch(CTL + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
};
const state = async () => (await get("/state")).json();
const ROUTE = { "/": "home", "/calendar": "calendar", "/search": "search", "/settings": "settings", "/profiles": "profiles",
  "/movies": "library:movie", "/series": "library:series", "/music": "library:artist" };

export async function createDriver() {
  const driver = {
    async key(name, { long } = {}) {
      const k = name === "select" ? "ok" : name;
      await get(`${long ? "/keylong/" : "/key/"}${k}`);
      await sleep(450);
    },
    async route(path) {
      const base = path.split("?")[0];
      const name = ROUTE[base];
      if (!name) throw new Error(`no preview route for ${path}`);
      await get(`/setroute?name=${encodeURIComponent(name)}`);
      await sleep(8000);
    },
    async home() { await this.route("/"); await sleep(4000); },
    async location() {
      const s = await state();
      const kind = { movie: "/movies", series: "/series", artist: "/music" };
      switch (s.route) {
        case "Home": return "/";
        case "Library": return kind[s.kind] ?? "/movies";
        case "Detail": return `${s.lib_kind === "series" ? "/series" : "/movies"}/x`;
        case "Calendar": return "/calendar?view=agenda";
        case "Search": return "/search";
        case "Settings": return "/settings";
        case "Profiles": return "/profiles";
        case "Player": return "/player/x";
        default: return "/" + String(s.route).toLowerCase();
      }
    },
    async focused() { return (await state()).focused; },
    async screenshot(file) {
      const bytes = Buffer.from(await (await get("/shot.png")).arrayBuffer());
      if (bytes.length < 40000) throw new Error("frame too plain: an error or signed-out screen");
      writeFileSync(file, bytes);
    },
    async setTheme(theme) {
      await this.route("/settings");
      for (const [x, y] of [[394, 207], [theme === "light" ? 1295 : 1645, 285]]) { await get(`/click?x=${x}&y=${y}`); await sleep(3000); }
    },
    // The Previewer mocks AVPlayer, so nothing can play here; reported as an error, never as N/A.
    async play() { return { state: "error", detail: "the Previewer mocks AVPlayer: no playback" }; },
  };
  return driver;
}
