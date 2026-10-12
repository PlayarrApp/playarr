// Roku driver for the shared non-player parity suite. ECP keys drive the real device, the native PARITY console
// supplies screen/focus state, and plugin_inspect supplies an authenticated screenshot. Never use this driver
// for playback or Downloads. Run under the shared Roku-input flock and pass explicit --only, --screens and
// --checks allowlists so an accidental suite default cannot enter an unsupported screen.
// Required environment: ROKU_DEV_TARGET and ROKU_DEV_PASSWORD. Passwords stay in memory and are sent to curl
// over stdin configuration, never in argv or logs. Evidence belongs under .data, never in the repository.
import { spawnSync } from "node:child_process";
import net from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_SCREENS = new Set([
  "home", "movies", "series", "music", "search", "settings", "filters", "profiles", "actions",
]);
const SAFE_CHECKS = new Set([
  "home-right", "home-down", "home-down-right", "home-left-nav", "nav-down",
  "movies-grid-right", "movies-grid-down", "movies-grid-left-nav", "series-grid-down", "long-press-actions",
]);
const KEY_NAMES = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Select", back: "Back" };
const SUITE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../suite.json");
const SUITE_SCREENS = JSON.parse(readFileSync(SUITE_FILE, "utf8")).screens;

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? "" : "";
}

export function validateRunArgs(args) {
  const only = option(args, "only").split(",").filter(Boolean);
  if (!only.length || only.some((x) => !["screens", "dpad"].includes(x))) {
    throw new Error("Roku driver requires explicit --only screens,dpad (or --only screens); downloads and performance are unsupported");
  }
  if (only.includes("screens")) {
    const screens = option(args, "screens").split(",").filter(Boolean);
    if (!screens.length) throw new Error("Roku driver requires an explicit non-player --screens allowlist");
    const unsafe = screens.filter((x) => !SAFE_SCREENS.has(x));
    if (unsafe.length) throw new Error(`Roku driver refuses unsupported screen(s): ${unsafe.join(", ")}`);
  }
  if (only.includes("dpad")) {
    const checks = option(args, "checks").split(",").filter(Boolean);
    if (!checks.length) throw new Error("Roku driver requires an explicit non-player --checks allowlist");
    const unsafe = checks.filter((x) => !SAFE_CHECKS.has(x));
    if (unsafe.length) throw new Error(`Roku driver refuses unsupported D-pad check(s): ${unsafe.join(", ")}`);
  }
  return true;
}

export function hasFreshScreenFocus(state, expectedScreen, expectedFocus, afterScreenSeq, afterFocusSeq) {
  return state.screenSeq > afterScreenSeq
    && state.screen === expectedScreen
    && state.focusSeq > afterFocusSeq
    && state.focusScreenSeq === state.screenSeq
    && state.focus === expectedFocus;
}

export function themePixelMatches(pixel, theme) {
  if (!pixel || ![pixel.r, pixel.g, pixel.b].every(Number.isFinite)) return false;
  if (theme === "dark") return pixel.r < 80 && pixel.g < 80 && pixel.b < 80;
  if (theme === "light") return pixel.r > 220 && pixel.g > 220 && pixel.b > 210;
  return false;
}

export function isActivePlayerResponse(xml) {
  const state = /<player\b[^>]*\bstate="([^"]+)"/i.exec(xml)?.[1]?.toLowerCase();
  return state === undefined || !["close", "closed", "stopped", "none", "idle"].includes(state);
}

function parseKeySequence(keys = []) {
  const out = [];
  for (const token of keys) {
    const match = /^(up|down|left|right|select|back)(?::long|\*([1-9][0-9]*))?$/.exec(token);
    if (!match) throw new Error(`unsupported suite key token: ${token}`);
    const [, key, count] = match;
    for (let i = 0; i < (count ? Number(count) : 1); i += 1) out.push({ key, long: token.endsWith(":long") });
  }
  return out;
}

export function routeForState(screen, page, browse, drawerSource) {
  if (screen === "home") return "/";
  if (screen === "profiles") return "/profiles";
  if (screen === "search") return "/search";
  if (screen === "settings") return "/settings";
  if (screen === "playback") return "/player/unsupported";
  if (screen === "detail") return "/movies/unsupported";
  if (screen === "browse") {
    const kind = browse || "";
    if (kind === "movie" || kind === "movies") return "/movies";
    if (kind === "series") return "/series";
    if (kind === "artist" || kind === "music") return "/music";
    return null;
  }
  if (screen === "page") {
    // Roku reports only the Calendar page name, not its persisted month/week/agenda view.
    if (page === "calendar") return null;
    if (["watchlist", "requests", "clients", "household"].includes(page)) return `/${page}`;
    if (page === "settings") return "/settings";
    return null;
  }
  if (screen === "drawer") {
    if (drawerSource === "filters") return "/movies?panel=filters";
    if (browse === "movie" || browse === "movies") return "/movies";
    if (browse === "series") return "/series";
    return null;
  }
  if (screen === "playlists") return "/playlists";
  if (screen === "pairing") return "/login/qr";
  if (screen === "status") return "/status";
  return null;
}

export function createDriver({ out, args = [] } = {}) {
  validateRunArgs(args);
  const env = process.env;
  const target = env.ROKU_DEV_TARGET;
  const password = env.ROKU_DEV_PASSWORD;
  if (!target) throw new Error("ROKU_DEV_TARGET is required");
  if (!password) throw new Error("ROKU_DEV_PASSWORD is required");

  const ecp = `http://${target}:8060`;
  const keyDelay = Math.max(300, Number(env.ROKU_PARITY_KEY_DELAY_MS ?? 850));
  const selectDelay = Math.max(1000, Number(env.ROKU_PARITY_SELECT_DELAY_MS ?? 2600));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let socket;
  let debugBuffer = "";
  let screen = "";
  let screenSeq = 0;
  let page = "";
  let browse = "";
  let focus = null;
  let focusSeq = 0;
  let focusScreenSeq = 0;
  let focusFloorAtScreen = 0;
  let drawerSource = "";
  let lastRoute = null;
  let debugFailure = false;
  let lastScreenshotGeneration = 0;

  const resetObservedState = () => {
    debugBuffer = "";
    screen = "";
    page = "";
    browse = "";
    focus = null;
    drawerSource = "";
    lastRoute = null;
  };

  const assertDebug = () => {
    if (!socket || socket.destroyed || debugFailure) throw new Error("Roku debug console is unavailable; refusing to infer route or focus state");
  };

  const sendEcp = async (path, method = "POST") => {
    const response = await fetch(`${ecp}/${path}`, { method, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Roku ECP request failed (${response.status})`);
    return response;
  };

  const ingest = (line) => {
    const match = /PARITY\|([A-Za-z0-9_-]+)\|(.*)$/.exec(line);
    if (!match) return;
    const [, kind, value] = match;
    if (kind === "screen") {
      screen = value.trim();
      screenSeq += 1;
      focusFloorAtScreen = focusSeq;
      focus = null;
      if (screen === "home" || screen === "profiles") drawerSource = "";
      if (screen === "drawer" && !drawerSource) drawerSource = "actions";
    } else if (kind === "page") {
      page = value.trim();
    } else if (kind === "browse") {
      browse = value.trim();
    } else if (kind === "focus") {
      const positioned = /^(.*)\|@([0-9]+):([0-9]+)$/.exec(value.trim());
      focus = positioned
        ? { label: positioned[1], position: { rail: Number(positioned[2]), index: Number(positioned[3]) } }
        : value.trim();
      focusSeq += 1;
      focusScreenSeq = screenSeq;
    }
  };

  const press = async (key, { long = false } = {}) => {
    const ecpName = KEY_NAMES[key];
    if (!ecpName) throw new Error(`Roku key is unsupported: ${key}`);
    if (long) {
      await sendEcp(`keydown/${ecpName}`);
      await sleep(1100);
      await sendEcp(`keyup/${ecpName}`);
    } else {
      await sendEcp(`keypress/${ecpName}`);
    }
    await sleep(key === "select" || key === "back" ? selectDelay : keyDelay);
    if (long && key === "select") drawerSource = "actions";
    const actual = routeForState(screen, page, browse, drawerSource);
    if (actual) lastRoute = actual;
    if (screen === "playback") throw new Error("Roku parity driver stopped before capturing a player screen");
  };

  const waitFor = async (predicate, label, timeoutMs = 45000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertDebug();
      if (predicate()) return;
      await sleep(250);
    }
    throw new Error(`Roku did not reach ${label}`);
  };

  const launchProfiles = async () => {
    await sendEcp("keypress/Home").catch(() => {});
    // Match the established device cold-start: Roku needs time to background the channel
    // before `launch/dev` reliably emits a new screen event on the debug console.
    await sleep(4000);
    const beforeScreenSeq = screenSeq;
    const beforeFocusSeq = focusSeq;
    resetObservedState();
    await sendEcp("launch/dev");
    try {
      await waitFor(() => screenSeq > beforeScreenSeq && (screen === "profiles" || screen === "pairing" || screen === "status"), "fresh profile picker event", 40000);
    } catch {
      throw new Error(`Roku did not reach a fresh profile picker event after cold launch (screen=${screen || "none"}, newScreenEvents=${screenSeq - beforeScreenSeq}, debugConnected=${!!socket && !socket.destroyed && !debugFailure})`);
    }
    if (screen !== "profiles") throw new Error(`Roku is on ${screen}; expected signed-in Profiles`);
    await sleep(3000);
    // Resume can retain focus on a bottom-row action. This deterministic path restores the first profile.
    for (const key of ["down", "down", "left", "up"]) {
      await sendEcp(`keypress/${KEY_NAMES[key]}`);
      await sleep(650);
    }
    await waitFor(() => focusSeq > beforeFocusSeq && focusSeq > focusFloorAtScreen && focusScreenSeq === screenSeq, "fresh profile focus", 5000);
    if (!hasFreshScreenFocus({ screen, screenSeq, focus, focusSeq, focusScreenSeq }, "profiles", "Device Test", beforeScreenSeq, beforeFocusSeq)) {
      throw new Error("Roku did not report fresh Device Test profile focus; refusing to select another profile");
    }
  };

  const toHome = async () => {
    await launchProfiles();
    await sendEcp("keypress/Select");
    await waitFor(() => screen === "home", "signed-in Home");
    lastRoute = "/";
    await sleep(1500);
  };

  const setThemeFromProfiles = async (theme) => {
    await launchProfiles();
    await sendEcp("keypress/Up");
    await sleep(keyDelay);
    await sendEcp("keypress/Select");
    await sleep(700);
    const index = theme === "light" ? 1 : 2;
    // Dialog buttons are a vertical list. Drive to the last button and back to the first
    // so the target index is independent of any retained button focus from a prior dialog.
    for (let i = 0; i < 6; i += 1) {
      await sendEcp("keypress/Down");
      await sleep(250);
    }
    for (let i = 0; i < 6; i += 1) {
      await sendEcp("keypress/Up");
      await sleep(250);
    }
    for (let i = 0; i < index; i += 1) {
      await sendEcp("keypress/Down");
      await sleep(500);
    }
    await sendEcp("keypress/Select");
    await sleep(1500);
    if (screen !== "profiles") throw new Error("Theme picker left the profile screen unexpectedly");
    const { jpeg } = captureFrame();
    const pixel = sampleBackgroundPixel(jpeg);
    if (!themePixelMatches(pixel, theme)) {
      throw new Error(`Roku did not apply requested ${theme} theme (background pixel ${pixel.r},${pixel.g},${pixel.b})`);
    }
  };

  const curlConfig = (url, form = "") => {
    const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, "")}"`;
    return [
      `url = ${quote(url)}`,
      `user = ${quote(`rokudev:${password}`)}`,
      "digest",
      "fail",
      "silent",
      "show-error",
      "max-time = 30",
      ...(form ? [`form = ${quote(form)}`] : []),
      "",
    ].join("\n");
  };

  const curl = (config) => {
    const result = spawnSync("curl", ["--config", "-"], {
      input: config,
      encoding: "buffer",
      timeout: 35000,
      maxBuffer: 64 << 20,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0) throw new Error("Roku screenshot request failed");
    return result.stdout;
  };

  const pngFromJpeg = (jpeg) => {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], {
      input: jpeg,
      encoding: "buffer",
      timeout: 20000,
      maxBuffer: 64 << 20,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0 || !result.stdout?.length) throw new Error("Roku screenshot conversion failed");
    return result.stdout;
  };

  const sampleBackgroundPixel = (jpeg) => {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", "crop=1:1:10:500", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], {
      input: jpeg,
      encoding: "buffer",
      timeout: 12000,
      maxBuffer: 4096,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0 || result.stdout?.length !== 3) throw new Error("Roku theme verification could not sample the background pixel");
    return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
  };

  const captureFrame = () => {
    const html = curl(curlConfig(`http://${target}/plugin_inspect`, "mysubmit=Screenshot")).toString("utf8");
    const match = /pkgs\/dev\.[a-z]+\?time=(\d+)/.exec(html);
    if (!match) throw new Error("Roku dev installer did not return a screenshot path");
    const generation = Number(match[1]);
    if (!Number.isSafeInteger(generation) || generation <= lastScreenshotGeneration) {
      throw new Error("Roku screenshot generation is stale or did not advance");
    }
    const jpeg = curl(curlConfig(`http://${target}/${match[0]}`));
    if (jpeg.length < 10000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Roku screenshot was not a valid JPEG frame");
    lastScreenshotGeneration = generation;
    return { jpeg, generation };
  };

  const exactSuiteScreen = (path) => {
    return SUITE_SCREENS.find((item) => item.route === path || item.match === path);
  };

  const safeRoute = async (path) => {
    if (path === "/player" || path.startsWith("/player/")) throw new Error("Roku parity driver refuses player routes");
    if (/^\/(movies|series)\/[^/?]+/.test(path)) throw new Error("Roku cannot deep-link safely to a non-player work detail; use a separately reviewed UI route");
    const entry = exactSuiteScreen(path);
    if (!entry || !SAFE_SCREENS.has(entry.id) || entry.open) throw new Error(`Roku suite route is unsupported: ${path}`);
    await toHome();
    if (entry.id === "filters") drawerSource = "filters";
    else if (entry.id === "actions") drawerSource = "actions";
    for (const item of parseKeySequence(entry.keys)) await press(item.key, { long: item.long });
    const actual = routeForState(screen, page, browse, drawerSource);
    if (actual !== (entry.match ?? entry.route)) throw new Error(`Roku route ended on ${actual}; expected ${entry.match ?? entry.route}`);
    lastRoute = actual;
  };

  return {
    supports: { downloads: false, notifications: false, nowPlaying: false, "grouped-downloads": false },
    async start() {
      resetObservedState();
      socket = net.createConnection({ host: target, port: 8085 });
      socket.setEncoding("utf8");
      socket.setTimeout(60000);
      socket.on("data", (chunk) => {
        debugBuffer += chunk;
        const lines = debugBuffer.split("\n");
        debugBuffer = lines.pop() ?? "";
        for (const line of lines) ingest(line);
      });
      socket.on("error", () => { debugFailure = true; });
      socket.on("timeout", () => socket?.destroy(new Error("Roku debug console timed out")));
      await new Promise((resolveConnect, reject) => {
        socket.once("connect", resolveConnect);
        socket.once("error", reject);
      });
      if (screen === "playback") throw new Error("Roku is already on a player screen; refusing this non-player run");
      const media = await sendEcp("query/media-player", "GET");
      const playerXml = await media.text();
      if (isActivePlayerResponse(playerXml)) throw new Error("Roku media player is active; refusing to interrupt it");
    },
    async stop() {
      if (socket && !socket.destroyed) socket.destroy();
    },
    async setTheme(theme) {
      if (!["dark", "light"].includes(theme)) throw new Error(`Roku parity theme unsupported: ${theme}`);
      await setThemeFromProfiles(theme);
    },
    async home() { await toHome(); },
    async key(name, { long = false } = {}) { await press(name, { long }); },
    async route(path) { await safeRoute(path); },
    async location() {
      assertDebug();
      if (screen === "playback") return "/player/unsupported";
      const current = routeForState(screen, page, browse, drawerSource);
      if (current) lastRoute = current;
      return lastRoute;
    },
    async focused() { assertDebug(); return focus; },
    async screenshot(file) {
      assertDebug();
      if (!out) throw new Error("suite runner output path is required");
      if (!screen || ["pairing", "status"].includes(screen)) throw new Error(`Roku screenshot refused on ${screen || "unknown"} screen`);
      if (screen === "playback") throw new Error("Roku parity driver refuses player screenshots");
      const { jpeg, generation } = captureFrame();
      mkdirSync(dirname(resolve(file)), { recursive: true });
      const png = pngFromJpeg(jpeg);
      if (png.length < 24 || png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080) {
        throw new Error("Roku screenshot was not a 1920x1080 frame");
      }
      writeFileSync(file, png);
      writeFileSync(`${file}.capture.json`, JSON.stringify({
        captured_at: new Date().toISOString(),
        screenshot_generation: generation,
        screen_seq: screenSeq,
        focus_seq: focusSeq,
        screen,
        page,
        browse,
        route: routeForState(screen, page, browse, drawerSource),
        focus,
      }, null, 2));
    },
    async download() { throw new Error("Roku parity driver does not support Downloads"); },
    async cleanupDownloads() {},
    async playerReady() { throw new Error("Roku parity driver refuses player checks"); },
    async play() { throw new Error("Roku parity driver refuses playback and performance checks"); },
  };
}
