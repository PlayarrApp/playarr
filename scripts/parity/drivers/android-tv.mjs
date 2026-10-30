// Android TV driver for the shared parity suite (docs/parity/SUITE.md): a debug build of clients/android on an emulator or
// device over adb, D-pad keys only. Needs the debug `parity_route` launch extra and the `PlayarrParity` log lines (debug builds).
//   ANDROID_SERIAL (adb target), ANDROID_HOME or adb on PATH, PARITY_PACKAGE (default io.playarr.mobile),
//   PARITY_LINK_CMD (command that approves a TV link code for the Device Test account; the code is appended: the account's
//   sessions are evicted by other runs, so a signed-out app links again, then carries on),
//   PARITY_XDISPLAY (e.g. :98: read screenshots from the emulator's X window; the guest screencap can crash some emulators).
//   PARITY_DEVICE_ACCOUNT_GUARD=android and PARITY_USE_DEVICE_TEST_DPAD=1 enable the approved D-pad account identity guard.
// The device must already be signed in as the Device Test profile and out of touch mode (a fresh emulator boot is).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { checkLayout } from "../layout-check.mjs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { guardAndroidDeviceAccount } from "../capture-state.mjs";

const run = promisify(execFile);
const KEYS = { up: "DPAD_UP", down: "DPAD_DOWN", left: "DPAD_LEFT", right: "DPAD_RIGHT", select: "DPAD_CENTER", back: "BACK" };
const LIBRARIES = new Set(["movies", "series", "music", "search", "settings", "profiles", "watchlist", "requests", "downloads", "playlists", "folders"]);
const instantNanos = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  let offsetSeconds = 0;
  if (zone !== "Z" && zone !== "z") {
    const offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    const sign = zone[0] === "+" ? 1 : -1;
    offsetSeconds = sign * (offsetHour * 3600 + offsetMinute * 60);
  }
  const epochSeconds = BigInt(date.getTime() / 1000 - offsetSeconds);
  const nanos = BigInt(fraction.padEnd(9, "0") || "0");
  return epochSeconds * 1_000_000_000n + nanos;
};

// Nav route base each suite screen ends on; also the set of screens the app's capture barrier covers.
const EXPECTED_ROUTE = {
  home: "home", movies: "movies", series: "series", music: "music", search: "search", settings: "settings",
  profiles: "profiles", filters: "movies", actions: "movies", "calendar-month": "calendar", "calendar-week": "calendar",
  "calendar-agenda": "calendar", "film-detail": "experience-detail", "series-detail": "experience-detail",
  "player-controls": "experience-player",
};

export function captureReadinessState(lines, { generation, screen, surface }) {
  if (typeof generation !== "string" || !generation) return { ready: false, reason: "missing generation" };
  const marker = [...lines].reverse().find((line) => line.startsWith("capture_state ") && line.includes(`generation=${generation} `));
  if (!marker) return { ready: false, reason: "missing generation marker" };
  const fields = Object.fromEntries(marker.slice("capture_state ".length).split(/\s+/).map((part) => part.split("=")));
  const count = Number(fields.data_count), seen = Number(fields.art_seen), pending = Number(fields.art_pending), failed = Number(fields.art_failed);
  if (fields.screen !== screen) return { ready: false, reason: "wrong screen" };
  if (surface && fields.surface !== surface) return { ready: false, reason: "wrong surface" };
  if (fields.data !== "ready" || !Number.isSafeInteger(count) || count < 0) return { ready: false, reason: "route data loading" };
  if (fields.layout !== "ready") return { ready: false, reason: "layout loading" };
  if (![seen, pending, failed].every((value) => Number.isSafeInteger(value) && value >= 0) || pending !== 0 || failed !== 0 || (count > 0 && seen === 0)) return { ready: false, reason: "visible artwork incomplete" };
  return { ready: true, marker };
}

export function stableCaptureObservation(previous, current) {
  return Boolean(current.ready && current.routeMatches && current.focus &&
    previous.marker === current.marker && previous.focus === current.focus);
}

export function createDriver({ adbBin: adbOverride, commandTimeoutMs = 20_000, readinessTimeoutMs: readinessTimeoutArg = 60_000, readinessPollMs = 3_000, clock = {}, env: envOverride = process.env, accountGuard = guardAndroidDeviceAccount, execute = run } = {}) {
  const env = envOverride, pkg = env.PARITY_PACKAGE ?? "io.playarr.mobile";
  // A loaded host can need longer than a minute for the player route's artwork: PARITY_READINESS_TIMEOUT_MS raises the wait.
  const readinessTimeoutMs = env.PARITY_READINESS_TIMEOUT_MS ? Number(env.PARITY_READINESS_TIMEOUT_MS) : readinessTimeoutArg;
  const adbBin = adbOverride ?? (env.ANDROID_HOME ? `${env.ANDROID_HOME}/platform-tools/adb` : "adb");
  // Injectable clock (tests): the readiness loop's deadline arithmetic then never depends on how long a real process took.
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const execBounded = async (command, args, { timeoutMs = commandTimeoutMs, label = "external command", ...options } = {}) => {
    try {
      return await execute(command, args, { env, ...options, timeout: timeoutMs, killSignal: "SIGTERM" });
    } catch (e) {
      if (e.killed && e.signal === "SIGTERM") throw new Error(`${label} timed out after ${timeoutMs}ms`);
      throw e;
    }
  };
  const adbOnce = async (timeoutMs, ...a) => {
    const command = [a[0], a[0] === "shell" ? a[1] : a[0] === "exec-out" ? a[1] : ""].filter(Boolean).join(" ");
    return (await execBounded(adbBin, a, { timeoutMs, maxBuffer: 64 << 20, encoding: "utf8", label: `adb ${command}` })).stdout;
  };
  const adbWithTimeout = (timeoutMs, ...a) => adbOnce(timeoutMs, ...a);
  // An emulator that restarts mid-run (a crash): wait for it to boot again, then retry the command once.
  const adb = async (...a) => {
    try { return await adbOnce(commandTimeoutMs, ...a); } catch (e) {
      if (!/offline|closed|not found|no devices|cannot connect/i.test(String(e.stderr ?? e.message))) throw e;
      const deadline = now() + 120_000;
      let booted = false;
      while (now() < deadline) {
        await sleep(Math.min(5000, deadline - now()));
        const probeTimeout = Math.min(5000, deadline - now());
        if (probeTimeout <= 0) break;
        try {
          if ((await adbOnce(probeTimeout, "shell", "getprop", "sys.boot_completed")).trim() === "1") { booted = true; break; }
        } catch { /* still booting */ }
      }
      if (!booted) throw new Error("emulator did not finish booting within 120s after adb disconnected");
      await sleep(Math.min(30_000, Math.max(0, deadline - now())));
      return adbOnce(Math.min(commandTimeoutMs, Math.max(1, deadline - now())), ...a);
    }
  };
  const shell = (...a) => adb("shell", ...a);
  const guardDeviceAccount = async () => {
    if (env.PARITY_DEVICE_ACCOUNT_GUARD !== "android") return;
    await accountGuard({ ...env, PARITY_PACKAGE: pkg });
  };
  let theme = "dark";
  let parityClock = null;
  let captureGeneration = null;
  let captureScreen = null;
  let captureSurface = null;
  let captureTarget = null;
  let savedAnimationScales = null;
  let savedRegion = null; // { timeZone, locales } as found, restored in stop()
  const animationScaleKeys = ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"];

  const parityLines = async () => (await adb("logcat", "-d", "-s", "PlayarrParity:I")).split("\n").map((l) => l.replace(/^.*PlayarrParity: /, "")).filter(Boolean);
  // pause: the debug build pauses the player at 2 s (0:02, as the web ref; PARITY_PAUSE_AT_MS overrides), a still frame for the player-controls screen; off for playback cases.
  // The software-GL emulator leaks about 190 MiB of host memory per app launch and wedges adb near its cgroup limit: every
  // PARITY_EMU_RECYCLE_EVERY launches (default 8) PARITY_EMU_RECYCLE_CMD restarts it (app data and the sign-in survive).
  let launches = 0;
  const recycleEvery = Number(env.PARITY_EMU_RECYCLE_EVERY ?? 8);
  const launch = async (route, pause = true) => {
    if (env.PARITY_EMU_RECYCLE_CMD && ++launches > recycleEvery) {
      launches = 1;
      const [cmd, ...rest] = env.PARITY_EMU_RECYCLE_CMD.split(" ");
      await execBounded(cmd, rest, { timeoutMs: 420_000, label: "emulator recycle command" });
    }
    await guardDeviceAccount();
    const requestedCaptureScreen = captureTarget ? (captureSurface ? "movies" : captureTarget) : null;
    captureScreen = requestedCaptureScreen ?? (["movies", "series", "music"].includes(route) ? route : null);
    captureGeneration = captureScreen ? randomUUID() : null;
    await shell("am", "force-stop", pkg);
    await adb("logcat", "-c");
    await shell("am", "start", "-n", `${pkg}/.MainActivity`, "--es", "parity_route", route,
      ...(parityClock ? ["--es", "parity_clock", parityClock] : []),
      ...(captureGeneration ? ["--es", "parity_capture_generation", captureGeneration, "--es", "parity_capture_screen", captureScreen] : []),
      ...(pause ? ["--el", "parity_pause_at_ms", env.PARITY_PAUSE_AT_MS ?? "2000"] : []));
    if (parityClock) await waitForClockConsumption();
  };
  const waitForClockConsumption = async () => {
    const deadline = now() + Math.min(readinessTimeoutMs, 15_000);
    const expectedInstant = instantNanos(parityClock);
    while (now() < deadline) {
      const consumed = (await parityLines()).some((line) => line.startsWith("clock_consumed=") && instantNanos(line.slice("clock_consumed=".length)) === expectedInstant);
      if (consumed) return;
      await sleep(Math.min(250, Math.max(0, deadline - now())));
    }
    throw new Error("Android debug app did not confirm consuming PARITY_FIXED_NOW within 15s");
  };
  // Web route to the app's own route string.
  const appRoute = (r) => {
    const [path, query] = r.split("?");
    if (path === "/") return "home";
    if (path === "/calendar") return `calendar?query=${encodeURIComponent(query ?? "")}`;
    if (path.startsWith("/player/")) return `experience-player/${path.slice(8)}`;
    if (/^\/(movies|series)\/[^/]+$/.test(path)) return `experience-detail/${path.split("/")[2]}`;
    return path.slice(1) + (query ? `?${query}` : "");
  };
  // Each adb call gets the full command timeout: clamping it to the time left before a readiness deadline gave calls a few
  // milliseconds near the end, which a real process cannot meet (a flaky "timed out after 26ms").
  // docs/parity/LAYOUT.md: the debug app writes its own layout (semantics tree: text style, glyph-run bounds, controls) in the same state as the screenshot.
  // Asks the app for its layout and returns the document text, or null when none arrived.
  const requestLayout = async (theme, screen) => {
    await shell("run-as", pkg, "rm", "-f", "files/parity-layout.json").catch(() => {});
    await shell("am", "broadcast", "-a", "io.playarr.mobile.PARITY_LAYOUT", "-p", pkg, "--es", "screen", screen, "--es", "theme", theme, "--ez", "rendered", "true");
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const json = await adb("exec-out", "run-as", pkg, "cat", "files/parity-layout.json").catch(() => "");
      if (json.startsWith("{")) return json;
    }
    return null;
  };
  // Real-screen occlusion (docs/parity/LAYOUT.md): the app flags the elements that lie wholly inside a higher window's opaque container. Toggle and diff:
  // hide every window below the top one, screenshot again, and keep a flagged element only if the pixels in its own rectangle changed (the lower window showed there).
  // A flagged fill (a drawer panel) is read from the screenshot: the most common colour among the pixels of its rectangle that no other exported element's rectangle covers.
  const sampleFills = (layout, shown) => {
    const img = PNG.sync.read(shown);
    for (const e of layout.elements) {
      if (!e.sampled) continue;
      delete e.sampled;
      const x0 = Math.max(0, Math.floor(e.rect.x)), y0 = Math.max(0, Math.floor(e.rect.y));
      const x1 = Math.min(img.width, Math.ceil(e.rect.x + e.rect.w)), y1 = Math.min(img.height, Math.ceil(e.rect.y + e.rect.h));
      const inner = layout.elements.filter((o) => o !== e && o.rect.x < x1 && o.rect.x + o.rect.w > x0 && o.rect.y < y1 && o.rect.y + o.rect.h > y0 && o.rect.w * o.rect.h < e.rect.w * e.rect.h);
      const counts = new Map();
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        if (inner.some((o) => x >= Math.floor(o.rect.x) - 1 && x <= Math.ceil(o.rect.x + o.rect.w) && y >= Math.floor(o.rect.y) - 1 && y <= Math.ceil(o.rect.y + o.rect.h))) continue;
        const i = (img.width * y + x) * 4, key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let best = null;
      for (const [k, n] of counts) if (!best || n > best[1]) best = [k, n];
      if (best) e.background = `#${best[0].toString(16).padStart(6, "0")}`;
    }
  };
  const resolveCovered = async (layout, shown) => {
    const flagged = layout.elements.filter((e) => e.covered);
    const sameWindow = flagged.filter((e) => e.coverIds);
    const windowLevel = flagged.filter((e) => !e.coverIds);
    sampleFills(layout, shown);
    const img = PNG.sync.read(shown);
    // Pixels of the element's own rectangle that differ between the screen as shown and the screen with something hidden.
    const changedFraction = (e, other) => {
      const x0 = Math.max(0, Math.floor(e.rect.x)), y0 = Math.max(0, Math.floor(e.rect.y));
      const x1 = Math.min(img.width, Math.ceil(e.rect.x + e.rect.w)), y1 = Math.min(img.height, Math.ceil(e.rect.y + e.rect.h));
      let changed = 0, total = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (img.width * y + x) * 4;
        total++;
        if (Math.abs(img.data[i] - other.data[i]) + Math.abs(img.data[i + 1] - other.data[i + 1]) + Math.abs(img.data[i + 2] - other.data[i + 2]) > 24) changed++;
      }
      return total ? changed / total : 0;
    };
    const hiddenShot = async (windows, ids) => {
      try {
        await shell("am", "broadcast", "-a", "io.playarr.mobile.PARITY_COVER", "-p", pkg, "--ez", "on", windows ? "true" : "false", "--es", "ids", ids.length ? ids.join(",") : "none");
        await sleep(800);
        return PNG.sync.read(await grab());
      } finally {
        await shell("am", "broadcast", "-a", "io.playarr.mobile.PARITY_COVER", "-p", pkg, "--ez", "on", "false", "--es", "ids", "none");
        await sleep(500);
      }
    };
    const drop = new Set();
    // Elements under a higher window: hide that window's cover (every lower window); an element whose own pixels do not change was not showing.
    if (windowLevel.length) {
      const bare = await hiddenShot(true, []);
      for (const e of windowLevel) if (changedFraction(e, bare) === 0) drop.add(e);
    }
    // Elements under a later painted box of the same window: hide the covers' paint. Hiding must not remove an ancestor of a candidate in the same pass, so candidates are grouped.
    const groups = [];
    for (const e of sameWindow) {
      const g = groups.find((g) => !e.coverIds.some((id) => g.members.some((m) => m.chainIds.includes(id))) && !g.hide.some((id) => e.chainIds.includes(id)));
      if (g) { g.members.push(e); for (const id of e.coverIds) if (!g.hide.includes(id)) g.hide.push(id); }
      else groups.push({ members: [e], hide: [...e.coverIds] });
    }
    for (const g of groups) {
      const bare = await hiddenShot(false, g.hide);
      for (const e of g.members) if (changedFraction(e, bare) >= 0.9) drop.add(e);
    }
    for (const e of layout.elements) { delete e.covered; delete e.coverIds; delete e.chainIds; }
    // The screen must be back as it was, else the frame kept would not be the one described.
    if (flagged.length && !(await grab()).equals(shown)) return false;
    layout.elements = layout.elements.filter((e) => !drop.has(e));
    layout.occluded = drop.size;
    return true;
  };
  const grab = async () => env.PARITY_XDISPLAY
    ? (await execBounded("import", ["-window", "root", "png:-"], { encoding: "buffer", maxBuffer: 64 << 20, env: { ...env, DISPLAY: env.PARITY_XDISPLAY }, label: "screen capture import" })).stdout
    : (await execBounded(adbBin, ["exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 << 20, label: "adb exec-out screencap" })).stdout;
  const tree = async () => {
    try {
      await adbWithTimeout(commandTimeoutMs, "shell", "uiautomator", "dump", "/sdcard/parity-ui.xml");
    } catch (error) {
      // A dump that timed out leaves its uiautomator process running on the device, and every later dump then fails with
      // "already registered": stop it and try once more.
      await adbWithTimeout(commandTimeoutMs, "shell", "pkill", "-f", "uiautomator").catch(() => {});
      try { await adbWithTimeout(commandTimeoutMs, "shell", "uiautomator", "dump", "/sdcard/parity-ui.xml"); } catch { throw error; }
    }
    return adbWithTimeout(commandTimeoutMs, "exec-out", "cat", "/sdcard/parity-ui.xml");
  };
  const attr = (node, name) => (node.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const bounds = (n) => (attr(n, "bounds").match(/\d+/g) ?? []).map(Number);

  // Wait until the app has put focus on something (a loaded page): keys sent before that are lost.
  const settled = async (timeoutMs = readinessTimeoutMs) => {
    const deadline = now() + timeoutMs;
    let previousFocus = "", stableFocus = 0;
    while (now() < deadline) {
      await sleep(Math.min(readinessPollMs, deadline - now()));
      if (now() >= deadline) break;
      const xml = await tree();
      const focus = (xml.match(/<node [^>]*>/g) ?? []).find((n) => attr(n, "focused") === "true" && attr(n, "focusable") === "true") ?? "";
      if (focus && focus === previousFocus) stableFocus += 1;
      else stableFocus = 0;
      if (focus && stableFocus >= 1) return;
      previousFocus = focus;
    }
    throw new Error(`screen readiness timed out after ${timeoutMs}ms (no stable accessibility focus)`);
  };
  // The sign-in screen shows a link code; approve it (PARITY_LINK_CMD) and relaunch. Returns true when it had to sign in.
  const relink = async (route, pause) => {
    for (let tries = 0; tries < 3; tries++) {
      const xml = await tree();
      if (!/Sign in to Playarr/.test(xml)) return tries > 0;
      const code = /text="([A-Z0-9]{4}-[A-Z0-9]{4})"/.exec(xml)?.[1];
      if (!code || !env.PARITY_LINK_CMD) throw new Error("signed out and no link code or PARITY_LINK_CMD to approve it");
      const [cmd, ...rest] = env.PARITY_LINK_CMD.split(" ");
      try {
        await execBounded(cmd, [...rest, code], { timeoutMs: 30_000, label: "TV link approval command" });
      } catch (e) {
        if (/^TV link approval command timed out after \d+ms$/.test(e.message)) throw e;
        throw new Error("TV link approval command failed");
      }
      await sleep(25000);
      await launch(route, pause);
      await settled();
    }
    throw new Error("still signed out after linking");
  };
  // The app's MediaSession as the now-playing entry: state PLAYING, a title in its metadata, and the system's pause command pauses it.
  const nowPlaying = async () => {
    const session = async () => {
      const t = await shell("dumpsys", "media_session");
      const block = t.split(/\n(?=\s{4}\S)/).find((b) => b.includes(`package=${pkg}`) && /active=true/.test(b)) ?? "";
      return { state: /state=PlaybackState \{state=(\w+)/.exec(block)?.[1] ?? "", title: (/metadata: size=\d+, description=([^,\n]*)/.exec(block)?.[1] ?? "").replace(/^null$/, "") };
    };
    const a = await session();
    await shell("cmd", "media_session", "dispatch", "pause"); await sleep(1500);
    const pausedOk = (await session()).state.startsWith("PAUSED");
    await shell("cmd", "media_session", "dispatch", "play"); await sleep(1500);
    return { title: a.title, state: a.state, pausedOk, ok: !!a.title && a.state.startsWith("PLAYING") && pausedOk };
  };
  return {
    supports: { nowPlaying: true },
    async setDeterministicCapture({ fixedNow, disableAnimations, timeZone, locale } = {}) {
      await guardDeviceAccount();
      if (typeof fixedNow !== "string" || !Number.isFinite(Date.parse(fixedNow)) || instantNanos(fixedNow) === null) throw new Error("Android deterministic capture requires a valid fixedNow ISO date");
      if (disableAnimations !== true) throw new Error("Android deterministic capture requires disableAnimations: true");
      parityClock = fixedNow;
      const scales = {};
      for (const key of animationScaleKeys) {
        const value = (await shell("settings", "get", "global", key)).trim();
        if (!value || value === "null") throw new Error(`Android cannot read system animation scale ${key}`);
        // A pre-disabled animation scale is not a useful baseline for restoration; return it to Android's normal scale.
        scales[key] = Number(value) === 0 ? "1" : value;
      }
      savedAnimationScales ??= scales;
      if (timeZone || locale) {
        // Pin the zone and the app locale with the clock so the pinned instant renders the same time string and date format as the web refs.
        savedRegion ??= { timeZone: (await shell("getprop", "persist.sys.timezone")).trim(), locales: ((await shell("cmd", "locale", "get-app-locales", pkg)).match(/\[(.*)\]/)?.[1] ?? "").trim() };
        if (timeZone) {
          await shell("cmd", "alarm", "set-timezone", timeZone);
          if ((await shell("getprop", "persist.sys.timezone")).trim() !== timeZone) throw new Error(`Android could not set time zone ${timeZone}`);
        }
        if (locale) await shell("cmd", "locale", "set-app-locales", pkg, "--locales", locale);
      }
      for (const key of animationScaleKeys) {
        await shell("settings", "put", "global", key, "0");
        if ((await shell("settings", "get", "global", key)).trim() !== "0") throw new Error(`Android could not disable system animation scale ${key}`);
      }
    },
    async waitReady({ screen, phase = "capture", surface } = {}) {
      if (!["route", "focus", "capture"].includes(phase)) throw new Error(`unsupported Android readiness phase: ${phase}`);
      const requestedSurface = surface ?? ({ filters: "filters", actions: "actions" }[screen]);
      const target = ["filters", "actions"].includes(screen) ? "movies" : screen ?? captureScreen;
      if (phase === "capture" && !(target in EXPECTED_ROUTE)) throw new Error(`Android stable capture readiness unsupported for ${screen ?? "unknown"}`);
      const displaySize = requestedSurface ? await shell("wm", "size") : "";
      const displayWidth = requestedSurface ? Number(/Override size:\s*(\d+)x/.exec(displaySize)?.[1] ?? /Physical size:\s*(\d+)x/.exec(displaySize)?.[1]) : 0;
      const deadline = now() + readinessTimeoutMs;
      let previous = "", previousMarker = "", previousPosition = "", stable = 0, lastReason = "";
      while (now() < deadline) {
        const lines = await parityLines();
        if (phase === "capture") {
          const capture = captureReadinessState(lines, { generation: captureGeneration, screen: target, surface: requestedSurface });
          const xml = await tree();
          if (/Try again|Sign in to Playarr|Scan the QR code/i.test(xml)) throw new Error("Android capture readiness reached a sign-in or error screen");
          const focus = (xml.match(/<node [^>]*>/g) ?? []).find((node) => {
            const rect = bounds(node);
            return attr(node, "focused") === "true" && attr(node, "focusable") === "true" && rect.length === 4 && rect[2] > rect[0] && rect[3] > rect[1] && rect[2] - rect[0] < 1900 && (!requestedSurface || (displayWidth > 0 && rect[0] >= displayWidth * 0.65));
          }) ?? "";
          const lastRouteLine = lines.findLast((line) => line.startsWith("route=")) ?? "";
          const currentRoute = /^route=(\S+)/.exec(lastRouteLine)?.[1]?.split("/")[0];
          // The player's capture marker flips between ready and loading as the controls auto-hide, so it never repeats: the paused frame
          // is the evidence instead. On the player route, the same focused control and the same paused position for three consecutive polls (the ready flag itself flips with the auto-hiding controls).
          const playerPosition = target === "player-controls" ? lines.findLast((line) => line.startsWith("player positionMs="))?.slice(18) ?? "none" : null;
          const steady = playerPosition !== null
            ? Boolean(currentRoute === EXPECTED_ROUTE[target] && focus && playerPosition !== "none" && playerPosition === previousPosition && focus === previous)
            : stableCaptureObservation({ marker: previousMarker, focus: previous }, { ready: capture.ready, routeMatches: currentRoute === EXPECTED_ROUTE[target], marker: capture.marker, focus });
          lastReason = !capture.ready ? capture.reason : !focus ? "no focused node" : currentRoute !== EXPECTED_ROUTE[target] ? `route ${currentRoute ?? "none"}` : playerPosition !== null ? `paused frame still moving (position ${previousPosition || "none"} then ${playerPosition}, focus ${focus === previous ? "held" : "changed"})` : focus !== previous ? "focus still changing" : "marker still changing";
          if (steady) {
            stable += 1;
            if (stable >= (playerPosition !== null ? 3 : 2)) return;
          } else stable = 0;
          if (playerPosition !== null) previousPosition = playerPosition;
          previous = focus;
          previousMarker = capture.ready ? capture.marker : "";
          await sleep(Math.min(readinessPollMs, Math.max(0, deadline - now())));
          continue;
        }
        const xml = await tree();
        if (/Try again|Sign in to Playarr|Scan the QR code/i.test(xml)) throw new Error(`Android ${phase} readiness reached a sign-in or error screen`);
        const lastRoute = lines.findLast((line) => line.startsWith("route=")) ?? "";
        const routeValue = /^route=(\S+)/.exec(lastRoute)?.[1] ?? "";
        const expectedRoute = EXPECTED_ROUTE[screen];
        const routeBase = routeValue.split("/")[0];
        const knownRoute = routeBase === "home" || LIBRARIES.has(routeBase) || routeBase === "calendar" ||
          routeBase === "experience-detail" || routeBase === "experience-player";
        const routeMatchesScreen = knownRoute && (!expectedRoute || routeBase === expectedRoute);
        const sectionMatchesScreen = screen !== "series-detail" || /\bsection=series(?:\s|$)/.test(lastRoute);
        const panelMatchesScreen = screen !== "filters" || lines.some((line) => line === "panel=filters");
        const focus = (xml.match(/<node [^>]*>/g) ?? []).find((node) => {
          const rect = bounds(node);
          return attr(node, "focused") === "true" && attr(node, "focusable") === "true" && rect.length === 4 && rect[2] > rect[0] && rect[3] > rect[1] && rect[2] - rect[0] < 1900;
        });
        if (focus && focus === previous) stable += 1;
        else stable = 0;
        if (focus && stable >= 1 && routeMatchesScreen && sectionMatchesScreen && panelMatchesScreen) return;
        previous = focus ?? "";
        await sleep(Math.min(readinessPollMs, Math.max(0, deadline - now())));
      }
      throw new Error(`Android ${phase} readiness timed out without stable focused content${lastReason ? ` (${lastReason})` : ""}`);
    },
    async setCaptureTarget(screen) {
      captureTarget = screen in EXPECTED_ROUTE ? screen : null;
      captureSurface = ({ filters: "filters", actions: "actions" })[screen] ?? null;
    },
    async captureBuildIdentity() {
      const apk = (await shell("pm", "path", pkg)).trim().match(/^package:(.+)$/m)?.[1];
      if (!apk) throw new Error("Android could not resolve the installed APK path for build identity");
      const digest = (await shell("sha256sum", apk)).trim().match(/^([a-f0-9]{64})\s+/i)?.[1];
      if (!digest) throw new Error("Android could not verify the installed APK SHA-256 build identity");
      return { package: pkg, apk, sha256: digest.toLowerCase() };
    },
    async start() {
      await guardDeviceAccount();
      // The TV launcher ignores DPAD_DOWN for touch-mode recovery. Bring the guarded app
      // forward first so the same key reaches Compose and restores directional focus.
      await launch("home");
      const isDisplayZeroInTouchMode = (output) => {
        const lines = output.split("\n");
        const marker = lines.findIndex((line) => /TouchModePerDisplay:/.test(line));
        if (marker >= 0) return lines.slice(marker, marker + 5).some((line) => /Display:\s*0\s+TouchMode:\s*1\b/.test(line));
        return /(?:^|\s)TouchMode:\s*1\b/.test(output);
      };
      const touch = await shell("dumpsys", "input");
      // A tap (the USB-debugging prompt watcher taps) puts the device in touch mode, which hides every focus state; a key press leaves it.
      if (isDisplayZeroInTouchMode(touch)) {
        await shell("input", "keyevent", "KEYCODE_DPAD_DOWN");
        if (isDisplayZeroInTouchMode(await shell("dumpsys", "input"))) throw new Error("device stays in touch mode after guarded app launch and DPAD recovery");
      }
    },
    async setTheme(t) {
      await guardDeviceAccount();
      theme = t;
      const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="theme">${t === "light" ? "Light" : "Dark"}</string></map>`;
      await shell("am", "force-stop", pkg);
      await shell(`run-as ${pkg} sh -c 'echo "${xml.replaceAll('"', '\\"')}" > shared_prefs/playarr_display.xml'`);
    },
    async home() { await launch("home"); await settled(); await relink("home", true); },
    async route(r) { const a = appRoute(r); await launch(a); await settled(); await relink(a, true); },
    async key(k, { long } = {}) {
      await guardDeviceAccount();
      await shell("input", "keyevent", ...(long ? ["--longpress"] : []), `KEYCODE_${KEYS[k]}`);
      await sleep(long ? 1500 : k === "select" || k === "back" ? 2500 : 600); // a page change takes a moment to settle focus
    },
    // The app's state in web terms, from the debug log lines (route, calendar view, Filters panel).
    async location() {
      let route = "", section = "", view = "agenda", panel = "";
      for (const l of await parityLines()) {
        const r = /^route=(\S*) section=(\S*)/.exec(l);
        if (r) { if (r[1] !== route) { panel = ""; } route = r[1]; section = r[2]; continue; }
        const c = /^calendar view=(\w+)/.exec(l); if (c) view = c[1];
        const p = /^panel=(\w*)/.exec(l); if (p) panel = p[1];
      }
      if (route === "home") return "/";
      if (route === "calendar") return `/calendar?view=${view}`;
      if (route.startsWith("experience-detail")) return `/${section === "series" ? "series" : "movies"}/x`;
      if (route.startsWith("experience-player")) return "/player/x";
      if (LIBRARIES.has(route)) return `/${route}${panel === "filters" ? "?panel=filters" : ""}`;
      return `/${route}`;
    },
    // { label, position } of the focused node; label: its own description or text, else the visible text inside it (web's textContent; badges are descriptions only).
    async focused() {
      const nodes = (await tree()).match(/<node [^>]*>/g) ?? [];
      const isFocus = (n) => attr(n, "focused") === "true" && bounds(n)[2] - bounds(n)[0] < 1900; // not the window root
      const i = nodes.findIndex((n) => isFocus(n) && attr(n, "focusable") === "true") >= 0 ? nodes.findIndex((n) => isFocus(n) && attr(n, "focusable") === "true") : nodes.findIndex(isFocus);
      if (i < 0) return null;
      const f = nodes[i], [l, t, r, b] = bounds(f);
      // position: nav rail item number from the top, else Home rail (row of cards, top to bottom) and card number in it.
      const focusable = nodes.filter((n) => attr(n, "focusable") === "true" && bounds(n)[2] - bounds(n)[0] < 1900);
      let position;
      if (l < 140) position = { rail: "nav", index: [...new Set(focusable.filter((n) => bounds(n)[0] < 140).map((n) => bounds(n)[1]))].sort((x, y) => x - y).indexOf(t) };
      else {
        const cards = focusable.filter((n) => bounds(n)[0] >= 140 && bounds(n)[3] - bounds(n)[1] > 100);
        const tops = [...new Set(cards.map((n) => bounds(n)[1]))].sort((x, y) => x - y);
        position = { rail: tops.indexOf(t), index: cards.filter((n) => bounds(n)[1] === t && bounds(n)[0] < l).length };
      }
      const label = await (async () => {
        const own = attr(f, "content-desc") || attr(f, "text");
        if (own) return own;
        // Compose can put the description on a sibling node drawn over the same rect.
        const twin = nodes.find((n) => n !== f && attr(n, "content-desc") && attr(n, "bounds") === attr(f, "bounds"));
        if (twin) return attr(twin, "content-desc");
        return nodes.slice(i + 1).filter((n) => { const [a, c, d, e] = bounds(n); return a >= l && c >= t && d <= r && e <= b; })
          .map((n) => attr(n, "text")).filter(Boolean).join("").slice(0, 80) || null;
      })();
      return label == null ? null : { label, position };
    },
    async screenshot(file) {
      await guardDeviceAccount();
      if (parityClock) await this.waitReady({ screen: captureSurface ?? captureScreen, phase: "capture" });
      const xml = await tree();
      if (/Try again|Sign in to Playarr|Scan the QR code/i.test(xml.replace(/<node [^>]*package="(?!io\.playarr)[^>]*>/g, ""))) throw new Error("signed out or error screen");
      // One frame: a screenshot before and after the layout request must be byte-identical, so the layout describes exactly the pixels kept.
      const theme = basename(dirname(file)), screen = basename(file, ".png");
      const layoutFile = join(dirname(dirname(file)), "layout", theme, `${screen}.json`);
      rmSync(layoutFile, { force: true });
      for (let attempt = 0; attempt < 6; attempt++) {
        const before = await grab();
        const json = env.PARITY_LAYOUT !== "0" ? await requestLayout(theme, screen) : "";
        if (json === null) continue;
        const after = await grab();
        if (!before.equals(after)) { await sleep(500); continue; }
        const layout = json ? JSON.parse(json) : null;
        if (layout && !(await resolveCovered(layout, before))) { await sleep(500); continue; }
        writeFileSync(file, before);
        if (layout) {
          mkdirSync(dirname(layoutFile), { recursive: true });
          writeFileSync(layoutFile, JSON.stringify(checkLayout(layout, theme)));
        }
        return;
      }
      throw new Error(`no stable frame with a layout export for ${theme}/${screen}`);
    },
    // Plays media file `c.file` through the player route and watches the position the debug log reports.
    async play(c, expect) {
      await launch(`experience-player/${c.file}`, false);
      const t0 = now(), pos = async () => {
        const ms = (await parityLines()).filter((l) => l.startsWith("player positionMs=")).map((l) => Number(l.slice(18)));
        return ms.length ? ms.at(-1) : null;
      };
      let p0 = null;
      while ((p0 === null || p0 <= 0) && now() - t0 < expect.startWithinSeconds * 1000) { await sleep(1000); p0 = await pos(); }
      if (p0 === null || p0 <= 0) return { state: "error", detail: "no frames in time" };
      const startSeconds = (now() - t0) / 1000;
      // Playing means the position moves by advanceSeconds soon after the first frame (the first seconds can be a seek or a rebuffer).
      let advancedSeconds = 0;
      for (let i = 0; i < expect.advanceSeconds + 15 && advancedSeconds < expect.advanceSeconds; i++) {
        await sleep(1000);
        const p1 = await pos();
        advancedSeconds = p1 === null ? 0 : (p1 - p0) / 1000;
      }
      const state = advancedSeconds >= expect.advanceSeconds ? "playing" : "stalled";
      const r = { state, startSeconds, advancedSeconds };
      if (c.nowPlaying && state === "playing") r.nowPlaying = await nowPlaying();
      return r;
    },
    async stop() {
      if (savedRegion) {
        const region = savedRegion; savedRegion = null;
        try {
          if (region.timeZone) await shell("cmd", "alarm", "set-timezone", region.timeZone);
          await shell("cmd", "locale", "set-app-locales", pkg, "--locales", region.locales);
        } catch (error) { throw new Error(`Android failed to restore time zone and locale: ${String(error?.message ?? error).split("\n")[0]}`); }
      }
      if (savedAnimationScales) {
        const failures = [];
        for (const key of animationScaleKeys) {
          try {
            await shell("settings", "put", "global", key, savedAnimationScales[key]);
            if ((await shell("settings", "get", "global", key)).trim() !== savedAnimationScales[key]) {
              throw new Error("restored value did not match");
            }
          } catch {
            failures.push(key);
          }
        }
        savedAnimationScales = null;
        if (failures.length) throw new Error(`Android failed to restore animation scales: ${failures.join(", ")}`);
      }
    },
  };
}
