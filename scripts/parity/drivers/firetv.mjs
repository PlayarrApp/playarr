// Driver for the Fire TV app (clients/fire-tv, Vega OS) on the Vega virtual device. Contract: docs/parity/SUITE.md.
// The app must be built with PLAYARR_PARITY_CONTROL=1 (see clients/fire-tv/src/debug/parityControl.ts): Vega has no debug
// server, so commands go in as messages (`vmsgr send 'pkg://<app>?cmd=...'` arrives as a Linking url event) and the app
// answers on its log (`PARITY {json}`), which this driver follows with `loggingctl log -f`.
// Keys are X key events on the emulator window (inputd injection drops presses on the virtual device).
//   PLAYARR_FIRETV_VEGA      the vega CLI command, split on spaces (default "vega"; wrap it if the host needs a session helper)
//   PLAYARR_FIRETV_DEVICE    device name (default VirtualDevice)
//   PLAYARR_FIRETV_APP       app id (default com.streamarr.firetv.main)
//   PLAYARR_FIRETV_DISPLAY   X display of the emulator window (default :23)
//   PLAYARR_FIRETV_XDOTOOL   xdotool command (default "xdotool"); PLAYARR_FIRETV_LIBS adds to LD_LIBRARY_PATH
//   ANDROID_ADB_SERVER_PORT  the adb server the vega CLI uses, if it is not the default one
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { assertDeviceTestIdentity, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl } from "../device-test-guard.mjs";
import { readSecrets } from "../dpad-account.mjs";
import { framesMatch, selectDeviceTestAccount, waitForStableFrames } from "../firetv-readiness.mjs";
import { execFileBounded } from "../command.mjs";
import { routeMatches } from "../suite-lib.mjs";

const execFileP = promisify(execFile);
const execFileUntil = (command, args, options, deadlineMs) => deadlineMs === undefined
  ? execFileP(command, args, options)
  : execFileBounded(command, args, { ...options, deadlineMs });
const VEGA = (process.env.PLAYARR_FIRETV_VEGA ?? "vega").split(" ");
const DEVICE = process.env.PLAYARR_FIRETV_DEVICE ?? "VirtualDevice";
const APP = process.env.PLAYARR_FIRETV_APP ?? "com.streamarr.firetv.main";
const DISPLAY = process.env.PLAYARR_FIRETV_DISPLAY ?? ":23";
const XDOTOOL = (process.env.PLAYARR_FIRETV_XDOTOOL ?? "xdotool").split(" ");
const dbg = (...a) => process.env.PLAYARR_FIRETV_DEBUG && console.error("[firetv]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, DISPLAY, ...(process.env.PLAYARR_FIRETV_LIBS ? { LD_LIBRARY_PATH: `${process.env.PLAYARR_FIRETV_LIBS}:${process.env.LD_LIBRARY_PATH ?? ""}` } : {}) };
if (DEVICE !== "VirtualDevice") throw new Error("Fire TV parity driver is restricted to the explicitly named VirtualDevice");
if (!process.env.ANDROID_ADB_SERVER_PORT) throw new Error("ANDROID_ADB_SERVER_PORT must explicitly select the virtual-device server");

const vega = (...args) => (dbg("vega", args.join(" ").slice(0, 120)), execFileBounded(VEGA[0], [...VEGA.slice(1), ...args], { env, timeout: 90000, maxBuffer: 1 << 24 }).then((r) => r.stdout + r.stderr));
const vegaUntil = (deadlineMs, ...args) => (dbg("vega", args.join(" ").slice(0, 120)), execFileBounded(VEGA[0], [...VEGA.slice(1), ...args], { env, timeout: 90000, deadlineMs, maxBuffer: 1 << 24 }).then((r) => r.stdout + r.stderr));
const onDevice = (cmd, deadlineMs) => deadlineMs === undefined
  ? vega("device", "run-cmd", "-d", DEVICE, "-c", cmd)
  : vegaUntil(deadlineMs, "device", "run-cmd", "-d", DEVICE, "-c", cmd);
const xdo = (...args) => execFileP(XDOTOOL[0], [...XDOTOOL.slice(1), ...args], { env, timeout: 20000 });
// Keys go to the emulator window, which must have focus.
async function press(key) {
  const { stdout } = await execFileP("xwininfo", ["-root", "-tree"], { env, maxBuffer: 1 << 24 });
  const win = stdout.split("\n").find((line) => line.includes(`"${process.env.PLAYARR_FIRETV_WINDOW ?? "Vega Virtual Device"}"`))?.trim().split(/\s+/)[0];
  if (win) await xdo("windowfocus", win).catch(() => {});
  await xdo("key", key);
}
const KEYS = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Return", back: "Escape" };

function canonicalOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("PLAYARR_FIRETV_SERVER_ORIGIN must be an absolute HTTP(S) origin"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PLAYARR_FIRETV_SERVER_ORIGIN must be an absolute HTTP(S) origin");
  }
  return url.origin;
}

const scratch = resolve(process.env.PLAYARR_FIRETV_SCRATCH ?? "");
if (!process.env.PLAYARR_FIRETV_SCRATCH || !/(^|\/)\.data\/[^/]+\/[^/]+\/scratch\/.+/.test(scratch)) {
  throw new Error("PLAYARR_FIRETV_SCRATCH must point to the authorised Fire TV task scratch directory");
}
mkdirSync(scratch, { recursive: true });
// A small frame of the emulator display (the clock painted out), for telling when the screen has stopped changing.
async function frame(name, deadlineMs) {
  const file = join(scratch, name);
  const raw = join(scratch, `${name}.raw.png`);
  await execFileUntil("import", ["-window", "root", "-crop", "1920x1080+0+0", "+repage", raw], { env }, deadlineMs);
  await execFileUntil("magick", [raw, "-resize", "320x180!", "-fill", "black", "-draw", "rectangle 75,6,135,22", file], { env }, deadlineMs);
  return file;
}
// Waits for matching frames; timeouts are failures, never implicit success.
async function settled(maxMs = 8000, beforeFrame = async () => undefined) {
  await waitForStableFrames({
    capture: async (name) => { await beforeFrame(); return frame(name); },
    compare: (first, second) => execFileP("magick", ["compare", "-metric", "AE", "-fuzz", "2%", first, second, "null:"], { env }),
    sleep,
    maxMs,
    prefix: "settle",
  });
}

export async function createDriver({ out } = {}) {
  let seq = 0;
  const answers = new Map();
  if (!out) throw new Error("Fire TV driver requires a prepared output directory");
  let fixedNow = null;

  // The vega CLI prints a command's output only when it ends, so a log cannot be streamed: read what the app has logged since
  // the run began (`loggingctl log -S`, its own lines only) until the answer with our sequence number shows up.
  const runId = Date.now().toString(36);
  let offsetMs = null; // device clock minus host clock
  const fmt = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  async function readAnswers(deadlineMs) {
    if (offsetMs === null) {
      const text = (await onDevice("date -u +'%Y-%m-%d %H:%M:%S'", deadlineMs)).trim().split("\n").pop();
      offsetMs = Date.parse(text.replace(" ", "T") + "Z") - Date.now();
    }
    // Only the last 25 s: during playback the app logs heavily, and the whole run's log would be megabytes per poll.
    const from = fmt(Date.now() + offsetMs - 25000);
    const text = await onDevice(`loggingctl log -S '${from}' -v ${APP.replace(/\.main$/, "")}`, deadlineMs);
    for (const line of text.split("\n")) {
      const hit = line.indexOf("PARITY {");
      if (hit < 0) continue;
      try {
        const state = JSON.parse(line.slice(hit + 7).replace(/'?\s*$/, ""));
        if (state.seq != null) answers.set(String(state.seq), state);
      } catch { /* a line cut off */ }
    }
  }

  async function send(params, deadlineMs) {
    const n = `${runId}-${++seq}`;
    const query = Object.entries({ ...params, seq: n }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    await onDevice(`vmsgr send 'pkg://${APP}?${query}'`, deadlineMs);
    return n;
  }
  async function state(timeoutMs = 25000, deadlineMs) {
    const cutoff = Math.min(Date.now() + timeoutMs, deadlineMs ?? Infinity);
    const n = await send({ cmd: "state" }, cutoff);
    const t0 = Date.now();
    while (Date.now() < cutoff) {
      await sleep(Math.min(1200, Math.max(0, cutoff - Date.now())));
      await readAnswers(cutoff);
      if (answers.has(n)) return answers.get(n);
    }
    throw new Error("the app did not answer the state request (is it built with PLAYARR_PARITY_CONTROL=1 and in the foreground?)");
  }
  async function verifyAccount({ selector, deadlineMs } = {}) {
    // Read secrets afresh at each protected boundary so an authorised server
    // update cannot leave a stale allowlist active in a long-running driver.
    const secrets = readSecrets();
    const allowedUsernames = loadAllowedDeviceTestUsernames({ secrets });
    const trustedServerUrl = loadTrustedDeviceTestServerUrl({ secrets });
    // The coordinator may explicitly select the user-authorised emulator
    // origin when the account's stored trusted URL is a relay. This is an
    // exact-origin override only; the current profile must still match the
    // device-test username allowlist on every protected operation.
    const expectedServerUrl = process.env.PLAYARR_FIRETV_SERVER_ORIGIN
      ? canonicalOrigin(process.env.PLAYARR_FIRETV_SERVER_ORIGIN)
      : trustedServerUrl;
    if (allowedUsernames.size === 0) throw new Error("device-test account guard is not configured");
    const current = await state(25000, deadlineMs);
    assertDeviceTestIdentity({ identity: current.identity, allowedUsernames, expectedServerUrl });
    const selected = selectDeviceTestAccount(current.identity, secrets, selector);
    return { verified: true, ...(selected ? { selected } : {}) };
  }
  const requireAccount = verifyAccount;
  // A command answers after its effect settles; wait for that answer so the next step starts on the new screen.
  async function command(params, settleMs = 3500) {
    const n = await send(params);
    const t0 = Date.now();
    await sleep(settleMs);
    while (Date.now() - t0 < 25000 && !answers.has(n)) {
      await readAnswers();
      if (!answers.has(n)) await sleep(1000);
    }
    if (!answers.has(n)) throw new Error(`Fire TV command ${params.cmd} did not return state before timeout`);
    return answers.get(n);
  }
  const launch = async () => {
    const deadline = Date.now() + 30000;
    await vegaUntil(deadline, "device", "terminate-app", "-d", DEVICE, "--appName", APP).catch(() => {});
    if (Date.now() >= deadline) throw new Error("Fire TV app launch exceeded its startup deadline");
    await sleep(Math.min(2000, deadline - Date.now()));
    await vegaUntil(deadline, "device", "launch-app", "-d", DEVICE, "--appName", APP);
    // Wait for the app's parity listener with read-only state requests. Startup
    // timing varies; never use a remote key as a readiness probe.
    while (Date.now() < deadline) {
      try {
        await state(Math.min(5000, deadline - Date.now()), deadline);
        return;
      } catch {
        await sleep(500);
      }
    }
    throw new Error("Fire TV app did not answer read-only startup state requests before timeout");
  };
  // Navigate through the instrumented route channel after verifying the current account.
  // Never use a blind remote key on the profile picker, where it could select an unintended profile.
  const intoHome = async () => {
    await verifyAccount();
    let current = await state();
    if (current.route === "/profiles") current = await command({ cmd: "route", path: "/" }, 4000);
    if (current.route === "/home" || current.route === "/") return current;
    throw new Error(`the app did not reach Home from its current route (${current.route ?? "unknown"})`);
  };
  const waitSettled = async () => settled(30000, requireAccount);

  return {
    async setDeterministicCapture({ fixedNow: requestedNow, disableAnimations } = {}) {
      if (typeof requestedNow !== "string" || !Number.isFinite(Date.parse(requestedNow))) throw new Error("Fire TV deterministic capture requires a valid fixedNow ISO date");
      if (disableAnimations !== true) throw new Error("Fire TV deterministic capture requires disableAnimations: true");
      await requireAccount();
      const current = await state();
      if (typeof current.parityClock !== "string" || Date.parse(current.parityClock) !== Date.parse(requestedNow)) throw new Error("Fire TV app parity clock does not match the requested fixedNow; rebuild with PLAYARR_PARITY_CLOCK");
      fixedNow = current.parityClock;
      // The parity Babel transform rewrites every Animated.timing duration to zero, preserving final values and callbacks.
      if (current.parityAnimationsDisabled !== true) throw new Error("Fire TV app bundle must report parityAnimationsDisabled before deterministic capture");
    },
    async captureBuildIdentity() {
      await requireAccount();
      const artifact = process.env.PLAYARR_FIRETV_ARTIFACT;
      const expectedBuildId = process.env.PLAYARR_PARITY_BUILD_ID;
      if (!artifact || !artifact.endsWith(".vpkg")) throw new Error("PLAYARR_FIRETV_ARTIFACT must name the built Vega package for build identity");
      if (!expectedBuildId || !/^[0-9a-f]{40,64}$/i.test(expectedBuildId)) throw new Error("PLAYARR_PARITY_BUILD_ID must be the source revision compiled into the app");
      const current = await state();
      if (current.parityBuildId !== expectedBuildId) throw new Error("running Fire TV app build ID does not match PLAYARR_PARITY_BUILD_ID");
      if (!(await stat(artifact)).isFile()) throw new Error("Fire TV build artifact is not a regular file");
      const bytes = await readFile(artifact);
      return { package: APP, sourceBuildId: current.parityBuildId, sha256: createHash("sha256").update(bytes).digest("hex") };
    },
    async waitReady({ screen, phase = "capture" } = {}) {
      const deadline = Date.now() + 30000;
      await requireAccount({ deadlineMs: deadline });
      if (!screen || !["route", "focus", "capture"].includes(phase)) throw new Error("Fire TV readiness requires a screen and a supported phase");
      if (!fixedNow) throw new Error("Fire TV readiness requires setDeterministicCapture first");
      const suite = JSON.parse(readFileSync(new URL("../suite.json", import.meta.url), "utf8"));
      const record = suite.screens.find((item) => item.id === screen);
      if (phase !== "focus" && !record) throw new Error(`Fire TV readiness does not recognise screen ${screen}`);
      const expected = record ? (record.match ?? record.route) : null;
      const expectedRoute = screen === "actions" ? "/movies?panel=actions" : expected;
      let prior = "";
      let priorActivity = "";
      let stable = 0;
      let priorFrame = null;
      let readinessFrameName = "readiness-a.png";
      while (Date.now() < deadline) {
        const current = await state(7000, deadline);
        const route = current.route === "/home" ? "/" : current.route;
        const matches = phase === "focus"
          ? typeof route === "string" && route.startsWith("/")
          : routeMatches(expectedRoute, route ?? "");
        const focus = current.focus ? JSON.stringify(current.focus) : "";
        const stableKey = `${route ?? ""}\n${focus}`;
        const activity = current.activity;
        const activityKey = JSON.stringify(activity ?? null);
        const idle = activity && activity.apiPending === 0 && activity.imagesPending === 0;
        if (matches && focus && stableKey === prior && idle && activityKey === priorActivity) stable += 1;
        else stable = 0;
        if (matches && stable >= 2) {
          await requireAccount({ deadlineMs: deadline });
          const nextFrame = await frame(readinessFrameName, deadline);
          readinessFrameName = readinessFrameName === "readiness-a.png" ? "readiness-b.png" : "readiness-a.png";
          if (priorFrame && await framesMatch((first, second) => execFileUntil("magick", ["compare", "-metric", "AE", "-fuzz", "2%", first, second, "null:"], { env }, deadline), priorFrame, nextFrame)) {
            const confirmation = await state(7000, deadline);
            const sameRoute = confirmation.route === current.route;
            const sameFocus = JSON.stringify(confirmation.focus ?? null) === JSON.stringify(current.focus ?? null);
            const sameActivity = JSON.stringify(confirmation.activity ?? null) === activityKey;
            if (sameRoute && sameFocus && sameActivity && confirmation.activity?.apiPending === 0 && confirmation.activity?.imagesPending === 0) return;
          }
          priorFrame = nextFrame;
        }
        prior = stableKey;
        priorActivity = activityKey;
        await sleep(500);
      }
      throw new Error(`Fire TV ${phase} readiness timed out without stable route, focus, idle activity and matching frames for ${screen}`);
    },
    supports: { nowPlaying: false },
    /** For one-off scripts (player captures): the raw control-channel calls. */
    raw: {
      async command(params, settleMs) { await requireAccount(); return command(params, settleMs); },
      state,
      verifyAccount,
      async press(key) { await requireAccount(); return press(key); },
    },
    async start() {
      await launch();
      await intoHome();
    },
    async stop() {
    },
    async setTheme(theme) {
      await requireAccount();
      const s = await state();
      if (s.theme === theme) return;
      await command({ cmd: "theme", name: theme }, 6000);
    },
    async home() {
      // A relaunch: Home is only drawn with its first card focused when it is the first page after the profile is chosen
      // (reaching it through the nav leaves focus on the nav item).
      await launch();
      await intoHome();
      // Home draws its rails after the data arrives; a key before a card holds focus is spent on claiming focus, not moving it.
      for (let i = 0; i < 15; i++) {
        const s = await state(8000).catch(() => null);
        if (s?.focus) break;
        await sleep(2000);
      }
      await settled(12000, requireAccount);
    },
    async key(name, { long } = {}) {
      await requireAccount();
      const key = KEYS[name];
      if (!key) throw new Error(`unknown key ${name}`);
      await settled(8000, requireAccount);
      if (long) {
        // Menu is the long press on Vega (opens the title actions drawer)
        await requireAccount();
        await press("F2");
        await sleep(2500);
        return;
      }
      await requireAccount();
      await press(key);
      await sleep(900);
      if (name === "select" || name === "back") return;
      await settled(5000, requireAccount);
      // Send exactly one key per harness action. An unchanged focus is evidence for the test to report, not a retry signal.
    },
    async route(path) {
      await requireAccount();
      const title = path.match(/^\/(movies|series)\/([0-9a-f-]{36})/);
      if (title) await command({ cmd: "open", kind: title[1], id: title[2] }, 9000);
      else await command({ cmd: "route", path }, 4000);
      await waitSettled();
      if (path === "/search") {
        // The search field opens the system keyboard on arrival; the suite captures the page with it dismissed (as on web).
        await requireAccount();
        await press("Escape");
        await sleep(2500);
        if ((await state()).route !== "/search") await command({ cmd: "route", path }, 4000);
      }
    },
    async location() {
      return (await state()).route;
    },
    async focused() {
      const f = (await state()).focus;
      return f ?? null;
    },
    async screenshot(file) {
      await requireAccount();
      const s = await state();
      if (!s.route || s.route === "/profiles" && !file.includes("profiles")) throw new Error(`not a content screen: ${s.route}`);
      await settled(12000, requireAccount);
      await requireAccount();
      await execFileP("import", ["-window", "root", "-crop", "1920x1080+0+0", "+repage", file], { env });
    },
    async play(c, expect) {
      await requireAccount();
      await command({ cmd: "play", file: c.file }, 500);
      const t0 = Date.now();
      let first = null;
      let last = null;
      let detail;
      while (Date.now() - t0 < (expect.startWithinSeconds + 5) * 1000) {
        const s = (await state()).player;
        if (s.error) { detail = s.error; break; }
        if (s.state === "playing") { first = { at: (Date.now() - t0) / 1000, pos: s.positionSeconds }; break; }
        await sleep(1000);
      }
      if (!first) {
        await requireAccount();
        await command({ cmd: "stop" }, 500).catch(() => {});
        return { state: detail ? "error" : "stalled", startSeconds: null, advancedSeconds: 0, detail: detail ?? "no frames in time" };
      }
      // judged as playing once the playhead advances by advanceSeconds within advanceSeconds + 6 s of wall clock
      let advanced = 0;
      const t1 = Date.now();
      while (Date.now() - t1 < (expect.advanceSeconds + 6) * 1000 && advanced < expect.advanceSeconds) {
        await sleep(1000);
        const s = (await state()).player;
        last = s;
        advanced = Math.max(0, s.positionSeconds - first.pos);
      }
      await requireAccount();
      await command({ cmd: "stop" }, 500).catch(() => {});
      return { state: advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds: first.at, advancedSeconds: advanced, ...(last?.error ? { detail: last.error } : {}) };
    },
  };
}
