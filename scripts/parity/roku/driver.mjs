// Roku driver for the shared parity suite (docs/parity/SUITE.md): the sideloaded channel on a physical Roku, driven over ECP.
//   ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<dev password> node suite-run.mjs --driver roku/driver.mjs --out <dir>/dev --expected <web>/expected.json
// Input and screenshots go through ECP (port 8060) and the dev installer's plugin_inspect endpoint. The channel reports its
// screen and focused item on the debug console (port 8085) as "PARITY|<kind>|<text>" lines, which is how location() and focused()
// work: a Roku has no accessibility query. Playback starts through the ECP deep link (launch with contentId=<media file id>) and
// is judged with /query/media-player. Screenshots show the dev channel only and no video plane (a playing title screenshots black).
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const KEYS = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Select", back: "Back" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createDriver({ out }) {
  const target = process.env.ROKU_DEV_TARGET;
  const password = process.env.ROKU_DEV_PASSWORD;
  if (!target || !password) throw new Error("ROKU_DEV_TARGET and ROKU_DEV_PASSWORD are required");
  // The real account's library is large and the relay is slow: ROKU_WAIT_SCALE stretches every settle wait.
  const scale = Number(process.env.ROKU_WAIT_SCALE ?? "2");
  const wait = (s) => sleep(s * 1000 * (s > 2 ? scale : 1));
  const ecp = async (path, method = "POST") => {
    for (let i = 0; ; i += 1) {
      try { return await fetch(`http://${target}:8060/${path}`, { method, headers: { connection: "close" } }); }
      catch (e) { if (i >= 4) throw e; await sleep(1500); }
    }
  };
  const press = async (key, s = 1.2) => { await ecp(`keypress/${key}`); await wait(s); };

  // Debug console: keep the latest screen, kinds and focus, with a sequence number to wait for changes.
  const st = { screen: "", browse: "", detail: "", page: "", panel: "", view: "", focus: null, seq: 0 };
  let sock, buf = "";
  const connect = () => new Promise((ok, fail) => {
    sock = net.connect(8085, target, ok);
    sock.on("error", fail);
    sock.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n"); buf = lines.pop();
      for (const l of lines) {
        const m = /PARITY\|([a-z]+)\|(.*)$/.exec(l.trim());
        if (!m) continue;
        const [, kind, text] = m;
        st.seq += 1;
        if (kind === "screen") { st.screen = text; st.panel = ""; st.focus = null; if (text !== "page") st.view = ""; }
        else if (kind === "focus") st.focus = text;
        else st[kind] = text;
      }
    });
  });
  const until = async (fn, seconds, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) { if (fn()) return; await sleep(500); }
    throw new Error(`timed out waiting for ${what}`);
  };

  const dig = ["--digest", "-u", `rokudev:${password}`, "--silent", "--show-error"];
  const shoot = (file) => {
    mkdirSync(dirname(file), { recursive: true });
    const jpg = `${file}.jpg`;
    execFileSync("curl", [...dig, "-F", "mysubmit=Screenshot", "-F", "passwd=", `http://${target}/plugin_inspect`], { stdio: "ignore" });
    execFileSync("curl", [...dig, "-o", jpg, `http://${target}/pkgs/dev.jpg?time=${Date.now()}`]);
    const r = spawnSync("systemd-run", ["--user", "--scope", "-q", "-p", "MemoryHigh=2G", "-p", "MemoryMax=3G", "-p", "MemorySwapMax=0", "--",
      "timeout", "120", "ffmpeg", "-threads", "2", "-y", "-v", "error", "-i", jpg, "-frames:v", "1", file], { stdio: "inherit" });
    rmSync(jpg, { force: true });
    if (r.status !== 0) throw new Error("ffmpeg failed");
  };

  let theme = null;
  const coldStart = async () => {
    await ecp("keypress/Home"); await wait(4);
    st.screen = "";
    await ecp("launch/dev");
    // The channel shows the pairing screen for an instant at start-up before the stored session opens the picker.
    await until(() => st.screen === "profiles", 40, "the profile picker").catch((e) => {
      if (st.screen === "pairing") throw new Error("the channel is signed out (pairing screen): sign in again as the device test account");
      throw e;
    });
    await wait(3);
    // The picker resumes on the first profile, the gear or the theme dropdown: Down twice reaches the bottom row from any of
    // them, Left selects the gear and Up returns to the first profile.
    for (const k of ["Down", "Down", "Left", "Up"]) await press(k, 0.6);
  };

  return {
    async start() { await connect(); },
    async stop() { sock?.destroy(); },
    async setTheme(t) {
      if (t === theme) return;
      await coldStart();
      await press("Up"); await press("Select", 4);
      for (let i = 0; i < (t === "light" ? 1 : 2); i += 1) await press("Down", 1.2);
      await press("Select", 3);
      theme = t;
    },
    // Back to Home with the first rail card focused: cold start, pick the first profile.
    async home() {
      await coldStart();
      await press("Select", 0.5);
      await until(() => st.screen === "home", 60, "Home");
      await until(() => st.focus, 90, "the first Home card");
      await wait(25);
    },
    // Every screen is reached by deep link (suite-run --via route): the dock walk is Left, Down until the identity chip, Up back to
    // the entry (Calendar 1, Requests 2, Watchlist 3, Playlists 4, Music 5, Movies 6, Series 7, Home 8, Search 9).
    async route(path) {
      const dockTo = async (ups) => { await press("Left", 0.8); for (let i = 0; i < 12; i += 1) await press("Down", 0.35); for (let i = 0; i < ups; i += 1) await press("Up", 0.6); await press("Select", 0.8); };
      const library = async (ups, kind) => { await dockTo(ups); await until(() => st.browse === kind, 30, `the ${kind} library`); await until(() => st.focus !== null, 90, "the first library item"); await wait(10); };
      const [pathname, query = ""] = path.split("?");
      if (pathname === "/") return;
      if (pathname === "/movies" && !query) { await library(6, "movie"); return; }
      if (pathname === "/movies" && query.includes("panel=filters")) {
        await library(6, "movie");
        await press("Info", 1); await press("Up", 1); await press("Select", 3);
        st.panel = "filters";
      } else if (pathname === "/series") await library(7, "series");
      else if (pathname === "/music") await library(5, "artist");
      else if (pathname === "/search") { await dockTo(9); await until(() => st.screen === "search", 30, "search"); await wait(4); }
      else if (pathname === "/profiles") { await dockTo(0); await until(() => st.screen === "profiles", 30, "the profiles page"); await wait(3); }
      else if (pathname === "/settings") {
        await dockTo(0); await until(() => st.screen === "profiles", 30, "the profiles page"); await wait(3);
        for (const k of ["Down", "Left", "Select"]) await press(k, 1);
        await until(() => st.screen === "settings", 30, "preferences"); await wait(3);
      } else if (pathname === "/calendar") {
        await dockTo(1);
        await until(() => st.page === "calendar", 30, "the calendar");
        await wait(16);
        // The range switcher (left of Previous) chooses the view: Month is the default, Week and Agenda are one and two rows down.
        const view = /view=(week|agenda)/.exec(query)?.[1];
        if (view) {
          for (const k of ["Up", "Up", "Up", "Up", "Left", "Left", "Select"]) await press(k, 0.8);
          await wait(3);
          for (const k of view === "week" ? ["Down", "Select"] : ["Down", "Down", "Select"]) await press(k, 1);
          await wait(14);
          st.view = view;
        }
      } else if (pathname.startsWith("/movies/") || pathname.startsWith("/series/") || pathname.startsWith("/player/") || pathname === "/movies") {
        // Detail pages open the second library item, as the suite's keys do (right, select); the player plays that title.
        const series = pathname.startsWith("/series/");
        await library(series ? 7 : 6, series ? "series" : "movie");
        await press("Right", 0.8); await press("Select", 1);
        await until(() => st.screen === "detail", 30, "the detail page"); await wait(12);
        if (pathname.startsWith("/player/")) {
          await press("Select", 1);
          await until(() => st.screen === "playback", 30, "the player"); await wait(20);
          await press("Play", 1.5); await press("Down", 1);
        }
      } else throw new Error(`no route for ${path}`);
    },
    async key(name, { long } = {}) {
      const k = KEYS[name];
      // A library or Home screen only takes D-pad input once its first item has focus (the first load takes tens of seconds).
      if ((st.screen === "browse" || st.screen === "home") && st.focus === null) await until(() => st.focus !== null, 90, "the first item focus");
      if (long) { await ecp(`keydown/${k}`); await sleep(1000); await ecp(`keyup/${k}`); }
      else await ecp(`keypress/${k}`);
      await sleep(900);
    },
    // The suite's web route for the screen the channel is on.
    async location() {
      const lib = { movie: "/movies", series: "/series", artist: "/music", music: "/music" };
      switch (st.screen) {
        case "home": return "/";
        case "profiles": return "/profiles";
        case "settings": return "/settings";
        case "search": return "/search";
        case "playlists": return "/playlists";
        case "playback": return "/player/x";
        case "drawer": return "/movies";
        case "browse": return `${lib[st.browse] ?? `/${st.browse}`}${st.panel ? `?panel=${st.panel}` : ""}`;
        case "page": return st.page === "calendar" && st.view && st.view !== "month" ? `/calendar?view=${st.view}` : `/${st.page}`;
        case "detail": return `${lib[st.detail] ?? `/${st.detail}`}/x`;
        default: return `/${st.screen}`;
      }
    },
    // The focus event of a rail or grid move arrives after the move animation: wait until none has come for 1.5 s.
    async focused() {
      let seen = st.seq;
      for (let i = 0; i < 8; i += 1) { await sleep(1500); if (st.seq === seen) break; seen = st.seq; }
      return st.focus;
    },
    async screenshot(file) {
      if (st.screen === "pairing" || st.screen === "status") throw new Error("signed out or error screen");
      shoot(file);
    },
    // Deep link: Home exits the channel, launch with contentId plays that media file once the profile is known.
    async play(c, expect) {
      await ecp("keypress/Home"); await wait(4);
      await ecp(`launch/dev?contentId=${c.file}&mediaType=movie`);
      const t0 = Date.now();
      const media = async () => {
        const xml = await (await ecp("query/media-player", "GET")).text();
        return { state: /state="([^"]+)"/.exec(xml)?.[1] ?? "none", position: Number(/<position>(\d+)\s*ms/.exec(xml)?.[1] ?? 0), error: /error="true"/.test(xml) };
      };
      let p0 = null;
      while (Date.now() - t0 < expect.startWithinSeconds * 1000) {
        await sleep(2000);
        const m = await media();
        if (m.error) return { state: "error", detail: "media player error" };
        if (m.state === "play" && m.position > 0) { p0 = m; break; }
      }
      if (!p0) return { state: "error", detail: "no frames in time" };
      const startSeconds = (Date.now() - t0) / 1000;
      await sleep((expect.advanceSeconds + 2) * 1000);
      const p1 = await media();
      const advanced = (p1.position - p0.position) / 1000;
      await ecp("keypress/Back"); await sleep(1500);
      return { state: p1.state === "play" && advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: advanced };
    },
  };
}
