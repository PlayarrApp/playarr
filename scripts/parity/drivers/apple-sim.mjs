// Apple simulator driver for the shared parity suite (docs/parity/SUITE.md). Runs on a GitHub-hosted macOS runner next to
// scripts/apple-wall/wall.sh (WORK/state.env holds the simulator's UDID and the app's bundle id). tvOS only for now.
//   env: WORK (wall scratch dir), DEVICE (tvos), SIM_UDID/SIM_BUNDLE (override state.env)
// Keys reach the simulator as keyboard events through System Events (arrows, Return, Escape) with Simulator frontmost; a long
// press holds Return through a CGEvent helper. The route and the focused item come from the app's debug parity-state.json
// (TVParityState in clients/apple-tv), read through `simctl get_app_container`. Screenshots are `simctl io screenshot`.
import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// IDB (path of the idb client, with its companion running): headless keys as USB HID usages, no Simulator window, no host keyboard.
const HID = { up: 82, down: 81, left: 80, right: 79, select: 40, back: 41 };
const KEYCODE = { up: 126, down: 125, left: 123, right: 124, select: 36, back: 53 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const MAC_DIRECTIONS = new Set(["up", "down", "left", "right"]);
const SAFE_BOOLEAN = "(true|false)";
const SAFE_NUMBER = "-?\\d{1,7}(?:\\.\\d{1,3})?";
export function validateParityFixedNow(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match ?? [];
  const daysInMonth = match ? new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate() : 0;
  if (!match || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) || !Number.isFinite(Date.parse(value))) {
    throw new Error("PARITY_FIXED_NOW must be a valid ISO 8601 timestamp");
  }
  return value;
}
const MAX_MAC_LOG_DELTA_BYTES = 256 * 1024;
const MAX_MAC_KEY_ARTIFACT_BYTES = 64 * 1024;
const MAC_KEY_ENTRY = new RegExp(`^PlayarrMacFocusKeyEntry seq=(\\d{1,9}) direction=(up|down|left|right) text_responder=${SAFE_BOOLEAN} window_key=${SAFE_BOOLEAN}$`);
const MAC_KEY_RESULT = new RegExp(`^PlayarrMacFocusKey seq=(\\d{1,9}) direction=(up|down|left|right) responder=(text|other) text_edit_excluded=${SAFE_BOOLEAN} before_focused=${SAFE_BOOLEAN} before_fallback_focused_present=${SAFE_BOOLEAN} before_fallback_equals_before=${SAFE_BOOLEAN} after_focused=${SAFE_BOOLEAN} after_equals_before=${SAFE_BOOLEAN} fallback_ran=${SAFE_BOOLEAN} registered_target_candidates=(\\d{1,6}) chosen_frame=(none|${SAFE_NUMBER},${SAFE_NUMBER},${SAFE_NUMBER},${SAFE_NUMBER}) focused_binding=${SAFE_BOOLEAN} focused_binding_count=(\\d{1,6})$`);

export class MacFocusLogCursor {
  identity = null;
  offset = 0;

  reset(identity, size) {
    this.identity = identity;
    this.offset = size;
  }

  start(identity, size) {
    if (identity !== this.identity || size < this.offset) {
      this.identity = identity;
      this.offset = 0;
    }
    return this.offset;
  }

  advance(identity, size) {
    this.identity = identity;
    this.offset = size;
  }
}

function safeMarker(line, prefix, pattern) {
  const markerStart = line.indexOf(prefix);
  if (markerStart < 0) return null;
  const marker = line.slice(markerStart).trim();
  return pattern.exec(marker);
}

function safeMacFocusRecord(line) {
  const entry = safeMarker(line, "PlayarrMacFocusKeyEntry ", MAC_KEY_ENTRY);
  if (entry && MAC_DIRECTIONS.has(entry[2])) {
    return {
      sequence: Number(entry[1]), direction: entry[2], kind: "entry",
      marker: `PlayarrMacFocusKeyEntry seq=${entry[1]} direction=${entry[2]} text_responder=${entry[3]} window_key=${entry[4]}`,
    };
  }
  const result = safeMarker(line, "PlayarrMacFocusKey ", MAC_KEY_RESULT);
  if (result && MAC_DIRECTIONS.has(result[2])) return { sequence: Number(result[1]), direction: result[2], kind: "result", marker: result[0] };
  return null;
}

export class MacFocusKeyCollector {
  partial = "";
  emitted = new Set();

  reset() {
    this.partial = "";
    this.emitted.clear();
  }

  discardPartial() { this.partial = ""; }

  feed(text, { final = false } = {}) {
    this.partial += text;
    const lines = this.partial.split(/\r?\n/);
    this.partial = final ? "" : lines.pop();
    if (final && lines.length && lines.at(-1) === "") lines.pop();
    const records = [];
    for (const line of lines) {
      const record = safeMacFocusRecord(line);
      if (!record) continue;
      const key = `${record.kind}:${record.sequence}:${record.direction}`;
      if (this.emitted.has(key)) continue;
      this.emitted.add(key);
      records.push(record);
    }
    return records;
  }
}

export function serializeMacFocusKeyMarker(record) {
  return `${JSON.stringify({ sequence: record.sequence, direction: record.direction, kind: record.kind, marker: record.marker })}\n`;
}

function readMacLogDelta(file, cursor) {
  let fd;
  try {
    fd = openSync(file, "r");
    const stat = fstatSync(fd);
    const identity = `${stat.dev}:${stat.ino}`;
    const reset = identity !== cursor.identity || stat.size < cursor.offset;
    let start = cursor.start(identity, stat.size);
    const oversized = stat.size - start > MAX_MAC_LOG_DELTA_BYTES;
    if (oversized) start = stat.size - MAX_MAC_LOG_DELTA_BYTES;
    const length = Math.max(0, stat.size - start);
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = readSync(fd, bytes, read, length - read, start + read);
      if (count === 0) break;
      read += count;
    }
    cursor.advance(identity, start + read);
    return { text: bytes.subarray(0, read).toString("utf8"), reset, oversized };
  } catch {
    return { text: "", reset: false, oversized: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readState(work) {
  const f = join(work, "state.env");
  const env = {};
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/\\(.)/g, "$1"); }
  return env;
}

export async function createDriver({ args = [], out } = {}) {
  // The D-pad checks compare against web, where Select on a nav item moves focus into the page (-PlayarrSelectEntersPage).
  const dpadOnly = args.includes("--only") && args[args.indexOf("--only") + 1] === "dpad";
  const device = process.env.DEVICE ?? "tvos";
  if (device !== "tvos" && device !== "macos") throw new Error(`apple-sim driver: ${device} is not supported yet`);
  const mac = device === "macos";
  const parityNow = process.env.PARITY_FIXED_NOW === undefined ? null : validateParityFixedNow(process.env.PARITY_FIXED_NOW);
  const parityNowArgs = parityNow ? ["-PlayarrParityNow", parityNow] : [];
  const visibleMacParity = mac && process.env.MAC_PARITY_VISIBLE === "true";
  const outIndex = args.indexOf("--out");
  const suiteOut = outIndex >= 0 && args[outIndex + 1] ? resolve(args[outIndex + 1]) : out ? resolve(out) : null;
  const work = process.env.WORK;
  if (!work) throw new Error("WORK (the wall scratch dir) is required");
  const st = readState(work);
  const udid = process.env.SIM_UDID ?? st.UDID, bundle = process.env.SIM_BUNDLE ?? st.BUNDLE;
  if (!mac && (!udid || !bundle)) throw new Error("no simulator in WORK/state.env: run wall.sh up first");
  // The Mac app: keys and snapshots go through its debug remote (notify), the state file sits in the app's own home.
  const macState = join(work, "parity-state.json");
  const macAppLog = join(work, "app.log");
  const macKeyArtifact = mac && suiteOut ? join(suiteOut, "mac-focus-keys.jsonl") : null;
  const macFocusLogCursor = new MacFocusLogCursor();
  const macFocusKeyCollector = new MacFocusKeyCollector();
  const notify = join(work, "notify"), wallSh = join(process.env.TRUSTED ?? "", "scripts/apple-wall/wall.sh");
  let theme = "dark";
  let macLogHasLaunched = false;
  const hold = join(work, "hold-key");
  let macKeyArtifactBytes = 0;
  if (macKeyArtifact) {
    mkdirSync(suiteOut, { recursive: true });
    writeFileSync(macKeyArtifact, "");
  }
  const flushMacFocusKeyLog = () => {
    if (!mac) return;
    macFocusKeyCollector.reset();
    try {
      const stat = statSync(macAppLog);
      macFocusLogCursor.reset(`${stat.dev}:${stat.ino}`, stat.size);
    } catch {
      macFocusLogCursor.reset(null, 0);
    }
  };
  const emitMacFocusRecords = (records) => {
    for (const record of records) {
      console.log(`    ${record.marker}`);
      if (macKeyArtifact) {
        const serialized = serializeMacFocusKeyMarker(record);
        const size = Buffer.byteLength(serialized);
        if (macKeyArtifactBytes + size <= MAX_MAC_KEY_ARTIFACT_BYTES) {
          try {
            appendFileSync(macKeyArtifact, serialized);
            macKeyArtifactBytes += size;
          } catch { /* diagnostic artifact only */ }
        }
      }
    }
  };
  const collectMacFocusKeyLog = ({ final = false } = {}) => {
    if (!mac) return;
    const delta = readMacLogDelta(macAppLog, macFocusLogCursor);
    if (delta.reset) macFocusKeyCollector.reset();
    else if (delta.oversized) macFocusKeyCollector.discardPartial();
    // Debug trace of who sets focus after Back (safe characters only, one line each).
    for (const line of delta.text.split("\n")) { const m = /PlayarrMacTrace ([\w .:=,'-]{1,160})$/.exec(line); if (m) console.log(`    trace ${m[1]}`); }
    emitMacFocusRecords(macFocusKeyCollector.feed(delta.text, { final }));
  };
  const traceMacFocus = async () => {
    run(notify, ["focus"]);
    await sleep(150);
  };
  const frontmost = () => { if (mac || process.env.IDB) return; try { run("osascript", ["-e", 'tell application "Simulator" to activate']); } catch { /* keep going: keys may still land */ } };
  let stickyArgs = []; // launch arguments every launch carries (a crop's Home-artwork setting)
  const launch = async (extra = [], wait = 22000) => {
    if (mac) {
      if (macLogHasLaunched) {
        collectMacFocusKeyLog({ final: true });
        macFocusKeyCollector.reset();
      } else flushMacFocusKeyLog();
      // The sign-in behind a launch can fail for a moment (the server throttles back-to-back logins): retry with a pause.
      for (let attempt = 1; ; attempt += 1) {
        try {
          run("bash", [wallSh, "launch", "macos", theme, "-"], { env: { ...process.env, LAUNCH_EXTRA: [...extra, ...stickyArgs, ...parityNowArgs, ...(dpadOnly ? ["-PlayarrSelectEntersPage"] : []), "-PlayarrParityState", macState].join(" ") } });
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          console.log(`    launch failed (attempt ${attempt}), retrying`);
          await sleep(15000 * attempt);
        }
      }
      await sleep(wait + 10000);
      // The shared runner normally stays invisible. In the dedicated hosted D-pad mode, read its real initial focus without moving it.
      if (!visibleMacParity) {
        // Wait for the initial focus to settle: the same reading on three polls. Only a window with no focus gets the probe key;
        // a window that already has one would be moved a card to the right (the home-right start 0:1 flake).
        let last = null, steady = 0;
        for (let i = 0; i < 20 && steady < 3; i += 1) {
          await sleep(500);
          const now = JSON.stringify(state().position ?? state().focused ?? null);
          steady = now === last ? steady + 1 : 0;
          last = now;
        }
        if (last === "null") { run(notify, [`key:${KEYCODE.right}`]); await sleep(1000); }
      }
      if (process.env.DRIVER_TRACE && !globalThis.__targetsLogged) { // once: where the Mac's focus targets sit (diagnosis)
        globalThis.__targetsLogged = true;
        await traceMacFocus();
      }
      collectMacFocusKeyLog({ final: true });
      macLogHasLaunched = true;
      return;
    }
    try { run("xcrun", ["simctl", "terminate", udid, bundle]); } catch { /* not running */ }
    await sleep(1000);
    // A fresh sign-in per launch, as wall.sh does (the saved session may be revoked by the capture step's own launches).
    const login = join(process.env.TRUSTED ?? "", "scripts/apple-wall/login.py"), tokens = [];
    if (process.env.SERVER_URL && existsSync(login)) {
      const env = { ...process.env, DEVICE_NAME: `wall-${device}` };
      const [access, refresh] = run("python3", [login], { env }).trim().split(" ");
      run("xcrun", ["simctl", "spawn", udid, "defaults", "write", bundle, "com.playarr.playarr.tvos.deviceID", "-string", run("python3", [login, "--device-id"], { env }).trim()]);
      tokens.push("-PlayarrServerURL", process.env.SERVER_URL, "-PlayarrAccessToken", access, "-PlayarrRefreshToken", refresh);
    }
    run("xcrun", ["simctl", "launch", udid, bundle, ...tokens, "-PlayarrTheme", theme, "-PlayarrMuted", ...(dpadOnly ? ["-PlayarrSelectEntersPage"] : []), ...stickyArgs, ...parityNowArgs, ...extra]);
    await sleep(wait); // a launch signs in from the seeded session and loads Home
    frontmost(); await sleep(500);
  };
  const state = () => {
    try {
      if (mac) return JSON.parse(readFileSync(macState, "utf8"));
      const dir = run("xcrun", ["simctl", "get_app_container", udid, bundle, "data"]).trim();
      return JSON.parse(readFileSync(join(dir, "Documents", "parity-state.json"), "utf8"));
    } catch { return {}; }
  };
  const playOnce = async (c, expect) => {
      const t0 = Date.now(), seen = () => state().playback;
      await launch(["-PlayarrPlayFile", c.file], 1000);
      let start = null, p0 = null, last = {};
      while ((Date.now() - t0) / 1000 < expect.startWithinSeconds + 15) {
        last = seen() ?? {};
        if (last.state === "failed") return { state: "error", detail: last.detail || "the player reported a failure" };
        if (last.state === "playing" && last.position > 0) { start = (Date.now() - t0) / 1000; p0 = last.position; break; }
        await sleep(1000);
      }
      if (start === null) return { state: "stalled", detail: "playback did not start", startSeconds: (Date.now() - t0) / 1000 };
      await sleep((expect.advanceSeconds + 2) * 1000);
      last = seen() ?? {};
      const advanced = last.position - p0;
      return { state: last.state === "playing" && advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds: start, advancedSeconds: advanced };
  };
  return {
    async setDeterministicCapture() { throw new Error(`Apple ${device} stable deterministic capture unsupported: no platform clock and animation control are available`); },
    async captureBuildIdentity() { throw new Error(`Apple ${device} stable build identity unsupported: installed app digest is not exposed by this driver`); },
    async waitReady() { throw new Error(`Apple ${device} stable deterministic capture unsupported: readiness is not exposed`); },
    async start({ theme: t } = {}) {
      theme = t ?? "dark";
      if (mac) {
        await launch([], 15000);
        // Where the Mac app wrote its state (the home it runs in may not be the one handed to it).
        console.log("parity state file:", existsSync(macState) ? "written" : "missing");
        collectMacFocusKeyLog({ final: true });
        return;
      }
      // Long-press helper: hold Return for 1.1 s with a CGEvent.
      mkdirSync(work, { recursive: true });
      writeFileSync(join(work, "hold-key.swift"), `import CoreGraphics
import Foundation
let code = CGKeyCode(CommandLine.arguments[1])!, secs = Double(CommandLine.arguments[2])!
let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)!
down.post(tap: .cghidEventTap)
Thread.sleep(forTimeInterval: secs)
CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)!.post(tap: .cghidEventTap)
`);
      try { run("swiftc", ["-O", "-o", hold, join(work, "hold-key.swift")]); } catch (e) { console.log("hold helper not built:", String(e.stderr ?? e).split("\n")[0]); }
      // SwiftUI builds its accessibility tree (the focused item's label) only when accessibility is on, as UI automation does.
      for (const key of ["ApplicationAccessibilityEnabled", "AccessibilityEnabled", "AutomationEnabled"]) {
        try { run("xcrun", ["simctl", "spawn", udid, "defaults", "write", "com.apple.Accessibility", key, "-bool", "true"]); } catch (e) { console.log("accessibility default", key, String(e.stderr ?? e).split("\n")[0]); }
      }
      if (!process.env.IDB) { run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]); await sleep(6000); }
      await launch();
    },
    setLaunchArgs(args) { stickyArgs = args; },
    endCrops: true, // suite `crops`: the last row / item of a grid, for the focus-crop audit
    async stop() { collectMacFocusKeyLog({ final: true }); },
    async setTheme(t) { if (t !== theme) { theme = t; await launch(); } },
    async home() { await launch(); },
    // Only the pinned detail screens (/movies/<id>, /series/<id>) open by id; every other screen is reached by keys.
    async route(path) {
      const id = /^\/(?:movies|series)\/([0-9a-f-]{36})$/.exec(path)?.[1];
      if (!id) throw new Error(`the Apple driver cannot deep link ${path}`);
      await launch(["-PlayarrOpenWork", id], 22000);
    },
    async key(name, { long } = {}) {
      // KEY_LOCK (a file path): hosts shared with other keyboard injectors take a shlock around each key.
      const lock = process.env.KEY_LOCK;
      if (lock) for (let i = 0; ; i += 1) { try { run("shlock", ["-f", lock, "-p", String(process.pid)]); break; } catch (e) { if (i > 600) throw e; await sleep(100); } }
      try {
        frontmost();
        if (process.env.IDB && !mac) run(process.env.IDB, ["ui", "key", "--udid", udid, ...(long ? ["--duration", "1.1"] : []), String(HID[name])]);
        else if (mac) run(notify, [`key:${KEYCODE[name]}${long ? ":shift" : ""}`]); // the Mac's long press is Shift+Return
        else if (long && existsSync(hold)) run(hold, [String(KEYCODE[name]), "1.1"]);
        else run("osascript", ["-e", `tell application "System Events" to key code ${KEYCODE[name]}`]);
      } finally { if (lock) rmSync(lock, { force: true }); }
      // A Select can present a page or a drawer whose focus settles later (Device opens the household page): a key sent before that lands
      // on the page behind it, which ended the settings and calendar paths on Home (run 38781127369).
      await sleep(mac && name === "select" ? 1800 : 600);
      if (process.env.DRIVER_TRACE) {
        const s = state(); console.log(`    key ${name}${long ? ":long" : ""} -> ${s.route} | ${s.focused} | ${s.item}`);
        if (mac) await traceMacFocus();
      }
      if (mac) collectMacFocusKeyLog();
    },
    async location() { await sleep(300); return state().route ?? "/"; },
    // The Mac's focus settles a moment after a key (the layer settle step): wait up to 4 s for a focused item, never report an empty
    // answer straight away. Bounded, so a screen that really has no focus still ends the check.
    async focused() {
      let s = state();
      if (mac) for (let i = 0; i < 16 && s.focused == null; i += 1) { await sleep(250); s = state(); }
      return s.focused == null ? null : s.position ? { label: s.focused, position: s.position } : s.focused;
    },
    async screenshot(file) {
      // A library page (and the Filters drawer over it) is captured only once its titles have loaded: an empty library behind the
      // drawer scored 78. Bounded at 40 s; a page that never reports a count (not a library) is not held up.
      if (mac && /^\/(movies|series|music)/.test(state().route ?? "")) {
        for (let i = 0; i < 160 && !(state().items > 0); i += 1) await sleep(250);
        if (!(state().items > 0)) console.log("  library still empty after 40 s, capturing anyway");
        await sleep(1500); // artwork for the first screenful
      }
      if (mac) {
        rmSync(file, { force: true });
        run(notify, [`snapshot:${file}`]);
        for (let i = 0; i < 480 && !(existsSync(file) && statSync(file).size > 0); i++) await sleep(250); // a busy grid renders slowly
      } else run("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", file]);
      if (!existsSync(file) || statSync(file).size < 20000) throw new Error("empty frame");
      if ((state().route ?? "").startsWith("/login")) throw new Error("signed out");
    },
    // Cases a and b: launch straight into the player (-PlayarrPlayFile) and read its state from parity-state.json. The
    // caller serialises runs (one device at a time, playback.lock rules); a 503/404 at a pod restart gets one re-run.
    async play(c, expect, attempt = 0) {
      const r = await playOnce(c, expect);
      // Capacity is shared (two transcode slots per node; the web reference's session may still hold one): wait and re-run, twice at most.
      if (r.state === "error" && /capacity/.test(r.detail ?? "") && attempt < 2) { await sleep(90000); return this.play(c, expect, attempt + 1); }
      return r;
    },
  };
}
