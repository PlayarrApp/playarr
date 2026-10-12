// iPhone and iPad simulator driver for the shared parity suite (docs/parity/SUITE.md), run with `--via route` and
// `--only screens,playback` (touch devices have no D-pad). Runs on a GitHub-hosted macOS runner next to
// scripts/apple-wall/wall.sh (WORK/state.env holds the simulator's UDID and the app's bundle id).
//   env: WORK, DEVICE (iphone|ipad), SERVER_URL, TEST_USERNAME, TEST_PASSWORD
// The debug app signs in and opens a screen from launch arguments (clients/ios ParityLaunch.swift) and writes
// Documents/parity-state.json (signedIn, playback). A launch costs seconds, so route() only records the suite route and
// screenshot() launches the native screen named by the file (suite ids are unique, routes are not: actions and movies).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const NATIVE = { "film-detail": "detail:movie:@first", "series-detail": "detail:series:@first", "player-controls": "player:movie:@first" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function readState(work) {
  const env = {};
  const f = join(work, "state.env");
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/\\(.)/g, "$1"); }
  return env;
}

// Watch progress on the shared account changes Home and detail: put the pinned files back to unwatched.
async function resetProgress(files) {
  const e = process.env, server = e.SERVER_URL.replace(/\/$/, "");
  const post = (path, method, body, token) => fetch(server + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const login = await post("/api/v1/auth/login", "POST", { client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-reset", username: e.TEST_USERNAME, password: e.TEST_PASSWORD });
  if (!login.ok) { console.log(`  progress reset: login ${login.status}`); return; }
  const token = (await login.json()).access_token;
  for (const f of files) {
    const r = await post(`/api/v1/playback/${f}/progress`, "PUT", { position_ms: 0, duration_ms: 6454000, completed: false }, token);
    console.log(`  progress reset ${f.slice(0, 8)}: ${r.status}`);
  }
}

export async function createDriver() {
  const device = process.env.DEVICE;
  if (device !== "iphone" && device !== "ipad") throw new Error(`apple-ios driver: ${device} is not an iPhone or iPad`);
  const work = process.env.WORK, st = readState(work), udid = st.UDID, bundle = st.BUNDLE;
  if (!udid || !bundle) throw new Error("no simulator in WORK/state.env: run wall.sh up first");
  const e = process.env;
  let theme = "dark", wanted = "/";
  const statePath = () => join(run("xcrun", ["simctl", "get_app_container", udid, bundle, "data"]).trim(), "Documents", "parity-state.json");
  const state = () => { try { return JSON.parse(readFileSync(statePath(), "utf8")); } catch { return {}; } };
  const launch = async (route, extra = []) => {
    try { run("xcrun", ["simctl", "terminate", udid, bundle]); } catch { /* not running */ }
    try { rmSync(statePath(), { force: true }); } catch { /* no container yet */ }
    run("xcrun", ["simctl", "ui", udid, "appearance", theme]);
    run("xcrun", ["simctl", "launch", udid, bundle, "-PlayarrMuted", "--playarr-parity-server", e.SERVER_URL, "--playarr-parity-user", e.TEST_USERNAME,
      "--playarr-parity-password", e.TEST_PASSWORD, "--playarr-parity-route", route, "--playarr-parity-theme", theme,
      ...(device === "ipad" ? ["--playarr-parity-landscape"] : []), ...extra]);
    for (let i = 0; i < 60 && !state().signedIn; i += 1) await sleep(1000);
    if (!state().signedIn) throw new Error("signed out");
  };
  return {
    async start() {
      run("xcrun", ["simctl", "status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3"]);
      await resetProgress(["b9a68b2c-8382-4c34-a6f0-c4dd58f55093", "c9a9f905-3037-4bd7-9c73-2250e8aa347d"]);
    },
    async stop() {},
    async setTheme(t) { theme = t; },
    async home() { wanted = "/"; },
    async route(r) { wanted = r; },
    async key() { throw new Error("touch device: no D-pad"); },
    async location() { return wanted; },
    async focused() { return null; },
    async screenshot(file) {
      const id = basename(file, ".png");
      await launch(NATIVE[id] ?? id);
      await sleep(id.startsWith("player") ? 30000 : 14000);
      const raw = device === "ipad" ? `${file}.raw.png` : file;
      run("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", raw]);
      if (device === "ipad") { run("sips", ["-r", "90", raw, "--out", file]); rmSync(raw); } // the iPad frame is landscape
      if (!existsSync(file) || statSync(file).size < 20000) throw new Error("empty frame");
    },
    // Cases a-c: launch straight into the player on the media file and read the engine state the app writes.
    async play(c, expect) {
      // A cold transcode or a pod restart: re-run; a full transcode node (other devices play at the same time) waits and retries.
      let r;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        r = await this.playOnce(c, expect);
        if (r.state === "playing") return r;
        await sleep(/capacity|503/i.test(r.detail ?? "") ? 60000 : 30000); // 404s and stalls come from pod restarts and busy nodes
      }
      return r;
    },
    async playOnce(c, expect) {
      const t0 = Date.now();
      await launch("play", ["--playarr-parity-play", c.file]);
      let start = null, p0 = null, last = {};
      while ((Date.now() - t0) / 1000 < expect.startWithinSeconds + 15) {
        last = state().playback ?? {};
        if (last.state === "failed") {
          // Diagnosis: the app's own recent log lines about HTTP errors (query strings, which may hold tokens, are cut).
          try { console.log(run("sh", ["-c", `xcrun simctl spawn ${udid} log show --last 1m --style compact --predicate 'processImagePath CONTAINS "PlayarrApp"' | grep -i -E '404|not found|http|error' | sed -E 's/[?][^ ]*//g' | tail -n 12`]).slice(0, 2500)); } catch { /* no log */ }
          await resetProgress([c.file]); return { state: "error", detail: last.detail || "the player reported a failure" }; }
        if (last.state === "playing" && last.position > 0) { start = (Date.now() - t0) / 1000; p0 = last.position; break; }
        await sleep(1000);
      }
      if (start === null) { await resetProgress([c.file]); return { state: "stalled", detail: "playback did not start", startSeconds: (Date.now() - t0) / 1000 }; }
      await sleep((expect.advanceSeconds + 2) * 1000);
      last = state().playback ?? {};
      const advanced = last.position - p0;
      try { run("xcrun", ["simctl", "terminate", udid, bundle]); } catch { /* gone */ }
      await resetProgress([c.file]);
      return { state: last.state === "playing" && advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds: start, advancedSeconds: advanced };
    },
  };
}
