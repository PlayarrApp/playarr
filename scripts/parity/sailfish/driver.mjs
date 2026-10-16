// Suite driver for the Sailfish OS client on the SDK emulator (or a device) reached over ssh. Contract: docs/parity/SUITE.md.
//   PLAYARR_SF_SSH_KEY (private key), PLAYARR_SF_SSH_PORT (default 2223), PLAYARR_SF_SSH_HOST (default 127.0.0.1),
//   PLAYARR_SF_VNC (host:port of the display), PLAYARR_SF_VNC_PW_FILE (password file), PLAYARR_SF_VNCDO (vncdo binary).
// The phone has no D-pad. key() records the sequence and location() resolves it against the suite's own key paths, then
// drives the app to that screen with its smoke-script hook (PLAYARR_STEPS, src/main.cpp): the same end states a D-pad
// run reaches on the web. focused() reports null, so the D-pad checks are honestly not passed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandKeys } from "../suite-lib.mjs";
import { cleanupAppProcessScript, newProcessMarker, parseAppProcesses, requireSingleAppProcess, scanAppProcessesScript } from "./process.mjs";
import { requireRouteReady, routeReadinessProbe, readOwnedRouteLog, serializeSteps } from "./route-readiness.mjs";
import { detailRouteRequest } from "./detail-route.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = "file:///usr/share/harbour-playarr/qml/pages";

export async function createDriver() {
  const env = process.env;
  const host = env.PLAYARR_SF_SSH_HOST ?? "127.0.0.1", port = env.PLAYARR_SF_SSH_PORT ?? "2223";
  const sshArgs = ["-i", env.PLAYARR_SF_SSH_KEY, "-p", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
  const ssh = (user, cmd) => execFileSync("ssh", [...sshArgs, `${user}@${host}`, cmd], { encoding: "utf8", timeout: 60000 });
  const tmp = mkdtempSync(join(tmpdir(), "sf-driver-"));
  let theme = "dark", seq = [], at = "/";
  let ownedProcess = null;
  const sequences = suite.screens.filter((s) => s.keys).map((s) => ({ s, k: expandKeys(s.keys).map((x) => x.key + (x.long ? ":long" : "")).join(",") }));

  async function cleanupOwnedProcess() {
    if (!ownedProcess) return;
    const previous = ownedProcess;
    ssh("root", cleanupAppProcessScript(previous));
    ownedProcess = null;
  }
  // Restart the app with a smoke script; every run starts with the theme so it holds without a stored preference.
  const launch = async (steps, detail = null) => {
    const marker = newProcessMarker();
    const resolvedSteps = typeof steps === "function" ? steps(marker) : steps;
    const checkedSteps = detail ? [...resolvedSteps, ...Array(8).fill(routeReadinessProbe(marker, detail.kind, detail.id))] : resolvedSteps;
    const script = serializeSteps(theme, checkedSteps);
    writeFileSync(join(tmp, "steps"), script);
    execFileSync("scp", ["-i", env.PLAYARR_SF_SSH_KEY, "-P", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", join(tmp, "steps"), `defaultuser@${host}:/tmp/pa-steps.txt`]);
    await cleanupOwnedProcess();
    const existing = parseAppProcesses(ssh("root", scanAppProcessesScript(marker)), marker);
    if (existing.length) throw new Error(`Sailfish pre-launch check found ${existing.length} existing app process(es)`);
    ssh("defaultuser", [
      "export XDG_RUNTIME_DIR=/run/user/100000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/100000/dbus/user_bus_socket",
      'export PLAYARR_STEPS="$(cat /tmp/pa-steps.txt)"',
      `setsid nohup invoker --type=silica-qt5 --no-wait /usr/bin/harbour-playarr ${marker} >/tmp/pa.log 2>&1 </dev/null &`,
      "sleep 2"].join("\n"));
    const output = ssh("root", scanAppProcessesScript(marker));
    const processes = parseAppProcesses(output, marker);
    if (processes.length !== 1 || !processes[0].markerPresent) {
      for (const process of processes.filter((candidate) => candidate.markerPresent)) ssh("root", cleanupAppProcessScript(process));
      throw new Error(`Sailfish launch preflight expected one marked app, found ${processes.length}`);
    }
    ownedProcess = requireSingleAppProcess(output, marker);
  };
  // The first title of a library in the web's order (natural title order), as the web's D-pad path opens it.
  const firstMovie = "pageStack.currentPage.openFirst('movie')";
  const firstSeries = "pageStack.currentPage.openFirst('series')";
  const section = (n) => [`js:pageStack.currentPage.section='${n}'`];
  const calendar = (m) => [`js:Api.setSetting('cal.mode','${m}')`, ...section("calendar")];
  // [steps, seconds to settle] for a web route as the suite names it.
  function plan(route, screenId, marker = "ROUTE") {
    const [path, q] = route.split("?");
    const view = new URLSearchParams(q ?? "").get("view");
    if (screenId === "actions") return [["wait", "wait", "js:pageStack.currentPage.actionsHome()"], 16];
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
    if (path.startsWith("/player/")) return [["wait", `js:${firstMovie}`, "wait", "wait", "js:pageStack.currentPage.play(pageStack.currentPage.target.id,pageStack.currentPage.work.title)",
      ...Array(7).fill("wait"), "js:pageStack.currentPage.engine.pause()", "js:pageStack.currentPage.controls=true"], 34];
    throw new Error(`no Sailfish mapping for ${route}`);
  }
  async function goto(route, screenId) {
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
    at = route.replace(":id", "item");
  }
  const vnc = () => {
    const [h, p] = env.PLAYARR_SF_VNC.split(":");
    return [env.PLAYARR_SF_VNCDO, ["--delay", "20", "-s", `${h}::${p}`, "-p", readFileSync(env.PLAYARR_SF_VNC_PW_FILE, "utf8").trim()]];
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

  return {
    async start() { ssh("defaultuser", "test -s ~/.config/harbour-playarr/harbour-playarr.conf && grep -q refresh ~/.config/harbour-playarr/harbour-playarr.conf"); },
    async stop() { await cleanupOwnedProcess(); rmSync(tmp, { recursive: true, force: true }); },
    async setTheme(t) { theme = t; },
    async home() { seq = []; await launch(["wait"]); await sleep(12000); at = "/"; },
    async key(name, { long } = {}) { seq.push(name + (long ? ":long" : "")); },
    async route(path) { await goto(path); },
    // Resolves the recorded key path to a screen and shows it; an unknown path stays on Home (the D-pad checks then fail).
    async location() {
      if (seq.length) {
        const hit = sequences.find((x) => x.k === seq.join(","));
        seq = [];
        if (hit) await goto(hit.s.route, hit.s.id);
      }
      return at;
    },
    async focused() { return null; },
    async screenshot(file) {
      const conf = ssh("defaultuser", "cat ~/.config/harbour-playarr/harbour-playarr.conf");
      if (!/refresh=/.test(conf)) throw new Error("signed out: not capturing");
      if (!ownedProcess) throw new Error("Sailfish app process is not owned by this driver");
      const current = requireSingleAppProcess(ssh("root", scanAppProcessesScript(ownedProcess.marker)), ownedProcess.marker);
      if (current.pid !== ownedProcess.pid || current.starttime !== ownedProcess.starttime) {
        throw new Error("Sailfish process identity changed before capture");
      }
      const [bin, base] = vnc();
      execFileSync(bin, [...base, "capture", file], { stdio: "ignore" });
      if (!existsSync(file)) throw new Error("capture failed");
    },
    // Plays case.file straight in the player and reads the engine position from the app's own log.
    supports: { nowPlaying: true },
    async play(c) {
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
