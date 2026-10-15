// Xbox / Windows (UWP) driver for the shared parity suite (docs/parity/SUITE.md). The app runs full screen at 1920x1080 on a
// device or VM; this driver talks to it through one executable named by XBOX_IO, so no address or credential lives here:
//   $XBOX_IO key <up|down|left|right|ret|esc|shift+f10>   press one key
//   $XBOX_IO click <x> <y> | rclick <x> <y> | move <x> <y>  pointer input in 1920x1080 screen pixels
//   $XBOX_IO shot <file.png>                               1920x1080 PNG of the screen
//   $XBOX_IO read                                          print the app's parity.json (see ParityTrace.cs)
//   $XBOX_IO write <name> <text>                           write LocalState/<name> (parity.on, parity.play)
//   $XBOX_IO restart                                       stop and start the app (it opens on the profile picker)
// The app writes parity.json (screen, kind, panel, focused label, playback) while LocalState/parity.on exists.
//   node suite-run.mjs --driver xbox/driver.mjs --via route --out <dir>/dev --expected <web>/expected.json
// Screens are reached with --via route: this driver clicks the way a viewer with a pointer would, because the suite's key
// paths assume the web's filters panel; the D-pad checks themselves press real keys.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { up: "up", down: "down", left: "left", right: "right", select: "ret", back: "esc" };
// Rail items and page controls, in 1920x1080 pixels (the web TV layout the app follows).
const RAIL = { "/movies": [81, 472], "/series": [81, 400], "/music": [81, 544], "/search": [81, 230], "/settings": [81, 992], "/calendar": [81, 856] };
const FIRST_CARD = [947, 254];

export async function createDriver() {
  const io = process.env.XBOX_IO;
  if (!io) throw new Error("XBOX_IO is required (see the header of this file)");
  const run = (...a) => execFileSync(io, a.map(String), { encoding: "utf8", shell: /\.cmd$/i.test(io) });
  const click = async (x, y, wait = 6) => { run("click", x, y); await sleep(wait * 1000); };
  const trace = () => { try { return JSON.parse(run("read")); } catch { return {}; } };
  const until = async (fn, seconds, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) { if (fn(trace())) return; await sleep(700); }
    throw new Error(`timed out waiting for ${what}`);
  };
  let theme = null; // unknown until set: the app starts on the system theme (light on a fresh machine)

  const coldStart = async () => { run("restart"); await until((t) => t.screen === "profiles", 60, "the profile picker"); await sleep(1500); };
  const location = () => {
    const t = trace(), lib = { movie: "/movies", series: "/series", artist: "/music" };
    switch (t.screen) {
      case "home": return "/";
      case "profiles": return "/profiles";
      case "settings": return "/settings";
      case "search": return "/search";
      case "playback": return "/player/x";
      case "calendar": return `/calendar${t.kind === "agenda" ? "" : `?view=${t.kind}`}`;
      case "browse": return `${lib[t.kind] ?? "/movies"}${/filters/i.test(t.panel ?? "") ? "?panel=filters" : ""}`;
      case "detail": return `${lib[t.kind] ?? "/movies"}/x`;
      default: return `/${t.screen ?? ""}`;
    }
  };

  return {
    async start() { run("write", "parity.on", "1"); },
    async setTheme(t) {
      if (t === theme) return;
      await coldStart(); await click(817, 494, 12);
      await click(...RAIL["/settings"]);
      await click(t === "light" ? 1294 : 1637, 250, 4);
      theme = t;
    },
    async home() {
      await coldStart();
      await click(817, 494, 3);
      await until((t) => t.screen === "home" && t.focus, 90, "Home with its first card focused");
      await sleep(8000);
      run("move", 1919, 600);
    },
    async route(path) {
      const [base, query] = path.split("?");
      if (base === "/profiles") { await coldStart(); return; }
      if (base === "/") return;
      if (base.startsWith("/calendar")) {
        await click(...RAIL["/calendar"], 8);
        const view = new URLSearchParams(query ?? "").get("view");
        const dbg = (n) => { if (process.env.XBOX_DEBUG_DIR) run("shot", `${process.env.XBOX_DEBUG_DIR}/${view}-${n}.png`); };
        dbg("1-calendar");
        if (view === "week" || view === "month") { await click(1570, 76, 5); dbg("2-picker"); await click(1570, view === "week" ? 157 : 189, 4); dbg("3-chosen");
          // Hosted runners sometimes only hover the menu item: click again, then pick it with the keys (week = 1 down, month = 2 down).
          for (let i = 0; i < 2 && trace().kind !== view; i++) { await click(1570, view === "week" ? 157 : 189, 4); }
          if (trace().kind !== view) { run("key", "down"); await sleep(400); if (view === "month") { run("key", "down"); await sleep(400); } run("key", "ret"); await sleep(4000); }
          dbg("4-final"); }
        return;
      }
      if (base.startsWith("/player")) {
        // Movies > first card > Play, then pause on web's frame (0:03) so both clients show the same picture.
        await click(...RAIL["/movies"], 25); await click(...FIRST_CARD, 10); await click(232, 622, 4);
        await until((t) => t.screen === "playback" && t.play === "playing" && t.pos >= 3, 90, "playback at 0:03");
        run("write", "parity.pause", "3"); await sleep(3000);
        return;
      }
      const lib = base.split("/").slice(0, 2).join("/");
      if (!RAIL[lib]) throw new Error(`no route for ${path}`);
      await click(...RAIL[lib], 25);
      if (/^\/(movies|series)\/:?[^/]+$/.test(base) || base.endsWith("/:id")) await click(...FIRST_CARD, 8);
      else if (base.startsWith("/player")) { await click(...FIRST_CARD, 8); await click(232, 622, 14); }
      else if (query?.includes("panel=filters")) await click(1877, 187, 3);
    },
    async key(name, { long } = {}) {
      run("key", long ? "shift+f10" : KEYS[name]);
      // A page opened with select loads its grid over the network: give it time before the next key.
      await sleep(name === "select" && !long ? 9000 : 1200);
    },
    async location() { return location(); },
    async focused() { const t = trace(); return t.focus && t.position ? { label: t.focus, position: t.position } : (t.focus ?? null); },
    async screenshot(file) {
      const t = trace();
      if (t.screen === "pairing" || t.play === "error") throw new Error("signed out or error screen");
      run("move", 1919, 600); await sleep(500);
      mkdirSync(dirname(file), { recursive: true });
      // Luminance guard (exit 4 from the helper): a light frame is refused in a dark run and the reverse. The player is black in both.
      run("shot", file, ...(theme && t.screen !== "playback" ? [theme] : []));
    },
    // Plays media file `c.file` through the app's parity.play request; judged from the player's own position.
    async play(c, expect) {
      await this.home();
      run("write", "parity.play", c.file);
      const t0 = Date.now();
      let p0 = null;
      while (Date.now() - t0 < expect.startWithinSeconds * 1000) {
        await sleep(1500);
        const t = trace();
        if (t.play === "error") return { state: "error", detail: "player reported an error" };
        if (t.screen === "playback" && t.play === "playing" && t.pos > 0) { p0 = t; break; }
      }
      if (!p0) return { state: "error", detail: "no frames in time" };
      const startSeconds = (Date.now() - t0) / 1000;
      await sleep((expect.advanceSeconds + 1) * 1000);
      const p1 = trace(), advanced = (p1.pos ?? 0) - p0.pos;
      run("key", "esc"); await sleep(1500);
      return { state: p1.play === "playing" && advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: advanced };
    },
  };
}
