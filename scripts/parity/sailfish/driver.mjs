// Suite driver for the Sailfish OS client on the SDK emulator (or a device) reached over ssh. Contract: docs/parity/SUITE.md.
//   PLAYARR_SF_SSH_KEY (private key), optional PLAYARR_SF_SSH_CONFIG (passed to ssh and scp with -F),
//   PLAYARR_SF_SSH_PORT (default 2223), PLAYARR_SF_SSH_HOST (default 127.0.0.1),
//   PLAYARR_SF_VBOXMANAGE (VBoxManage binary, default `VBoxManage`), PLAYARR_SF_VM (VM name, default `sailfish`).
// The VM runs headless with no remote display: screenshots use `VBoxManage controlvm screenshotpng`, keys use
// `controlvm keyboardputscancode`. D-pad checks read the app's QML focus and route telemetry.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appIdentityReceipt, cleanupAppProcessScript, newProcessMarker, parseAppProcesses, requireSingleAppProcess, scanAppProcessesScript } from "./process.mjs";
import { formatOwnedDiagnostics, ownedDiagnosticCommand, preserveBeforeCleanup, requireRouteReady, routeReadinessProbe, readOwnedRouteLog, serializeSteps } from "./route-readiness.mjs";
import { detailRouteRequest } from "./detail-route.mjs";
import { keyCommand, parseParityEvents, decodeFocus, hasKeyAckPair, hasKeyCompletion, nextKeyAckPress, playerCaptureReady } from "./navigation.mjs";
import { signedInProfileProbe, verifiedDeviceTestUser as matchesDeviceTestUser } from "./account-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "..", "suite.json"), "utf8"));
const screens = JSON.parse(readFileSync(join(here, "..", "screens.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = "file:///usr/share/harbour-playarr/qml/pages";
const readParityLog = (ssh, identity) => identity ? readOwnedRouteLog(ssh, identity) : "";

export async function createDriver() {
  const env = process.env;
  const host = env.PLAYARR_SF_SSH_HOST ?? "127.0.0.1", port = env.PLAYARR_SF_SSH_PORT ?? "2223";
  const sshConfigArgs = env.PLAYARR_SF_SSH_CONFIG ? ["-F", env.PLAYARR_SF_SSH_CONFIG] : [];
  const sshArgs = [...sshConfigArgs, "-i", env.PLAYARR_SF_SSH_KEY, "-p", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
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
  let pendingSettle = 12;
  let pendingLayoutDump = true;
  const launch = async (steps, detail = null) => {
    const marker = newProcessMarker();
    const resolvedSteps = typeof steps === "function" ? steps(marker) : steps;
    // Detail refs are at the page top, but the series page scrolls itself to the next-up episode.
    const probedSteps = detail ? [...resolvedSteps, ...Array(8).fill(routeReadinessProbe(marker, detail.kind, detail.id)), "js:pageStack.currentPage.scrollTop()"] : resolvedSteps;
    // Layout export (docs/parity/LAYOUT.md) runs as the last step, at the end of the settle time, in the state that is captured.
    const dumpAt = Math.max(1, Math.ceil((pendingSettle - 4) / 1.5) - (detail ? 2 : 0));
    // Detail pages are put back at the top again right before the export: late data (similar titles, the next-up scroll) can move them.
    const dumpSteps = detail ? ["js:pageStack.currentPage.scrollTop()", "wait", "js:layoutDump()"] : ["js:layoutDump()"];
    const layoutSteps = !pendingLayoutDump ? probedSteps : probedSteps.length >= dumpAt
      ? [...probedSteps.slice(0, dumpAt), ...dumpSteps, ...probedSteps.slice(dumpAt)]
      : [...probedSteps, ...Array(dumpAt - probedSteps.length).fill("wait"), ...dumpSteps];
    const checkedSteps = ["js:console.log('PARITY_CLOCK',Calendar.todayIso())", ...layoutSteps];
    const script = serializeSteps(theme, checkedSteps);
    writeFileSync(join(tmp, "steps"), script);
    execFileSync("scp", [...sshConfigArgs, "-i", env.PLAYARR_SF_SSH_KEY, "-P", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", join(tmp, "steps"), `defaultuser@${host}:/run/user/100000/pa-steps.txt`]);
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
      `export PLAYARR_PARITY_CLOCK=${screens.determinism.clock}`,
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
    // The suite's keys long-press the first card in the Movies library, not Home's first card, which follows On deck.
    if (screenId === "actions") return [["wait", "wait", "js:pageStack.currentPage.actionsFirst('movie')"], 16];
    if (path === "/") return [["wait"], 12];
    if (path === "/movies" && q?.includes("panel=filters")) return [["wait", ...section("movies"), "wait", `js:pageStack.push('${PAGES}/FiltersPage.qml')`], 16];
    if (path === "/movies") return [["wait", ...section("movies")], 14];
    if (path === "/series") return [["wait", ...section("series")], 14];
    if (path === "/music") return [["wait", ...section("music")], 14];
    if (path === "/search") return [["wait", ...section("search")], 12];
    if (path === "/calendar" && q?.includes("panel=link")) return [["wait", ...calendar("agenda"), "wait", `js:pageStack.push('${PAGES}/CalendarLinkPage.qml')`], 20];
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
      if (screenId === "player-controls") return [["wait", `js:pageStack.push('${PAGES}/PlayerPage.qml',{mediaFileId:'${playerTarget}',title:'Sample media',startMs:0,parityCaptureHold:true})`], 40, false];
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
      pendingSettle = settle;
      pendingLayoutDump = planned[2] !== false;
      return planned[0];
    }, detail);
    // The scroll-to-top step is the last of 12 steps 1.5 s apart (about 21 s after launch).
    if (screenId === "player-controls") {
      await waitForPlayerCapture();
      await waitForPlayerLayoutAfterAck();
    }
    else await sleep((detail ? Math.max(settle, 24) : settle) * 1000);
    // The export hides covered-looking elements one by one on the live screen: no capture until it has ended and shown them again.
    if (pendingLayoutDump && screenId !== "player-controls") await waitForLayoutEnd();
    if (detail) requireRouteReady(readOwnedRouteLog(ssh, ownedProcess), ownedProcess.marker);
  }
  const vbox = (...args) => execFileSync(env.PLAYARR_SF_VBOXMANAGE ?? "VBoxManage", ["controlvm", env.PLAYARR_SF_VM ?? "sailfish", ...args], { stdio: "ignore", timeout: 30000 });
  // PS/2 set 1 make and break codes; arrows are extended (e0 prefix).
  const SCANCODES = { LEFT: ["e0", "4b"], RIGHT: ["e0", "4d"], UP: ["e0", "48"], DOWN: ["e0", "50"], ENTER: ["1c"], ESC: ["01"] };
  const keyEdge = (keysym, up) => {
    const [pre, code] = SCANCODES[keysym].length === 2 ? SCANCODES[keysym] : [null, SCANCODES[keysym][0]];
    const brk = (parseInt(code, 16) | 0x80).toString(16);
    vbox("keyboardputscancode", ...(pre ? [pre] : []), up ? brk : code);
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
  async function waitForPlayerCapture() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const events = parseParityEvents(readParityLog(ssh, ownedProcess));
      if (events.playerCaptureFailure) throw new Error(`Sailfish player capture seek is unsupported: ${events.playerCaptureFailure}`);
      if (playerCaptureReady(events.player, events.playerCaptureAcknowledgement)) return;
      await sleep(250);
    }
    const observed = playerState();
    throw new Error(`Sailfish player capture did not acknowledge paused source position 2000 ms (observed source=${observed?.sourceMs ?? "unknown"} ms, engine=${observed?.engineMs ?? "unknown"} ms)`);
  }
  async function waitForLayoutEnd() {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (readOwnedRouteLog(ssh, ownedProcess).includes("LAYOUTEND|")) return;
      await sleep(500);
    }
    throw new Error("Sailfish layout export did not finish");
  }
  async function waitForPlayerLayoutAfterAck() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const lines = readParityLog(ssh, ownedProcess).split(/\r?\n/);
      let ackLine = -1, layoutLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("PARITY|player-capture-ack|2000|2000")) ackLine = i;
        if (lines[i].includes("LAYOUTEND|")) layoutLine = i;
      }
      if (ackLine >= 0 && layoutLine > ackLine) return;
      await sleep(250);
    }
    throw new Error("Sailfish player capture did not emit a fresh layout export after its exact-position acknowledgement");
  }

  function writeLayout(file) {
    const log = readOwnedRouteLog(ssh, ownedProcess);
    // Exactly one complete dump: the rows between the second-last LAYOUTEND and the last one.
    const all = log.split(/\r?\n/);
    const ends = all.map((l, i) => (l.includes("LAYOUTEND|") ? i : -1)).filter((i) => i >= 0);
    if (!ends.length) throw new Error("layout export produced no complete dump");
    const segment = all.slice(ends.length > 1 ? ends[ends.length - 2] + 1 : 0, ends.at(-1) + 1);
    const failures = segment.filter((l) => l.includes("LAYOUTERR|")).map((l) => l.slice(l.indexOf("LAYOUTERR|") + 10));
    if (failures.length) throw new Error(`layout export could not read the app's text: ${failures.slice(0, 5).join("; ")}`);
    const elements = segment.filter((l) => l.includes("LAYOUTEL|")).flatMap((l) => JSON.parse(l.slice(l.indexOf("LAYOUTEL|") + 9)));
    // LAYOUTWARN lines are kept beside the layout for review; the QML type of each element only when asked for.
    const warnings = segment.filter((l) => l.includes("LAYOUTWARN|")).map((l) => l.slice(l.indexOf("LAYOUTWARN|") + 11));
    if (!env.PLAYARR_SF_LAYOUT_DEBUG) for (const e of elements) { delete e._src; delete e._dbg; }
    const end = segment.at(-1).match(/LAYOUTEND\|([\d.]+)\|([\d.]+)\|(\d+)/);
    if (!elements.length || !end) throw new Error("layout export produced no elements");
    const dir = join(dirname(dirname(file)), "layout", theme);
    mkdirSync(dir, { recursive: true });
    const clockDate = log.match(/PARITY_CLOCK (\d{4}-\d{2}-\d{2})/)?.[1];
    const expectedClockDate = screens.determinism.clock.slice(0, 10);
    const doc = { screen: basename(file, ".png"), theme, viewport: { w: Math.round(Number(end[1])), h: Math.round(Number(end[2])), dpr: 768 / 390 }, clockPinned: clockDate === expectedClockDate, occluded: Number(end[3]), elements };
    writeFileSync(join(dir, `${doc.screen}.json`), `${JSON.stringify(doc)}\n`);
    if (warnings.length) writeFileSync(join(dir, `${doc.screen}.warnings.txt`), `${warnings.join("\n")}\n`);
  }

  return {
    async start() {
      verifiedDeviceTestUser = false;
      const expected = env.PLAYARR_DEVICE_TEST_USERNAME;
      if (typeof expected !== "string" || !expected.trim()) throw new Error("PLAYARR_DEVICE_TEST_USERNAME is required to verify the Sailfish signed-in account");
      ssh("defaultuser", "test -s ~/.config/harbour-playarr/harbour-playarr.conf && grep -q refresh ~/.config/harbour-playarr/harbour-playarr.conf");
      await launch(["wait", signedInProfileProbe()]);
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
    async home() { if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified"); pendingSettle = 12; await launch(["wait"]); await sleep(12000); },
    async key(name, { long } = {}) {
      if (!verifiedDeviceTestUser) throw new Error("Sailfish signed-in device-test identity has not been verified");
      const keysym = keyCommand(name);
      const previous = parseParityEvents(readParityLog(ssh, ownedProcess)).keyAcks;
      if (long) {
        keyEdge(keysym, false);
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
        keyEdge(keysym, true);
      } else { keyEdge(keysym, false); keyEdge(keysym, true); }
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
      vbox("screenshotpng", file);
      if (!existsSync(file)) throw new Error("capture failed");
      writeLayout(file);
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
