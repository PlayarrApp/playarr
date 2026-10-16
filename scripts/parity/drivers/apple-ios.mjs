// iPhone and iPad simulator driver for the shared parity suite (docs/parity/SUITE.md), run with `--via route` and
// `--only screens,playback` (touch devices have no D-pad). Runs on a GitHub-hosted macOS runner next to
// scripts/apple-wall/wall.sh (WORK/state.env holds the simulator's UDID and the app's bundle id).
//   env: WORK, DEVICE (iphone|ipad), SERVER_URL, TEST_USERNAME, TEST_PASSWORD, DEVICE_TEST_USERNAME
// The debug app signs in and opens a screen from launch arguments (clients/ios ParityLaunch.swift) and writes
// Documents/parity-state.json (signedIn, identity, readiness and playback state). Suite route ids can be ambiguous,
// so screenshot() maps the suite screen id to its native route and pinned fixture.
import { execFileSync } from "node:child_process";
import { hasApprovedDeviceTestIdentity } from "../device-test-identity.mjs";
import { captureStableFrame } from "../apple/capture-stability.mjs";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const suite = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "suite.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });

export function assertCaptureState(state, expectedUsername, { player = false, deterministic = false, fixedNow = null } = {}) {
  if (state.failure) throw new Error(`iOS parity app failed: ${String(state.failure)}`);
  if (state.signedIn !== true || state.identityVerified !== true || state.deviceTestIdentityVerified !== true) throw new Error("iOS parity app has not verified the signed-in test profile");
  if (!expectedUsername || String(state.authenticatedUsername ?? "").toLocaleLowerCase() !== expectedUsername.toLocaleLowerCase()) {
    throw new Error("iOS parity app authenticated username does not match DEVICE_TEST_USERNAME");
  }
  if (state.screenContentReady !== true) throw new Error("iOS parity app has not reported screen content ready");
  if (player && state.directPlay !== true) throw new Error("iOS parity app did not confirm direct play for the pinned fixture");
  if (deterministic) {
    if (state.animationsDisabled !== true) throw new Error("iOS parity app did not confirm SwiftUI animations are disabled");
    if (!fixedNow || !state.frozenNow || Date.parse(state.frozenNow) !== Date.parse(fixedNow)) throw new Error("iOS parity app did not confirm the requested fixed capture clock");
  }
}

export function assertResetProfile(profiles, loginUserID, expectedUsername) {
  if (!Array.isArray(profiles)) throw new Error("profile verification returned invalid data");
  const current = profiles.filter((profile) => profile?.is_current === true);
  if (current.length !== 1 || !loginUserID || String(current[0]?.id).toLowerCase() !== String(loginUserID).toLowerCase()
    || String(current[0]?.username ?? "").toLocaleLowerCase() !== String(expectedUsername ?? "").toLocaleLowerCase()) {
    throw new Error("progress reset refused: authenticated profile is not the expected current Device Test profile");
  }
}

export function assertScreenshotFile(file) {
  if (!existsSync(file) || statSync(file).size < 20000) throw new Error("empty frame");
}

function digestTree(path) {
  const hash = createHash("sha256");
  const visit = (entry, relative = "") => {
    const st = lstatSync(entry);
    if (st.isDirectory()) {
      hash.update(`D\0${relative}\0`);
      for (const name of readdirSync(entry).sort()) visit(join(entry, name), relative ? `${relative}/${name}` : name);
    } else if (st.isFile()) {
      hash.update(`F\0${relative}\0`);
      hash.update(readFileSync(entry));
    } else if (st.isSymbolicLink()) {
      hash.update(`L\0${relative}\0${readlinkSync(entry)}\0`);
    } else throw new Error(`unsupported installed app entry: ${relative}`);
  };
  visit(path);
  return hash.digest("hex");
}

function readState(work) {
  const env = {};
  const f = join(work, "state.env");
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/\\(.)/g, "$1"); }
  return env;
}

// Watch progress on the shared account changes Home and detail: put the pinned files back to unwatched.
export async function resetProgressOnce(files, { env = process.env, fetchImpl = fetch } = {}) {
  const e = env, server = e.SERVER_URL?.replace(/\/$/, "");
  if (!server || !e.TEST_USERNAME || !e.TEST_PASSWORD || !hasApprovedDeviceTestIdentity(e, e.TEST_USERNAME)) throw new Error("iOS progress reset requires the approved test account configuration");
  const post = async (path, method, body, token) => {
    try { return await fetchImpl(server + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: "error" }); }
    catch { throw new Error("iOS progress reset request failed due to a network error"); }
  };
  const login = await post("/api/v1/auth/login", "POST", { client_platform: "web", client_version: "parity", device_id: randomUUID(), device_name: "parity-reset", username: e.TEST_USERNAME, password: e.TEST_PASSWORD });
  if (!login.ok) throw new Error(`iOS progress reset login failed with status ${login.status}`);
  let session;
  try { session = await login.json(); } catch { throw new Error("iOS progress reset login returned an invalid response"); }
  const token = session.access_token;
  if (typeof token !== "string" || !token) throw new Error("iOS progress reset login returned no access token");
  let profilesResponse;
  try { profilesResponse = await fetchImpl(`${server}/api/v1/users/profiles`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: "error" }); }
  catch { throw new Error("iOS progress reset request failed due to a network error"); }
  if (!profilesResponse.ok) throw new Error(`iOS progress reset profile verification failed with status ${profilesResponse.status}`);
  let profiles;
  try { profiles = await profilesResponse.json(); } catch { throw new Error("iOS progress reset profile verification returned an invalid response"); }
  assertResetProfile(profiles, session.user_id, e.DEVICE_TEST_USERNAME);
  for (const f of files) {
    const r = await post(`/api/v1/playback/${f}/progress`, "PUT", { position_ms: 0, duration_ms: 6454000, completed: false }, token);
    if (!r.ok) throw new Error(`iOS progress reset failed with status ${r.status}`);
  }
}

export async function createDriver() {
  const device = process.env.DEVICE;
  if (device !== "iphone" && device !== "ipad") throw new Error(`apple-ios driver: ${device} is not an iPhone or iPad`);
  const work = process.env.WORK, st = readState(work), udid = st.UDID, bundle = st.BUNDLE;
  if (!udid || !bundle) throw new Error("no simulator in WORK/state.env: run wall.sh up first");
  const e = process.env;
  const expectedUsername = e.DEVICE_TEST_USERNAME;
  if (!hasApprovedDeviceTestIdentity(e, e.TEST_USERNAME) || !expectedUsername || e.TEST_USERNAME.toLocaleLowerCase() !== expectedUsername.toLocaleLowerCase()) throw new Error("apple-ios driver: launch account is not the approved Device Test account");
  let theme = "dark", wanted = "/";
  const fixtureNow = run("node", [join(dirname(fileURLToPath(import.meta.url)), "../apple/fixture-clock.mjs")]).trim();
  let captureNow = device === "ipad" ? (e.PARITY_CAPTURE_NOW || fixtureNow) : (e.PARITY_FIXED_NOW || e.PARITY_CAPTURE_NOW || fixtureNow);
  const captureTimezone = e.PARITY_CAPTURE_TIMEZONE || "UTC";
  let deterministicCapture = e.PARITY_CAPTURE_DETERMINISTIC === "1", fixedNow = captureNow;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(captureNow) || !Number.isFinite(Date.parse(captureNow)) || new Date(captureNow).toISOString() !== (captureNow.includes(".") ? captureNow : `${captureNow.slice(0, -1)}.000Z`)) throw new Error("PARITY_CAPTURE_NOW must be a valid UTC timestamp");
  try { new Intl.DateTimeFormat("en", { timeZone: captureTimezone }); } catch { throw new Error("PARITY_CAPTURE_TIMEZONE must be a valid time zone"); }
  if (deterministicCapture && (!fixedNow || Number.isNaN(Date.parse(fixedNow)))) throw new Error("PARITY_CAPTURE_DETERMINISTIC requires a valid PARITY_FIXED_NOW instant");
  const dataContainer = run("xcrun", ["simctl", "get_app_container", udid, bundle, "data"]).trim();
  if (!dataContainer) throw new Error("simulator did not return the iOS app data container");
  const statePath = () => join(dataContainer, "Documents", "parity-state.json");
  const state = () => { try { return JSON.parse(readFileSync(statePath(), "utf8")); } catch (error) { if (error.code === "ENOENT") return {}; throw error; } };
  const terminate = () => {
    try { run("xcrun", ["simctl", "terminate", udid, bundle]); }
    catch (error) {
      const detail = String(error.stderr ?? error.message);
      if (!/not running|no matching processes/i.test(detail)) throw error;
    }
  };
  let launchedAt = "";
  const launch = async (route, extra = [], enableLayoutDiagnostics = false) => {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    launchedAt = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; // local time, as `log show --start` reads it
    terminate();
    rmSync(statePath(), { force: true });
    run("xcrun", ["simctl", "ui", udid, "appearance", theme]);
    const launchEnv = { ...process.env,
      SIMCTL_CHILD_PLAYARR_PARITY_SERVER: e.SERVER_URL,
      SIMCTL_CHILD_PLAYARR_PARITY_USER: e.TEST_USERNAME,
      SIMCTL_CHILD_PLAYARR_PARITY_PASSWORD: e.TEST_PASSWORD,
      SIMCTL_CHILD_PLAYARR_PARITY_EXPECTED_USERNAME: expectedUsername,
      ...(deterministicCapture ? { SIMCTL_CHILD_PLAYARR_PARITY_DISABLE_ANIMATIONS: "1" } : {}),
    };
    delete launchEnv.SIMCTL_CHILD_PLAYARR_LAYOUT_DIAGNOSTICS;
    if (device === "ipad" && enableLayoutDiagnostics) launchEnv.SIMCTL_CHILD_PLAYARR_LAYOUT_DIAGNOSTICS = "1";
    run("xcrun", ["simctl", "launch", udid, bundle, "-PlayarrMuted", "--playarr-parity-route", route, "--playarr-parity-theme", theme,
      "--playarr-parity-now", captureNow, "--playarr-parity-timezone", captureTimezone,
      ...(device === "ipad" ? ["--playarr-parity-landscape"] : []), ...(process.env.PARITY_FOCUS ? ["--playarr-parity-focus", process.env.PARITY_FOCUS] : []),
      ...(process.env.PARITY_MOTION === "1" ? ["--playarr-parity-motion"] : []), ...(process.env.PARITY_COVERS === "1" ? ["--playarr-parity-covers"] : []), ...(process.env.PARITY_SIZE ? ["--playarr-parity-size", process.env.PARITY_SIZE] : []), ...extra], { env: launchEnv });
    for (let i = 0; i < 60; i += 1) {
      const current = state();
      if (current.failure) throw new Error(`iOS parity app failed: ${String(current.failure)}`);
      if (current.screenContentReady === true) {
        assertCaptureState(current, expectedUsername, { player: route.startsWith("player:"), deterministic: deterministicCapture, fixedNow });
        return;
      }
      await sleep(1000);
    }
    const finalState = state();
    if (finalState.failure) throw new Error(`iOS parity app failed: ${String(finalState.failure)}`);
    if (finalState.screenContentReady === true) {
      assertCaptureState(finalState, expectedUsername, { player: route.startsWith("player:"), deterministic: deterministicCapture, fixedNow });
      return;
    }
    throw new Error("iOS parity screen readiness timed out after 60 seconds");
  };
  let seq = 0, touched = new Set();
  const cmd = (action, m, extra = {}) => { // the debug app polls Documents/parity-cmd.json (ParityDownloads.swift)
    if (m.file) touched.add(m.file);
    const episode = m.season ? { kind: "series", series: m.title, season: m.season, episode: m.episode } : { kind: "movie" };
    writeFileSync(join(statePath(), "..", "parity-cmd.json"), JSON.stringify({ seq: (seq += 1), action, file: m.file, work: m.work, title: m.title, ...(action === "start" ? episode : {}), ...extra }));
  };
  // The server's download options for a file (its quality profiles), to pick a quality other than the current one.
  const optionProfiles = async (file) => {
    const server = process.env.SERVER_URL.replace(/\/$/, "");
    const post = (path, body, token) => fetch(server + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const login = await post("/api/v1/auth/login", { client_platform: "ios", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-options", username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD });
    const token = (await login.json()).access_token;
    const r = await fetch(`${server}/api/v1/media/${file}/download-options`, { headers: { authorization: `Bearer ${token}` } });
    return ((await r.json()).options ?? []).map((o) => o.profile ?? null);
  };
  const rec = (m) => (state().downloads ?? []).find((d) => d.file.toLowerCase() === m.file.toLowerCase());
  const until = async (m, ok, seconds) => {
    for (let t = 0; t < seconds; t += 2) { const d = rec(m); if (d?.state === "failed") return { state: "failed", detail: d.error || "download failed" }; if (ok(d)) return { state: "ok" }; await sleep(2000); }
    return { state: "failed", detail: `timed out after ${seconds} s: ${JSON.stringify(rec(m) ?? null)}` };
  };
  return {
    async setDeterministicCapture({ fixedNow: now, disableAnimations } = {}) {
      if (disableAnimations !== true) throw new Error("iOS deterministic capture requires disableAnimations: true");
      if (!now || Number.isNaN(Date.parse(now))) throw new Error("iOS deterministic capture requires a valid fixedNow instant");
      deterministicCapture = true;
      captureNow = fixedNow = now;
    },
    async captureBuildIdentity() {
      const app = run("xcrun", ["simctl", "get_app_container", udid, bundle, "app"]).trim();
      if (!app || !existsSync(app)) throw new Error("installed iOS app bundle is unavailable for build identity");
      return { platform: "ios-simulator", bundle, sha256: digestTree(app) };
    },
    async waitReady({ screen, phase = "capture" } = {}) {
      if (!["route", "capture", "focus"].includes(phase)) throw new Error(`unsupported iOS readiness phase: ${phase}`);
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const current = state();
        if (current.failure) throw new Error(`iOS parity app failed: ${String(current.failure)}`);
        if (current.screenContentReady === true) {
          assertCaptureState(current, expectedUsername, { player: screen === "player-controls", deterministic: deterministicCapture, fixedNow });
          return;
        }
        await sleep(500);
      }
      const finalState = state();
      if (finalState.failure) throw new Error(`iOS parity app failed: ${String(finalState.failure)}`);
      if (finalState.screenContentReady === true) {
        assertCaptureState(finalState, expectedUsername, { player: screen === "player-controls", deterministic: deterministicCapture, fixedNow });
        return;
      }
      throw new Error(`iOS parity ${phase} readiness timed out for ${screen}`);
    },
    async playerReady() { await this.waitReady({ screen: "player-controls", phase: "capture" }); },
    supports: { downloads: true, "grouped-downloads": true }, // no notifications: the app posts none
    async cleanupDownloads() { for (const file of touched) { try { cmd("cancel", { file }); await sleep(1500); } catch { /* app gone */ } } },
    async download(c, expect) {
      const m = c.media;
      const current = state();
      if (current.signedIn !== true || current.identityVerified !== true || current.deviceTestIdentityVerified !== true
        || String(current.authenticatedUsername ?? "").toLocaleLowerCase() !== expectedUsername.toLocaleLowerCase()) await launch("home");
      assertCaptureState(state(), expectedUsername, { deterministic: deterministicCapture, fixedNow });
      const within = expect.withinSeconds;
      const start = async () => { cmd("start", m); return until(m, (d) => !!d, 60); };
      const done = (d) => d?.state === "completed";
      let r;
      switch (c.action) {
        case "start": r = await start(); if (r.state === "ok") r = await until(m, done, within); cmd("delete", m); return r;
        case "pause-resume": r = await start(); if (r.state !== "ok") return r;
          r = await until(m, (d) => d.state === "downloading" && d.bytes > 0, 120); if (r.state !== "ok") return r;
          cmd("pause", m); r = await until(m, (d) => d.state === "paused", 30); if (r.state !== "ok") return r;
          cmd("resume", m); r = await until(m, done, within); cmd("delete", m); return r;
        case "cancel": r = await start(); if (r.state !== "ok") return r;
          r = await until(m, (d) => d.state === "downloading" && d.bytes > 0, 120); if (r.state !== "ok") return r;
          cmd("cancel", m); return until(m, (d) => !d, 30);
        case "delete": r = await start(); if (r.state === "ok") r = await until(m, done, within); if (r.state !== "ok") { cmd("delete", m); return r; }
          cmd("delete", m); return until(m, (d) => !d, 30);
        case "offline-play": r = await start(); if (r.state === "ok") r = await until(m, done, within); if (r.state !== "ok") { cmd("delete", m); return r; }
          // Plays the stored file: the player reads it from the repository before it asks the network (isPlayingLocalFile).
          await launch("play", ["--playarr-parity-play", m.file]);
          for (let t = 0; t < 40; t += 1) { const p = state().playback; if (p?.state === "playing" && p.position > 0) { const p0 = p.position; await sleep(5000); const adv = (state().playback?.position ?? 0) - p0; cmd("delete", m); return adv >= 3 ? { state: "ok", detail: `advanced ${adv.toFixed(1)} s` } : { state: "failed", detail: "frames did not advance" }; } await sleep(1000); }
          cmd("delete", m); return { state: "failed", detail: "the downloaded title did not play" };
        case "edit": { // keep-until now, quality through a new ticket (the repository calls the edit sheet's Save makes)
          r = await start(); if (r.state !== "ok") return r;
          r = await until(m, (d) => d.state === "downloading" && d.bytes > 0, 120); if (r.state !== "ok") { cmd("delete", m); return r; }
          cmd("keep", m, { days: 7 }); r = await until(m, (d) => /afterWatched/.test(d.keep), 30); if (r.state !== "ok") { cmd("delete", m); return { state: "failed", detail: `keep-until did not change: ${r.detail}` }; }
          const other = (await optionProfiles(m.file)).find((p) => p !== null);
          if (other) { cmd("quality", m, { profile: other }); r = await until(m, (d) => d.profile === other && /afterWatched/.test(d.keep), 120); if (r.state !== "ok") r.detail = `quality did not change: ${r.detail}`; }
          cmd("delete", m); return r; }
        case "series-pause": case "season-pause": { // one episode in its series and season, paused through the group call
          r = await start(); if (r.state !== "ok") return r;
          r = await until(m, (d) => d.kind === "series" && d.season === m.season && d.state === "downloading" && d.bytes > 0, 120); if (r.state !== "ok") { cmd("delete", m); return { state: "failed", detail: `episode not grouped or not downloading: ${r.detail}` }; }
          cmd("group", m, { op: "pause", ...(c.action === "season-pause" ? { season: m.season } : {}) });
          r = await until(m, (d) => d.state === "paused", 30); cmd("delete", m); return r; }
        case "series-delete": case "season-delete": {
          r = await start(); if (r.state === "ok") r = await until(m, done, within); if (r.state !== "ok") { cmd("delete", m); return r; }
          cmd("group", m, { op: "delete", ...(c.action === "season-delete" ? { season: m.season } : {}) });
          return until(m, (d) => !d, 30); }
        case "notification": return { state: "failed", detail: "iOS posts no download notification yet" };
        default: return { state: "failed", detail: `unknown action ${c.action}` };
      }
    },
    async start() {
      run("xcrun", ["simctl", "status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3"]);
      if (device !== "ipad") await resetProgressOnce([...new Set([...(suite.performance ?? []).map((p) => p.file), ...Object.values(suite.downloadMedia ?? {}).map((m) => m.file)])]);
      await launch("home");
    },
    async stop() {},
    async setTheme(t) { theme = t; },
    async home() { wanted = "/"; await launch("home"); },
    async route(r) {
      wanted = r;
      const screen = suite.screens.find((candidate) => candidate.open === r || candidate.route === r
        || (candidate.route.endsWith("/:id") && r.startsWith(candidate.route.slice(0, -4))));
      if (!screen) throw new Error(`iOS parity route is not mapped to a suite screen: ${r}`);
      let nativeRoute = screen.id;
      const detail = /^\/(movies|series)\/([0-9a-f-]{36})$/.exec(r);
      if (detail) nativeRoute = `detail:${detail[1] === "movies" ? "movie" : "series"}:id=${detail[2]}`;
      const fixture = suite.performance?.[0]?.file;
      if (screen.id === "player-controls" && !fixture) throw new Error("iOS player-controls capture has no pinned direct-play fixture in suite.json");
      if (screen.id === "player-controls") nativeRoute = `player:movie:${fixture}`;
      const extra = screen.id === "player-controls" ? ["--playarr-parity-play", fixture] : [];
      await launch(nativeRoute, extra);
    },
    async key() { throw new Error("touch device: no D-pad"); },
    async location() { return wanted; },
    async focused() { return null; },
    async screenshot(file) {
      const id = basename(file, ".png");
      // Opt-in: the geometry markers are collected only when IPAD_LAYOUT_DIAGNOSTICS=true; a normal capture never fails on them.
      const layoutDiagnostics = process.env.IPAD_LAYOUT_DIAGNOSTICS === "true" && device === "ipad" && id === "series-detail";
      if (!suite.screens.some((screen) => screen.id === id)) throw new Error(`iOS capture screen is not in suite.json: ${id}`);
      const detail = /^\/(movies|series)\/([0-9a-f-]{36})$/.exec(wanted);
      const fixture = suite.performance?.[0]?.file;
      if (id === "player-controls" && !fixture) throw new Error("iOS player-controls capture has no pinned direct-play fixture in suite.json");
      const nativeRoute = detail ? `detail:${detail[1] === "movies" ? "movie" : "series"}:id=${detail[2]}`
        : id === "player-controls" ? `player:movie:${fixture}` : id;
      const extra = id === "player-controls" ? ["--playarr-parity-play", fixture] : [];
      await launch(nativeRoute, extra, layoutDiagnostics);
      await this.waitReady({ screen: id, phase: "capture" });
      if (process.env.PARITY_MOTION === "1" && id === "home") { // frame bursts: 5 frames about 150 ms apart after every scripted step
        const dir = `${file}.motion`; run("mkdir", ["-p", dir]);
        let seen = 0;
        for (let t = 0; t < 300 && !state().motionDone; t += 1) {
          const step = state().motionStep ?? 0;
          if (step > seen) { seen = step; for (let i = 0; i < 5; i += 1) { run("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", join(dir, `step-${String(step).padStart(2, "0")}-${i}.png`)]); await sleep(150); } }
          else await sleep(400);
        }
        if (!state().motionDone) throw new Error("iOS scripted Home motion timed out before completion");
      }
      const raw = device === "ipad" ? `${file}.raw.png` : file;
      // Wait for two byte-identical frames so the capture contains the settled screen.
      await captureStableFrame(async () => {
        run("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", raw]);
        return readFileSync(raw);
      }, { attempts: 8, intervalMs: 4000, wait: sleep });
      if (device === "ipad") { run("sips", ["-r", "90", raw, "--out", file]); rmSync(raw); } // the iPad frame is landscape
      assertScreenshotFile(file);
      if (layoutDiagnostics) {
        const diagnostics = run("xcrun", ["simctl", "spawn", udid, "log", "show", "--info", "--start", launchedAt, "--style", "compact",
          "--predicate", 'eventMessage CONTAINS "PLAYARR_IOS_TITLE_LAYOUT_DIAGNOSTIC"']);
        const requiredMarkers = [
          "element=kicker",
          "element=title stage=natural",
          "element=title stage=adjusted",
          "element=subtitle",
          "element=metadata",
          "element=synopsis",
          "element=actions",
        ];
        const diagnosticLines = diagnostics.split("\n");
        const markerLines = requiredMarkers.map((marker) => [...diagnosticLines].reverse().find((line) =>
          line.includes("PLAYARR_IOS_TITLE_LAYOUT_DIAGNOSTIC") && line.includes(`theme=${theme}`) && line.includes(marker)
        )).filter(Boolean);
        const sidecar = markerLines.join("\n").slice(-4000);
        writeFileSync(`${file}.layout-diagnostic.log`, sidecar);
        if (!sidecar || requiredMarkers.some((marker) => !sidecar.includes(marker))) {
          throw new Error("tablet detail geometry diagnostics are incomplete for the current theme");
        }
      }
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
      await launch("play", ["--playarr-parity-play", c.file]); // app start and sign-in are not playback time
      const t0 = Date.now();
      let start = null, p0 = null, last = {};
      while ((Date.now() - t0) / 1000 < expect.startWithinSeconds + 15) {
        last = state().playback ?? {};
        if (last.state === "failed") {
          // Diagnosis: the app's own recent log lines about HTTP errors (query strings, which may hold tokens, are cut).
          try { console.log(run("sh", ["-c", `xcrun simctl spawn ${udid} log show --last 1m --style compact --predicate 'processImagePath CONTAINS "PlayarrApp"' | grep -i -E '404|not found|http|error' | sed -E 's/[?][^ ]*//g' | tail -n 12`]).slice(0, 2500)); } catch { /* no log */ }
          await resetProgressOnce([c.file]); return { state: "error", detail: last.detail || "the player reported a failure" }; }
        if (last.state === "playing" && last.position > 0) { start = (Date.now() - t0) / 1000; p0 = last.position; break; }
        await sleep(1000);
      }
      if (start === null) { await resetProgressOnce([c.file]); return { state: "stalled", detail: "playback did not start", startSeconds: (Date.now() - t0) / 1000 }; }
      await sleep((expect.advanceSeconds + 2) * 1000);
      last = state().playback ?? {};
      const advanced = last.position - p0;
      terminate();
      await resetProgressOnce([c.file]);
      return { state: last.state === "playing" && advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds: start, advancedSeconds: advanced };
    },
  };
}
