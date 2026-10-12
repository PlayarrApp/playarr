// Apple simulator driver for the shared parity suite (docs/parity/SUITE.md). Runs on a GitHub-hosted macOS runner next to
// scripts/apple-wall/wall.sh (WORK/state.env holds the simulator's UDID and the app's bundle id). tvOS only for now.
//   env: WORK (wall scratch dir), DEVICE (tvos), SIM_UDID/SIM_BUNDLE (override state.env)
// Keys reach the simulator as keyboard events through System Events (arrows, Return, Escape) with Simulator frontmost; a long
// press holds Return through a CGEvent helper. The route and the focused item come from the app's debug parity-state.json
// (TVParityState in clients/apple-tv), read through `simctl get_app_container`. Screenshots are `simctl io screenshot`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const KEYCODE = { up: 126, down: 125, left: 123, right: 124, select: 36, back: 53 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

function readState(work) {
  const f = join(work, "state.env");
  const env = {};
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/\\(.)/g, "$1"); }
  return env;
}

export async function createDriver() {
  const device = process.env.DEVICE ?? "tvos";
  if (device !== "tvos" && device !== "macos") throw new Error(`apple-sim driver: ${device} is not supported yet`);
  const mac = device === "macos";
  const work = process.env.WORK;
  if (!work) throw new Error("WORK (the wall scratch dir) is required");
  const st = readState(work);
  const udid = process.env.SIM_UDID ?? st.UDID, bundle = process.env.SIM_BUNDLE ?? st.BUNDLE;
  if (!mac && (!udid || !bundle)) throw new Error("no simulator in WORK/state.env: run wall.sh up first");
  // The Mac app: keys and snapshots go through its debug remote (notify), the state file sits in the app's own home.
  const notify = join(work, "notify"), wallSh = join(process.env.TRUSTED ?? "", "scripts/apple-wall/wall.sh");
  let theme = "dark";
  const hold = join(work, "hold-key");
  const frontmost = () => { if (mac) return; try { run("osascript", ["-e", 'tell application "Simulator" to activate']); } catch { /* keep going: keys may still land */ } };
  const launch = async (extra = [], wait = 22000) => {
    if (mac) {
      run("bash", [wallSh, "launch", "macos", theme, "-"], { env: { ...process.env, LAUNCH_EXTRA: extra.join(" ") } });
      await sleep(wait + 10000);
      return;
    }
    try { run("xcrun", ["simctl", "terminate", udid, bundle]); } catch { /* not running */ }
    await sleep(1000);
    run("xcrun", ["simctl", "launch", udid, bundle, "-PlayarrTheme", theme, "-PlayarrMuted", ...extra]);
    await sleep(wait); // a launch signs in from the seeded session and loads Home
    frontmost(); await sleep(500);
  };
  const state = () => {
    try {
      const dir = mac ? join(work, "machome") : run("xcrun", ["simctl", "get_app_container", udid, bundle, "data"]).trim();
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
    async start({ theme: t } = {}) {
      theme = t ?? "dark";
      if (mac) {
        await launch([], 15000);
        // Where the Mac app wrote its state (the home it runs in may not be the one handed to it).
        try { console.log("parity-state files:", run("bash", ["-c", `find "${work}/machome" "$HOME/Library/Containers" "$HOME/Documents" -name parity-state.json 2>/dev/null | head -5`]).trim() || "none"); } catch { /* diagnosis only */ }
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
      run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]);
      await sleep(6000);
      await launch();
    },
    async stop() {},
    async setTheme(t) { if (t !== theme) { theme = t; await launch(); } },
    async home() { await launch(); },
    // Only the pinned detail screens (/movies/<id>, /series/<id>) open by id; every other screen is reached by keys.
    async route(path) {
      const id = /^\/(?:movies|series)\/([0-9a-f-]{36})$/.exec(path)?.[1];
      if (!id) throw new Error(`the Apple driver cannot deep link ${path}`);
      await launch(["-PlayarrOpenWork", id], 22000);
    },
    async key(name, { long } = {}) {
      frontmost();
      if (mac) run(notify, [`key:${KEYCODE[name]}${long ? ":shift" : ""}`]); // the Mac's long press is Shift+Return
      else if (long && existsSync(hold)) run(hold, [String(KEYCODE[name]), "1.1"]);
      else run("osascript", ["-e", `tell application "System Events" to key code ${KEYCODE[name]}`]);
      await sleep(600);
      if (process.env.DRIVER_TRACE) { const s = state(); console.log(`    key ${name}${long ? ":long" : ""} -> ${s.route} | ${s.focused} | ${s.item}`); }
    },
    async location() { await sleep(300); return state().route ?? "/"; },
    async focused() { const s = state(); return s.focused == null ? null : s.position ? { label: s.focused, position: s.position } : s.focused; },
    async screenshot(file) {
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
