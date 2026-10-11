// Apple simulator driver for the shared parity suite (docs/parity/SUITE.md). Runs on a GitHub-hosted macOS runner next to
// scripts/apple-wall/wall.sh (WORK/state.env holds the simulator's UDID and the app's bundle id). tvOS only for now.
//   env: WORK (wall scratch dir), DEVICE (tvos), SIM_UDID/SIM_BUNDLE (override state.env)
// Keys reach the simulator as keyboard events through System Events (arrows, Return, Escape) with Simulator frontmost; a long
// press holds Return through a CGEvent helper. The route and the focused item come from the app's debug parity-state.json
// (TVParityState in clients/apple-tv), read through `simctl get_app_container`. Screenshots are `simctl io screenshot`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
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
  if (device !== "tvos") throw new Error(`apple-sim driver: ${device} is not supported yet`);
  const work = process.env.WORK;
  if (!work) throw new Error("WORK (the wall scratch dir) is required");
  const st = readState(work);
  const udid = process.env.SIM_UDID ?? st.UDID, bundle = process.env.SIM_BUNDLE ?? st.BUNDLE;
  if (!udid || !bundle) throw new Error("no simulator in WORK/state.env: run wall.sh up first");
  let theme = "dark";
  const hold = join(work, "hold-key");
  const frontmost = () => { try { run("osascript", ["-e", 'tell application "Simulator" to activate']); } catch { /* keep going: keys may still land */ } };
  const launch = async (extra = [], wait = 22000) => {
    try { run("xcrun", ["simctl", "terminate", udid, bundle]); } catch { /* not running */ }
    await sleep(1000);
    run("xcrun", ["simctl", "launch", udid, bundle, "-PlayarrTheme", theme, "-PlayarrMuted", ...extra]);
    await sleep(wait); // a launch signs in from the seeded session and loads Home
    frontmost(); await sleep(500);
  };
  const state = () => {
    try {
      const dir = run("xcrun", ["simctl", "get_app_container", udid, bundle, "data"]).trim();
      return JSON.parse(readFileSync(join(dir, "Documents", "parity-state.json"), "utf8"));
    } catch { return {}; }
  };
  return {
    async start({ theme: t } = {}) {
      theme = t ?? "dark";
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
    async route() { throw new Error("the Apple driver has no deep links: the suite reaches every screen by keys"); },
    async key(name, { long } = {}) {
      frontmost();
      if (long && existsSync(hold)) run(hold, [String(KEYCODE[name]), "1.1"]);
      else run("osascript", ["-e", `tell application "System Events" to key code ${KEYCODE[name]}`]);
      await sleep(600);
      if (process.env.DRIVER_TRACE) { const s = state(); console.log(`    key ${name}${long ? ":long" : ""} -> ${s.route} | ${s.focused} | ${s.item}`); }
    },
    async location() { await sleep(300); return state().route ?? "/"; },
    async focused() { return state().focused ?? null; },
    async screenshot(file) {
      run("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", file]);
      if (!existsSync(file) || statSync(file).size < 20000) throw new Error("empty frame");
      if ((state().route ?? "").startsWith("/login")) throw new Error("signed out");
    },
    // Cases a and b: launch straight into the player (-PlayarrPlayFile) and read its state from parity-state.json. The
    // caller serialises runs (one device at a time, playback.lock rules); a 503/404 at a pod restart gets one re-run.
    async play(c, expect) {
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
    },
  };
}
