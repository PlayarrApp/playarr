// Suite driver for the Sailfish OS client on the SDK emulator (or a device) reached over ssh. Contract: docs/parity/SUITE.md.
//   PLAYARR_SF_SSH_KEY (private key), PLAYARR_SF_SSH_PORT (default 2223), PLAYARR_SF_SSH_HOST (default 127.0.0.1),
//   PLAYARR_SF_VNC_HELPER (credential-safe wrapper accepting `sailfish <vncdo args...>`).
// D-pad checks send keys through VNC and read the app's QML focus and route telemetry.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appIdentityReceipt, cleanupAppProcessScript, newProcessMarker, parseAppProcesses, requireSingleAppProcess, scanAppProcessesScript } from "./process.mjs";
import { formatOwnedDiagnostics, ownedDiagnosticCommand, preserveBeforeCleanup, requireRouteReady, routeReadinessProbe, readOwnedRouteLog, serializeSteps } from "./route-readiness.mjs";
import { detailRouteRequest } from "./detail-route.mjs";
import { keyCommand, parseParityEvents, decodeFocus, hasKeyAckPair, hasKeyCompletion, nextKeyAckPress } from "./navigation.mjs";
import { verifiedDeviceTestUser as matchesDeviceTestUser } from "./account-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = "file:///usr/share/harbour-playarr/qml/pages";
const readParityLog = (ssh, identity) => identity ? readOwnedRouteLog(ssh, identity) : "";

export async function createDriver() {
  const env = process.env;
  const host = env.PLAYARR_SF_SSH_HOST ?? "127.0.0.1", port = env.PLAYARR_SF_SSH_PORT ?? "2223";
  const sshArgs = ["-i", env.PLAYARR_SF_SSH_KEY, "-p", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
  const ssh = (user, cmd) => execFileSync("ssh", [...sshArgs, `${user}@${host}`, cmd], { encoding: "utf8", timeout: 60000 });
  const scratchRoot = env.PLAYARR_SF_SCRATCH;
  if (!scratchRoot) throw new Error("PLAYARR_SF_SCRATCH must point to the task scratch directory");
  mkdirSync(scratchRoot, { recursive: true });
  const tmp = mkdtempSync(join(scratchRoot, "10622-navigation-driver-"));
  let theme = "dark";
  let ownedProcess = null;
  let verifiedDeviceTestUser = false;
  let diagnosticSequence = 0;
  let identitySequence = 0;

  function preserveOwnedDiagnostics(identity) {
    const response = ssh("root", ownedDiagnosticCommand(identity));
    const configuredSecrets = Object.entries(env)
      .filter(([name, value]) => value && /(TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL)/i.test(name))
      .map(([, value]) => value);
    if (env.PLAYARR_SF_PLAYER_FILE) configuredSecrets.push(env.PLAYARR_SF_PLAYER_FILE);
    const body = formatOwnedDiagnostics(response, identity, configuredSecrets);
    const path = join(tmp, `owned-diagnostics-${String(++diagnosticSequence).padStart(3, "0")}.log`);
    writeFileSync(path, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    return path;
  }

  async function cleanupOwnedProcess() {
    if (!ownedProcess) return;
    const previous = ownedProcess;
    try {
      preserveBeforeCleanup(
        () => preserveOwnedDiagnostics(previous),
        () => ssh("root", cleanupAppProcessScript(previous)),
      );
    } finally { ownedProcess = null; }
  }
  // Restart the app with a smoke script; every run starts with the theme so it holds without a stored preference.
  const launch = async (steps, detail = null) => {
    const marker = newProcessMarker();
    const resolvedSteps = typeof steps === "function" ? steps(marker) : steps;
    const checkedSteps = detail ? [...resolvedSteps, ...Array(8).fill(routeReadinessProbe(marker, detail.kind, detail.id))] : resolvedSteps;
    const script = serializeSteps(theme, checkedSteps);
    writeFileSync(join(tmp, "steps"), script);
    execFileSync("scp", ["-i", env.PLAYARR_SF_SSH_KEY, "-P", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", join(tmp, "steps"), `defaultuser@${host}:/run/user/100000/pa-steps.txt`]);
    await cleanupOwnedProcess();
    const existing = parseAppProcesses(ssh("root", scanAppProcessesScript(marker)), marker);
    if (existing.length) {
      for (const process of existing) {
        const receipt = appIdentityReceipt(process);
        const receiptPath = join(tmp, `prelaunch-existing-${String(++identitySequence).padStart(3, "0")}-${process.pid}-${process.starttime}.json`);
        writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        chmodSync(receiptPath, 0o600);
      }
      throw new Error(`Sailfish pre-launch check found ${existing.length} existing app process(es)`);
    }
    ssh("defaultuser", [
      "export XDG_RUNTIME_DIR=/run/user/100000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/100000/dbus/user_bus_socket",
      'export PLAYARR_STEPS="$(cat /run/user/100000/pa-steps.txt)"',
      `setsid nohup invoker --type=silica-qt5 --no-wait /usr/bin/harbour-playarr ${marker} >/run/user/100000/pa.log 2>&1 </dev/null &`,
      "sleep 2"].join("\n"));
    const output = ssh("root", scanAppProcessesScript(marker));
    const processes = parseAppProcesses(output, marker);
    if (processes.length !== 1 || !processes[0].markerPresent) {
      for (const process of processes.filter((candidate) => candidate.markerPresent)) ssh("root", cleanupAppProcessScript(process));
      throw new Error(`Sailfish launch preflight expected one marked app, found ${processes.length}`);
    }
    ownedProcess = requireSingleAppProcess(output, marker);
    const receipt = appIdentityReceipt(ownedProcess);
    const receiptPath = join(tmp, `app-identity-${String(++identitySequence).padStart(3, "0")}.json`);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(receiptPath, 0o600);
  };
  // Player controls use only the explicitly negotiated canonical fixture file.
  const playerTarget = env.PLAYARR_SF_PLAYER_FILE;
  const firstMovie = "pageStack.currentPage.openFirst('movie')";
  const firstSeries = "pageStack.currentPage.openFirst('series')";
  const section = (n) => [`js:pageStack.currentPage.section='${n}'`];
  const calendar = (m) => [`js:Api.setSetting('cal.mode','${m}')`, ...section("calendar")];
  // [steps, seconds to settle] for a web route as the suite names it.
  function plan(route, screenId, marker = "ROUTE") {
    const [path, q] = route.split("?");
    const view = new URLSearchParams(q ?? "").get("view");
    if (screenId === "actions") return [["wait", "wait", `js:pageStack.currentPage.${theme === "light" ? "actionsFirst('movie')" : "actionsHome()"}`], 16];
    if (path === "/") return [["wait"], 12];
    if (path === "/movies" && q?.includes("panel=filters")) return [["wait", ...section("movies"), "wait", `js:pageStack.push('${PAGES}/FiltersPage.qml')`], 16];
    if (path === "/movies") return [["wait", ...section("movies")], 14];
    if (path === "/series") return [["wait", ...section("series")], 14];
    if (path === "/music") return [["wait", ...section("music")], 14];
    if (path === "/search") return [["wait", ...section("search")], 12];
    if (path === "/calendar") return [["wait", ...calendar(view ?? "agenda")], 18];
    const movieId = path.match(/^\/movies\/([^/]+)\/?$/)?.[1];
    if (movieId === ":id") return [["wait", `js:${firstMovie}`], 16];
    if (movieId) return [["wait", detailRouteRequest(movieId, "movie", marker)], 16];
    const seriesId = path.match(/^\/series\/([^/]+)\/?$/)?.[1];
    if (seriesId === ":id") return [["wait", `js:${firstSeries}`], 16];
    if (seriesId) return [["wait", detailRouteRequest(seriesId, "series", marker)], 16];
    if (path === "/settings") return [["wait", ...section("settings")], 12];
    if (path === "/profiles") return [["wait", `js:pageStack.push('${PAGES}/ProfilesPage.qml')`], 12];
    if (path.startsWith("/player/")) {
      if (screenId === "player-controls" && !/^[A-Za-z0-9_-]+$/.test(playerTarget || "")) throw new Error("PLAYARR_SF_PLAYER_FILE must be set to the verified direct-play fixture file ID");
      if (screenId === "player-controls") return [["wait", `js:pageStack.push('${PAGES}/PlayerPage.qml',{mediaFileId:'${playerTarget}',title:'Sample media',startMs:0})`, ...Array(36).fill("wait")], 38];
      throw new Error(`player route requires an explicit verified target: ${route}`);
    }
    throw new Error(`no Sailfish mapping for ${route}`);
  }
  async function goto(route, screenId) {
    if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified");
    const path = route.split("?")[0];
    const movieId = path.match(/^\/movies\/([^/]+)\/?$/)?.[1];
    const seriesId = path.match(/^\/series\/([^/]+)\/?$/)?.[1];
    const detail = movieId ? { kind: "movie", id: movieId === ":id" ? null : movieId } : seriesId ? { kind: "series", id: seriesId === ":id" ? null : seriesId } : null;
    let settle = 16;
    await launch((marker) => {
      const planned = plan(route, screenId, marker);
      settle = planned[1];
      return planned[0];
    }, detail);
    await sleep(settle * 1000);
    if (detail) requireRouteReady(readOwnedRouteLog(ssh, ownedProcess), ownedProcess.marker);
  }
  const vnc = (...args) => {
    if (!env.PLAYARR_SF_VNC_HELPER) throw new Error("PLAYARR_SF_VNC_HELPER must point to the credential-safe VNC wrapper");
    execFileSync(env.PLAYARR_SF_VNC_HELPER, ["sailfish", ...args], { stdio: "ignore" });
  };
  const waitForKeyAcks = async (after) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const events = parseParityEvents(readParityLog(ssh, ownedProcess)).keyAcks;
      const sequence = nextKeyAckPress(events, after);
      if (sequence !== null && hasKeyAckPair(events, sequence, after)) return sequence;
      await sleep(25);
    }
    throw new Error("Sailfish Qt did not acknowledge the press and release of the newly injected key");
  };
  const waitForKeyCompletion = async (sequence) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const events = parseParityEvents(readParityLog(ssh, ownedProcess));
      if (hasKeyCompletion(events.keyCompletions, sequence)) return;
      await sleep(25);
    }
    throw new Error(`Sailfish Qt did not settle navigation for key sequence ${sequence}`);
  };

  // The app's MPRIS entry: a title, status Playing, and Pause from the bus really pauses (then Play resumes).
  function mpris() {
    const bus = "export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/100000/dbus/user_bus_socket";
    const call = (m, args = "") => `dbus-send --session --print-reply --dest=$N /org/mpris/MediaPlayer2 ${m} ${args}`;
    const get = (prop) => call("org.freedesktop.DBus.Properties.Get", `string:org.mpris.MediaPlayer2.Player string:${prop}`);
    try {
      const out = ssh("defaultuser", `${bus}; N=$(dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames | grep -o 'org.mpris.MediaPlayer2.harbour-playarr[^"]*' | head -1); [ -n "$N" ] || exit 3
${get("Metadata")} | grep -A1 xesam:title | tail -1; ${get("PlaybackStatus")} | tail -1
${call("org.mpris.MediaPlayer2.Player.Pause")} >/dev/null; sleep 2; echo AFTER; ${get("PlaybackStatus")} | tail -1
${call("org.mpris.MediaPlayer2.Player.Play")} >/dev/null`);
      const [before, after] = out.split("AFTER");
      const title = (before.match(/string "([^"]*)"/g) || [])[0] ?? "";
      const status = (before.match(/string "(\w+)"/g) || []).at(-1) ?? "";
      const pausedOk = /Paused/.test(after || "");
      return { title, state: status, pausedOk, ok: title.length > 9 && /Playing/.test(status) && pausedOk };
    } catch (e) { return { ok: false, error: String(e.message).split("\n")[0] }; }
  }
  function playerState() {
    return ownedProcess ? parseParityEvents(readParityLog(ssh, ownedProcess)).player : null;
  }

  return {
    async start() {
      verifiedDeviceTestUser = false;
      const expected = env.PLAYARR_DEVICE_TEST_USERNAME;
      if (typeof expected !== "string" || !expected.trim()) throw new Error("PLAYARR_DEVICE_TEST_USERNAME is required to verify the Sailfish signed-in account");
      ssh("defaultuser", "test -s ~/.config/harbour-playarr/harbour-playarr.conf && grep -q refresh ~/.config/harbour-playarr/harbour-playarr.conf");
      await launch(["wait", "js:Api.request('GET','/api/v1/users/profiles',null,function(st,p){var c=(p||[]).filter(function(x){return x.is_current});console.log('PARITY_SIGNED_IN_USER',st,c.length===1&&c[0].username)})"]);
      const deadline = Date.now() + 15000;
      let signedIn = "";
      while (Date.now() < deadline) {
        signedIn = readOwnedRouteLog(ssh, ownedProcess);
        if (/PARITY_SIGNED_IN_USER\s+\d+\s+/.test(signedIn)) {
          if (!matchesDeviceTestUser(signedIn, expected)) throw new Error("Sailfish is signed in as an account other than the configured device-test account");
          verifiedDeviceTestUser = true;
          return;
        }
        await sleep(250);
      }
      throw new Error("Unable to verify Sailfish signed-in account; no capture or D-pad actions permitted");
    },
    async stop() { await cleanupOwnedProcess(); },
    async setTheme(t) { theme = t; },
    async home() { if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified"); await launch(["wait"]); await sleep(12000); },
    async key(name, { long } = {}) {
      if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified");
      const keysym = keyCommand(name);
      const previous = parseParityEvents(readParityLog(ssh, ownedProcess)).keyAcks;
      if (long) {
        vnc("keydown", keysym);
        const pressDeadline = Date.now() + 10000;
        while (Date.now() < pressDeadline) {
          const current = parseParityEvents(readParityLog(ssh, ownedProcess)).keyAcks;
          if (nextKeyAckPress(current, previous.length) !== null) break;
          await sleep(25);
        }
        if (nextKeyAckPress(parseParityEvents(readParityLog(ssh, ownedProcess)).keyAcks, previous.length) === null) {
          throw new Error("Sailfish Qt did not acknowledge the press of the newly injected long key");
        }
        await sleep(800);
        vnc("keyup", keysym);
      } else vnc("key", keysym);
      const sequence = await waitForKeyAcks(previous.length);
      await waitForKeyCompletion(sequence);
    },
    async route(path, options = {}) { await goto(path, options.screenId); },
    async location() {
      if (!ownedProcess) return null;
      return parseParityEvents(readParityLog(ssh, ownedProcess)).screen;
    },
    async focused() { return decodeFocus(parseParityEvents(readParityLog(ssh, ownedProcess)).focus); },
    async playerReady() {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const state = playerState();
        const focus = decodeFocus(parseParityEvents(readParityLog(ssh, ownedProcess)).focus);
        if (state?.state === 1 && state.controls && focus?.label === "pause") return;
        await sleep(250);
      }
      throw new Error("Sailfish player did not reach playing, controls-visible, Play/Pause-focus state");
    },
    async playhead() { return playerState()?.positionSeconds ?? 0; },
    async panelOpen() {
      const state = playerState();
      if (!state) throw new Error("Sailfish player state telemetry is not available");
      return state.menuOpen;
    },
    async screenshot(file) {
      if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified; not capturing");
      const conf = ssh("defaultuser", "cat ~/.config/harbour-playarr/harbour-playarr.conf");
      if (!/refresh=/.test(conf)) throw new Error("signed out: not capturing");
      if (!ownedProcess) throw new Error("Sailfish app process is not owned by this driver");
      const current = requireSingleAppProcess(ssh("root", scanAppProcessesScript(ownedProcess.marker)), ownedProcess.marker);
      if (current.pid !== ownedProcess.pid || current.starttime !== ownedProcess.starttime) {
        throw new Error("Sailfish process identity changed before capture");
      }
      vnc("capture", file);
      if (!existsSync(file)) throw new Error("capture failed");
    },
    // Plays case.file straight in the player and reads the engine position from the app's own log.
    supports: { nowPlaying: true },
    async play(c) {
      if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified");
      const t0 = Date.now();
      const probe = "js:console.log('PLAYPOS',Date.now(),pageStack.currentPage.engine.position)";
      await launch(["wait", "js:console.log('PLAYSTART',Date.now())", `js:pageStack.push('${PAGES}/PlayerPage.qml',{mediaFileId:'${c.file}',title:'case ${c.id}',startMs:0})`, ...Array(36).fill(probe)]);
      await sleep(40000);
      const np = mpris();
      await sleep(30000);
      const log = ssh("root", `journalctl -b --no-pager | grep PLAYPOS | tail -60`);
      // Time to first frame counts from the play action, not from the app launch.
      const t1 = Number(ssh("root", "journalctl -b --no-pager | grep PLAYSTART | tail -1").match(/PLAYSTART (\d+)/)?.[1] ?? t0);
      const samples = [...log.matchAll(/PLAYPOS (\d+) (-?\d+)/g)].map((m) => ({ t: Number(m[1]), pos: Number(m[2]) })).filter((s) => s.t >= t0 - 5000);
      const moving = samples.filter((s) => s.pos > 0);
      if (!moving.length) return { state: samples.length ? "stalled" : "error", detail: "position never advanced", nowPlaying: np };
      const first = moving[0], last = moving.at(-1);
      return { state: last.pos > first.pos ? "playing" : "stalled", startSeconds: (first.t - t1) / 1000, advancedSeconds: (last.pos - first.pos) / 1000, nowPlaying: np };
    },
  };
}
