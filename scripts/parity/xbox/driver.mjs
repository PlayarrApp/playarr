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
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { up: "up", down: "down", left: "left", right: "right", select: "ret", back: "esc" };
// Rail items and page controls, in 1920x1080 pixels (the web TV layout the app follows).
const RAIL = { "/movies": [81, 472], "/series": [81, 400], "/music": [81, 544], "/search": [81, 230], "/settings": [81, 992], "/calendar": [81, 856] };
const FIRST_CARD = [947, 254];

export function accountProbeResult(trace, nonce) {
  if (!trace || trace.accountProbe !== nonce) return "pending";
  return trace.accountMatchesTest === true ? "match" : "mismatch";
}

export function directPlayerProbeResult(trace, nonce) {
  if (!trace || trace.playerFixtureNonce !== nonce) return "pending";
  if (trace.playerFixture === "fixture-unavailable") return "unavailable";
  if (typeof trace.playerFixture === "string" && /^fixture-(?:http-\d{3}|transport|invalid-payload|invalid-response|invalid-server-config|unauthorized|not-found|api-error|unexpected-error)$/.test(trace.playerFixture)) return trace.playerFixture;
  if (trace.playerFixture === "not-direct" || trace.playerMode === "hls") return "not-direct";
  if (trace.screen === "playback" && trace.playerFixture === "direct-preflight" && trace.playerMode === "direct") return "ready";
  return "pending";
}

export function playerCaptureProbeResult(trace, nonce) {
  if (!trace || trace.playerFixtureNonce !== nonce) return "pending";
  if (trace.playerFixture === "seek-timeout") return "seek-timeout";
  if (trace.screen !== "playback" || trace.playerMode !== "direct") return "pending";
  return trace.play === "paused" && Number.isFinite(trace.pos) && Math.abs(trace.pos - 2) <= 0.25
    ? "ready"
    : "pending";
}

export function playerCaptureSummary(trace) {
  const safe = (value, allowed) => allowed.includes(value) ? value : "unknown";
  const fixture = ["idle", "checking", "direct-preflight", "not-direct", "fixture-unavailable", "seek-timeout"].includes(trace?.playerFixture)
    ? trace.playerFixture
    : typeof trace?.playerFixture === "string" && /^fixture-(?:http-\d{3}|transport|invalid-payload|invalid-response|invalid-server-config|unauthorized|not-found|api-error|unexpected-error)$/.test(trace.playerFixture)
      ? trace.playerFixture
      : "unknown";
  const position = Number(trace?.pos);
  return `screen=${safe(trace?.screen, ["playback", "home", "browse", "detail", "unknown"])} `
    + `fixture=${fixture} `
    + `mode=${safe(trace?.playerMode, ["direct", "hls", "unknown"])} `
    + `state=${safe(trace?.play, ["playing", "paused", "loading", "error", "unknown"])} `
    + `position=${Number.isFinite(position) ? position.toFixed(1) : "unknown"}`;
}

export function libraryFocusReady(trace, expectedKind) {
  return trace?.screen === "browse"
    && trace.kind === expectedKind
    && trace.focusArea === "grid"
    && trace.initialFocusPending === false;
}

export function expectedLibraryKind(route) {
  return ({ "/movies": "movie", "/series": "series", "/music": "artist" })[route];
}

export function libraryFocusSummary(trace) {
  const allowed = (value, values) => values.includes(value) ? value : "unknown";
  const pending = typeof trace?.initialFocusPending === "boolean" ? String(trace.initialFocusPending) : "unknown";
  return `screen=${allowed(trace?.screen, ["browse", "home", "detail", "unknown"])} `
    + `kind=${allowed(trace?.kind, ["movie", "series", "artist", "unknown"])} `
    + `focusArea=${allowed(trace?.focusArea, ["grid", "nav", "control", "none", "unknown"])} `
    + `initialFocusPending=${pending}`;
}

export function focusCaptureSidecar(trace) {
  const screen = ["home", "profiles", "settings", "search", "playback", "calendar", "browse", "detail", "pairing"].includes(trace?.screen)
    ? trace.screen : "unknown";
  const kind = ["movie", "series", "artist", "agenda", "week", "month"].includes(trace?.kind) ? trace.kind : "unknown";
  const focusArea = ["grid", "nav", "control", "none"].includes(trace?.focusArea) ? trace.focusArea : "unknown";
  const initialFocusPending = typeof trace?.initialFocusPending === "boolean" ? trace.initialFocusPending : null;
  return {
    screen,
    kind,
    focusArea,
    initialFocusPending,
    initialFocusReady: screen === "browse" && focusArea === "grid" && initialFocusPending === false,
  };
}

export function hasDirectPlayMediaId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "");
}

export function themeCaptureAllowed(trace, expected) {
  return (expected === "light" || expected === "dark")
    && trace?.themeChoice === expected
    && typeof trace.themeIsLight === "boolean"
    && trace.themeIsLight === (expected === "light");
}

export async function createDriver() {
  const io = process.env.XBOX_IO;
  if (!io) throw new Error("XBOX_IO is required (see the header of this file)");
  const run = (...a) => execFileSync(io, a.map(String), { encoding: "utf8", shell: /\.cmd$/i.test(io) });
  const trace = () => { try { return JSON.parse(run("read")); } catch { return {}; } };
  const requireTestAccount = async () => {
    const nonce = randomUUID().replaceAll("-", "");
    run("identity", nonce);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = accountProbeResult(trace(), nonce);
      if (result === "match") return;
      if (result === "mismatch") throw new Error("refusing Xbox parity input or capture: signed-in test account identity does not match");
      await sleep(100);
    }
    throw new Error("refusing Xbox parity input or capture: signed-in test account identity is stale or unverifiable");
  };
  const click = async (x, y, wait = 6) => { await requireTestAccount(); run("click", x, y); await sleep(wait * 1000); };
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
    endCrops: true, cropIds: ["filters-list", "filters-language"], // Filters List view and the open language flyout
    async start() { run("write", "parity.on", "1"); },
    async setTheme(t) {
      if ((t === "light" || t === "dark") && themeCaptureAllowed(trace(), t)) { theme = t; return; }
      if (t !== "light" && t !== "dark") throw new Error(`unsupported Xbox parity theme: ${t}`);
      theme = null;
      await coldStart(); await click(817, 494, 12);
      await click(...RAIL["/settings"]);
      await until((state) => state.screen === "settings" && state.themeTargets?.some((target) => target.choice === t), 30, "native theme choice bounds");
      const target = trace().themeTargets.find((item) => item.choice === t);
      await click(target.x + target.width / 2, target.y + target.height / 2, 4);
      await until((state) => themeCaptureAllowed(state, t), 20, `saved ${t} choice and effective theme`);
      theme = t;
    },
    async home() {
      await coldStart();
      await click(817, 494, 3);
      await until((t) => t.screen === "home" && t.focus, 90, "Home with its first card focused");
      await sleep(8000);
      await requireTestAccount();
      run("move", 1919, 600);
    },
    async route(path) {
      const [base, query] = path.split("?");
      if (base === "/profiles") { await coldStart(); return; }
      if (base === "/") return;
      if (base.startsWith("/calendar")) {
        await click(...RAIL["/calendar"], 8);
        const view = new URLSearchParams(query ?? "").get("view");
        const dbg = async (n) => { if (process.env.XBOX_DEBUG_DIR) { await requireTestAccount(); run("shot", `${process.env.XBOX_DEBUG_DIR}/${view}-${n}.png`); } };
        await dbg("1-calendar");
        if (view === "week" || view === "month") { await click(1570, 76, 5); await dbg("2-picker"); await click(1570, view === "week" ? 157 : 189, 4); await dbg("3-chosen");
          // Hosted runners sometimes only hover the menu item: click again, then pick it with the keys (week = 1 down, month = 2 down).
          for (let i = 0; i < 2 && trace().kind !== view; i++) { await click(1570, view === "week" ? 157 : 189, 4); }
          if (trace().kind !== view) { await requireTestAccount(); run("key", "down"); await sleep(400); if (view === "month") { await requireTestAccount(); run("key", "down"); await sleep(400); } await requireTestAccount(); run("key", "ret"); await sleep(4000); }
          await dbg("4-final"); }
        return;
      }
      if (base.startsWith("/player")) {
        await requireTestAccount();
        const mediaFileId = process.env.PLAYARR_DEVICE_TEST_DIRECT_PLAY_MEDIA_ID ?? "";
        if (!hasDirectPlayMediaId(mediaFileId)) {
          throw new Error("refusing player-controls capture: provide a valid explicit direct-play media file ID");
        }
        const playerNonce = randomUUID();
        run("write", "parity.play", `fixture:${mediaFileId}:${playerNonce}`);
        await until((t) => {
          const result = directPlayerProbeResult(t, playerNonce);
          if (result === "unavailable" || result.startsWith("fixture-") || result === "not-direct") {
            throw new Error(`refusing player-controls capture: direct-play fixture check returned ${result}`);
          }
          return result === "ready" && t.play === "playing";
        }, 90, "the pinned direct-play fixture to start");
        await requireTestAccount(); run("write", "parity.pause", "2");
        const pauseDeadline = Date.now() + 20000;
        let playerTrace = trace();
        while (Date.now() < pauseDeadline) {
          const result = playerCaptureProbeResult(playerTrace, playerNonce);
          if (result === "ready") return;
          if (result === "seek-timeout") {
            throw new Error(`refusing player-controls capture: native seek did not settle (${playerCaptureSummary(playerTrace)})`);
          }
          await sleep(700);
          playerTrace = trace();
        }
        throw new Error(`timed out waiting for the direct-play fixture at the canonical capture position (${playerCaptureSummary(playerTrace)})`);
      }
      const lib = base.split("/").slice(0, 2).join("/");
      if (!RAIL[lib]) throw new Error(`no route for ${path}`);
      const kind = expectedLibraryKind(lib);
      await click(...RAIL[lib], 25);
      if (kind) {
        const focusDeadline = Date.now() + 30000;
        let libraryTrace = trace();
        while (Date.now() < focusDeadline && !libraryFocusReady(libraryTrace, kind)) {
          await sleep(500);
          libraryTrace = trace();
        }
        if (!libraryFocusReady(libraryTrace, kind)) {
          throw new Error(`refusing library capture before initial grid focus is ready (${libraryFocusSummary(libraryTrace)})`);
        }
      }
      if (/^\/(movies|series)\/[^/]+\/?$/.test(base) || base.endsWith("/:id")) await click(...FIRST_CARD, 8);
      else if (base.startsWith("/player")) throw new Error("player-controls requires the guarded direct-play route");
      else if (query?.includes("panel=filters")) await click(1877, 187, 3);
    },
    async key(name, { long } = {}) {
      await requireTestAccount();
      run("key", long ? "shift+f10" : KEYS[name]);
      // A page opened with select loads its grid over the network: give it time before the next key.
      await sleep(name === "select" && !long ? 9000 : 1200);
    },
    async location() { return location(); },
    async focused() { const t = trace(); return t.focus && t.position ? { label: t.focus, position: t.position } : (t.focus ?? null); },
    async screenshot(file) {
      await requireTestAccount();
      const t = trace();
      if (t.screen === "pairing" || t.play === "error") throw new Error("signed out or error screen");
      if (theme && t.screen !== "playback" && !themeCaptureAllowed(t, theme)) throw new Error(`refusing Xbox parity capture: ${theme} theme was not confirmed by the app`);
      run("move", 1919, 600); await sleep(500);
      await requireTestAccount();
      mkdirSync(dirname(file), { recursive: true });
      // Luminance guard (exit 4 from the helper): a light frame is refused in a dark run and the reverse. The player is black in both.
      run("shot", file, ...(theme && t.screen !== "playback" ? [theme] : []));
      writeFileSync(file.replace(/\.png$/i, ".trace.json"), `${JSON.stringify(focusCaptureSidecar(t), null, 2)}\n`);
    },
    // Plays media file `c.file` through the app's parity.play request; judged from the player's own position.
    async play(c, expect) {
      await requireTestAccount();
      await this.home();
      await requireTestAccount();
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
      await requireTestAccount(); run("key", "esc"); await sleep(1500);
      return { state: p1.play === "playing" && advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: advanced };
    },
  };
}
