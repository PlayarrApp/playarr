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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);
const VEGA = (process.env.PLAYARR_FIRETV_VEGA ?? "vega").split(" ");
const DEVICE = process.env.PLAYARR_FIRETV_DEVICE ?? "VirtualDevice";
const APP = process.env.PLAYARR_FIRETV_APP ?? "com.streamarr.firetv.main";
const DISPLAY = process.env.PLAYARR_FIRETV_DISPLAY ?? ":23";
const XDOTOOL = (process.env.PLAYARR_FIRETV_XDOTOOL ?? "xdotool").split(" ");
const dbg = (...a) => process.env.PLAYARR_FIRETV_DEBUG && console.error("[firetv]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, DISPLAY, ...(process.env.PLAYARR_FIRETV_LIBS ? { LD_LIBRARY_PATH: `${process.env.PLAYARR_FIRETV_LIBS}:${process.env.LD_LIBRARY_PATH ?? ""}` } : {}) };

const vega = (...args) => (dbg("vega", args.join(" ").slice(0, 120)), execFileP(VEGA[0], [...VEGA.slice(1), ...args], { env, timeout: 90000, maxBuffer: 1 << 24 }).then((r) => r.stdout + r.stderr));
const onDevice = (cmd) => vega("device", "run-cmd", "-d", DEVICE, "-c", cmd);
const xdo = (...args) => execFileP(XDOTOOL[0], [...XDOTOOL.slice(1), ...args], { env, timeout: 20000 });
// Keys go to the emulator window, which must have focus.
async function press(key) {
  const { stdout } = await execFileP("xwininfo", ["-root", "-tree"], { env, maxBuffer: 1 << 24 });
  const win = stdout.split("\n").find((line) => line.includes(`"${process.env.PLAYARR_FIRETV_WINDOW ?? "Vega Virtual Device"}"`))?.trim().split(/\s+/)[0];
  if (win) await xdo("windowfocus", win).catch(() => {});
  await xdo("key", key);
}
const KEYS = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Return", back: "Escape" };

const scratch = mkdtempSync(join(tmpdir(), "firetv-"));
// A small frame of the emulator display (the clock painted out), for telling when the screen has stopped changing.
async function frame(name) {
  const file = join(scratch, name);
  await execFileP("sh", ["-c", `import -window root -crop 1920x1080+0+0 +repage png:- | magick png:- -resize 320x180! -fill black -draw 'rectangle 75,6,135,22' ${file}`], { env });
  return file;
}
// Waits until two frames 0.8 s apart are the same (at most maxMs): a key sent while a page is still drawing is often dropped.
async function settled(maxMs = 8000) {
  const t0 = Date.now();
  let before = await frame("a.png");
  while (Date.now() - t0 < maxMs) {
    await sleep(800);
    const now = await frame("b.png");
    const diff = await execFileP("sh", ["-c", `magick compare -metric AE -fuzz 2% ${before} ${now} null: 2>&1 || true`], { env });
    if (Number(String(diff.stdout).trim().split(" ")[0]) <= 4) return;
    before = await frame("a.png");
  }
}

export async function createDriver({ out } = {}) {
  let seq = 0;
  const answers = new Map();

  // The vega CLI prints a command's output only when it ends, so a log cannot be streamed: read what the app has logged since
  // the run began (`loggingctl log -S`, its own lines only) until the answer with our sequence number shows up.
  const runId = Date.now().toString(36);
  const ticks = [];
  let offsetMs = null; // device clock minus host clock
  const fmt = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  async function readAnswers() {
    if (offsetMs === null) {
      const text = (await onDevice("date -u +'%Y-%m-%d %H:%M:%S'")).trim().split("\n").pop();
      offsetMs = Date.parse(text.replace(" ", "T") + "Z") - Date.now();
    }
    // Only the last 25 s: during playback the app logs heavily, and the whole run's log would be megabytes per poll.
    const from = fmt(Date.now() + offsetMs - 25000);
    const text = await onDevice(`loggingctl log -S '${from}' -v ${APP.replace(/\.main$/, "")}`);
    for (const line of text.split("\n")) {
      const hit = line.indexOf("PARITY {");
      if (hit < 0) continue;
      try {
        const state = JSON.parse(line.slice(hit + 7).replace(/'?\s*$/, ""));
        if (state.seq != null) answers.set(String(state.seq), state);
        if (state.cmd === "tick") ticks.push(state);
      } catch { /* a line cut off */ }
    }
  }

  async function send(params) {
    const n = `${runId}-${++seq}`;
    const query = Object.entries({ ...params, seq: n }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    await onDevice(`vmsgr send 'pkg://${APP}?${query}'`);
    return n;
  }
  async function state(timeoutMs = 25000) {
    const n = await send({ cmd: "state" });
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(1200);
      await readAnswers();
      if (answers.has(n)) return answers.get(n);
      // the player's repeated state (the app sends it every 2 s while the player is up) stands in for a lost answer
      const tick = ticks.filter((x) => x.t >= t0 + (offsetMs ?? 0) - 500).pop();
      if (tick) return { ...tick, focus: null, theme: null };
    }
    throw new Error("the app did not answer the state request (is it built with PLAYARR_PARITY_CONTROL=1 and in the foreground?)");
  }
  // A command answers after its effect settles; wait for that answer so the next step starts on the new screen.
  async function command(params, settleMs = 3500) {
    const n = await send(params);
    const t0 = Date.now();
    await sleep(settleMs);
    while (Date.now() - t0 < 25000 && !answers.has(n)) {
      await readAnswers();
      if (!answers.has(n)) await sleep(1000);
    }
    return answers.get(n) ?? null;
  }
  const launch = async () => {
    await vega("device", "terminate-app", "-d", DEVICE, "--appName", APP).catch(() => {});
    await sleep(2000);
    await vega("device", "launch-app", "-d", DEVICE, "--appName", APP);
  };
  // The profile picker opens first: Enter chooses the Device Test profile (the first, focused one).
  const intoHome = async () => {
    await sleep(9000);
    await press("Return");
    for (let i = 0; i < 20; i++) {
      await sleep(2500);
      const s = await state(7000).catch(() => null);
      if (s && s.route && s.route !== "/profiles") return s;
    }
    throw new Error("the app did not reach Home after choosing the profile (signed out?)");
  };
  const waitSettled = async () => {
    // a library or calendar page fills in after the route changes; wait until two frames agree
    await sleep(6000);
  };

  return {
    supports: { nowPlaying: false },
    /** For one-off scripts (player captures): the raw control-channel calls. */
    raw: { command, state, press },
    async start() {
      await launch();
      await intoHome();
    },
    async stop() {
    },
    async setTheme(theme) {
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
      await settled(12000);
    },
    async key(name, { long } = {}) {
      const key = KEYS[name];
      if (!key) throw new Error(`unknown key ${name}`);
      await settled();
      if (long) {
        // Menu is the long press on Vega (opens the title actions drawer)
        await press("F2");
        await sleep(2500);
        return;
      }
      const arrow = name !== "select" && name !== "back";
      const before = arrow ? JSON.stringify((await state(8000).catch(() => ({}))).focus ?? null) : null;
      await press(key);
      await sleep(900);
      if (!arrow) return;
      // The virtual device drops a key now and then; an arrow that changed nothing is sent once more (at a rail's edge that is
      // harmless: the focus stays put).
      await settled(5000);
      const after = JSON.stringify((await state(8000).catch(() => ({}))).focus ?? null);
      if (after === before) {
        await press(key);
        await sleep(900);
      }
    },
    async route(path) {
      const title = path.match(/^\/(movies|series)\/([0-9a-f-]{36})/);
      if (title) await command({ cmd: "open", kind: title[1], id: title[2] }, 9000);
      else await command({ cmd: "route", path }, 4000);
      await waitSettled();
      if (path === "/search") {
        // The search field opens the system keyboard on arrival; the suite captures the page with it dismissed (as on web).
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
      const s = await state();
      if (!s.route || s.route === "/profiles" && !file.includes("profiles")) throw new Error(`not a content screen: ${s.route}`);
      await sleep(1500);
      await execFileP("import", ["-window", "root", "-crop", "1920x1080+0+0", "+repage", file], { env });
    },
    async play(c, expect) {
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
      await command({ cmd: "stop" }, 500).catch(() => {});
      return { state: advanced >= expect.advanceSeconds ? "playing" : "stalled", startSeconds: first.at, advancedSeconds: advanced, ...(last?.error ? { detail: last.error } : {}) };
    },
  };
}
