// Suite driver (docs/parity/SUITE.md) for the HarmonyOS Previewer behind the bridge of scripts/harmony-wall/harmony_vnc.py.
//   HARMONY_CTL=40017 (the bridge's control port; 40117 for the phone profile)
// Keys go through the Previewer's command channel; the route and the focused item come from the preview-only parity state the patched
// app reports to the bridge (scripts/harmony-wall/patch_state.py). Run it against a signed-in Previewer (scripts/harmony-wall/capture.py).
import { writeFileSync, readFileSync } from "node:fs";

const CTL = `http://127.0.0.1:${process.env.HARMONY_CTL ?? "40017"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path) => {
  const res = await fetch(CTL + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
};
const state = async () => (await get("/state")).json();
const verifyTestAccount = async () => {
  const expected = process.env.TEST_USERNAME?.trim();
  const actual = (await state()).preview_current_username;
  if (!expected || typeof actual !== "string" || actual !== expected) {
    throw new Error("Harmony capture blocked: the app has not confirmed the configured Device Test account");
  }
};
const click = async (x, y) => { await verifyTestAccount(); await get(`/click?x=${x}&y=${y}`); };
const ROUTE = { "/": "home", "/calendar": "calendar", "/search": "search", "/settings": "settings", "/profiles": "profiles",
  "/movies": "library:movie", "/series": "library:series", "/music": "library:artist" };

export async function createDriver() {
  let evidence = ""; // the media-module failure is logged once, when the Player page first loads
  const driver = {
    async setDeterministicCapture() { throw new Error("Harmony stable deterministic capture unsupported: Previewer patch has no clock or animation pinning hook"); },
    async captureBuildIdentity() { throw new Error("Harmony stable build identity unsupported: deployed app digest is not exposed by Previewer driver"); },
    async waitReady() { throw new Error("Harmony stable deterministic capture unsupported: Previewer does not expose capture readiness"); },
    async key(name, { long } = {}) {
      await verifyTestAccount();
      const k = name === "select" ? "ok" : name;
      await get(`${long ? "/keylong/" : "/key/"}${k}`);
      await sleep(450);
    },
    // The app reports its route a poll after navigating (and the Previewer is slow), so wait for the route the request should reach.
    async route(path) {
      const base = path.split("?")[0];
      const detail = base.match(/^\/(?:movies|series)\/([^/]+)$/)?.[1];
      const name = detail ? `detail:${detail}` : ROUTE[base];
      if (!name) throw new Error(`no preview route for ${path}`);
      const want = detail ? { route: "Detail", work_id: detail } : name.startsWith("library:") ? { route: "Library", lib_kind: name.slice(8) } : null;
      await get(`/setroute?name=${encodeURIComponent(name)}`);
      const t0 = Date.now();
      for (;;) {
        await sleep(2000);
        const s = await state();
        if (!want || Object.entries(want).every(([k, v]) => s[k] === v)) break;
        if (Date.now() - t0 > 45000) { console.log(`  harmony route ${path}: state ${JSON.stringify({ ...s, dbglog: s.dbglog?.slice(-4) })}`); break; }
      }
      await sleep(6000);
    },
    async home() {
      await this.route("/");
      await sleep(4000);
      await get("/setroute?name=focus:pcard");
      const t0 = Date.now();
      while (Date.now() - t0 < 12000 && !(await state()).focused) await sleep(1000);
      if (!(await state()).focused) {
        // Focus requests do not take in the Previewer until a touch has activated focus: click the first card (opens its detail), come back.
        console.log(`  harmony home: no focus, dbg ${JSON.stringify((await state()).dbglog?.slice(-4))}; touch-activating`);
        await click(1044, 544);
        await sleep(8000);
        await this.key("back");
        await sleep(6000);
      }
      await sleep(1500);
    },
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
    async focused() {
      const s = await state();
      if (!s.focused) console.log(`  harmony focused: none, state ${JSON.stringify({ ...s, dbglog: s.dbglog?.slice(-4) })}`);
      return s.focused;
    },
    async screenshot(file) {
      await verifyTestAccount();
      const bytes = Buffer.from(await (await get("/shot.png")).arrayBuffer());
      if (bytes.length < 40000) throw new Error("frame too plain: an error or signed-out screen");
      writeFileSync(file, bytes);
    },
    async setTheme(theme) {
      await this.route("/settings");
      for (const [x, y] of [[394, 207], [theme === "light" ? 1295 : 1645, 285]]) { await click(x, y); await sleep(3000); }
    },
    // Opens the Player route for the case's media file and reads what the Previewer says about AVPlayer: its media stack is a mock, so
    // nothing plays; this reports "error" with the log evidence, never "playing" and never N/A.
    async play(c) {
      await verifyTestAccount();
      const log = process.env.PREVIEWER_LOG;
      const before = log ? readFileSync(log, "latin1").length : 0;
      await get(`/setroute?name=${encodeURIComponent("player:" + c.file)}`);
      await sleep(30000);
      const s = await state();
      const lines = log ? readFileSync(log, "latin1").slice(before).split("\n").filter((l) => /Not exist:.*multimedia|load .*multimedia.*failed|avplayer|AVPlayer/.test(l) && !/WsServer|Debugger/.test(l)) : [];
      if (lines.length) evidence = lines.slice(0, 3).map((l) => l.replace(/^.*\](?=[^\]]*$)/, "").trim().slice(0, 160)).join(" | ");
      const detail = `route=${s.route}; ${evidence || "no media log lines"}`;
      return { state: "error", startSeconds: null, advancedSeconds: 0, detail };
    },
  };
  return driver;
}
