// Android TV driver for the shared parity suite (docs/parity/SUITE.md): a debug build of clients/android on an emulator or
// device over adb, D-pad keys only. Needs the debug `parity_route` launch extra and the `PlayarrParity` log lines (debug builds).
//   ANDROID_SERIAL (adb target), ANDROID_HOME or adb on PATH, PARITY_PACKAGE (default io.playarr.mobile),
//   PARITY_LINK_CMD (command that approves a TV link code for the Device Test account; the code is appended: the account's
//   sessions are evicted by other runs, so a signed-out app links again, then carries on),
//   PARITY_XDISPLAY (e.g. :98: read screenshots from the emulator's X window; the guest screencap can crash some emulators).
// The device must already be signed in as the Device Test profile and out of touch mode (a fresh emulator boot is).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

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

export function createDriver({ adbBin: adbOverride, commandTimeoutMs = 20_000, readinessTimeoutMs = 60_000, readinessPollMs = 3_000, clock = {}, env: envOverride = process.env } = {}) {
  const env = envOverride, pkg = env.PARITY_PACKAGE ?? "io.playarr.mobile";
  const adbBin = adbOverride ?? (env.ANDROID_HOME ? `${env.ANDROID_HOME}/platform-tools/adb` : "adb");
  // Injectable clock (tests): the readiness loop's deadline arithmetic then never depends on how long a real process took.
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const execBounded = async (command, args, { timeoutMs = commandTimeoutMs, label = "external command", ...options } = {}) => {
    try {
      return await run(command, args, { env, ...options, timeout: timeoutMs, killSignal: "SIGTERM" });
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
  let theme = "dark";
  let parityClock = null;
  let savedAnimationScales = null;
  const animationScaleKeys = ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"];

  const parityLines = async () => (await adb("logcat", "-d", "-s", "PlayarrParity:I")).split("\n").map((l) => l.replace(/^.*PlayarrParity: /, "")).filter(Boolean);
  // pause: the debug build pauses the player at its first frame (a still frame for the player-controls screen); off for playback cases.
  const launch = async (route, pause = true) => {
    await shell("am", "force-stop", pkg);
    await adb("logcat", "-c");
    await shell("am", "start", "-n", `${pkg}/.MainActivity`, "--es", "parity_route", route,
      ...(parityClock ? ["--es", "parity_clock", parityClock] : []),
      ...(pause ? ["--el", "parity_pause_at_ms", "500"] : []));
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
  const tree = async () => {
    await adbWithTimeout(commandTimeoutMs, "shell", "uiautomator", "dump", "/sdcard/parity-ui.xml");
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
    async setDeterministicCapture({ fixedNow, disableAnimations } = {}) {
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
      for (const key of animationScaleKeys) {
        await shell("settings", "put", "global", key, "0");
        if ((await shell("settings", "get", "global", key)).trim() !== "0") throw new Error(`Android could not disable system animation scale ${key}`);
      }
    },
    async waitReady({ screen, phase = "capture" } = {}) {
      if (!["route", "focus", "capture"].includes(phase)) throw new Error(`unsupported Android readiness phase: ${phase}`);
      if (phase === "capture") throw new Error("Android stable capture readiness unsupported: image-idle signals cannot prove route data is loaded, so artwork may still change");
      const deadline = now() + readinessTimeoutMs;
      let previous = "", stable = 0;
      while (now() < deadline) {
        const lines = await parityLines();
        const xml = await tree();
        if (/Try again|Sign in to Playarr|Scan the QR code/i.test(xml)) throw new Error(`Android ${phase} readiness reached a sign-in or error screen`);
        const lastRoute = lines.findLast((line) => line.startsWith("route=")) ?? "";
        const routeValue = /^route=(\S+)/.exec(lastRoute)?.[1] ?? "";
        const expectedRoute = ({
          home: "home", movies: "movies", series: "series", music: "music", search: "search", settings: "settings",
          profiles: "profiles", filters: "movies", actions: "movies", "calendar-month": "calendar", "calendar-week": "calendar",
          "calendar-agenda": "calendar", "film-detail": "experience-detail", "series-detail": "experience-detail",
          "player-controls": "experience-player",
        })[screen];
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
      throw new Error(`Android ${phase} readiness timed out without stable focused content`);
    },
    async captureBuildIdentity() {
      const apk = (await shell("pm", "path", pkg)).trim().match(/^package:(.+)$/m)?.[1];
      if (!apk) throw new Error("Android could not resolve the installed APK path for build identity");
      const digest = (await shell("sha256sum", apk)).trim().match(/^([a-f0-9]{64})\s+/i)?.[1];
      if (!digest) throw new Error("Android could not verify the installed APK SHA-256 build identity");
      return { package: pkg, apk, sha256: digest.toLowerCase() };
    },
    async start() {
      const touch = await shell("dumpsys", "input");
      // A tap (the USB-debugging prompt watcher taps) puts the device in touch mode, which hides every focus state; a key press leaves it.
      if (/TouchMode: 1/.test(touch)) {
        await shell("input", "keyevent", "KEYCODE_DPAD_DOWN");
        if (/TouchMode: 1/.test(await shell("dumpsys", "input"))) throw new Error("device stays in touch mode: restart the emulator");
      }
    },
    async setTheme(t) {
      theme = t;
      const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="theme">${t === "light" ? "Light" : "Dark"}</string></map>`;
      await shell("am", "force-stop", pkg);
      await shell(`run-as ${pkg} sh -c 'echo "${xml.replaceAll('"', '\\"')}" > shared_prefs/playarr_display.xml'`);
    },
    async home() { await launch("home"); await settled(); await relink("home", true); },
    async route(r) { const a = appRoute(r); await launch(a); await settled(); await relink(a, true); },
    async key(k, { long } = {}) {
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
      if (parityClock) await this.waitReady({ phase: "capture" });
      const xml = await tree();
      if (/Try again|Sign in to Playarr|Scan the QR code/i.test(xml.replace(/<node [^>]*package="(?!io\.playarr)[^>]*>/g, ""))) throw new Error("signed out or error screen");
      const png = env.PARITY_XDISPLAY
        ? (await execBounded("import", ["-window", "root", "png:-"], { encoding: "buffer", maxBuffer: 64 << 20, env: { ...env, DISPLAY: env.PARITY_XDISPLAY }, label: "screen capture import" })).stdout
        : (await execBounded(adbBin, ["exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 << 20, label: "adb exec-out screencap" })).stdout;
      writeFileSync(file, png);
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
