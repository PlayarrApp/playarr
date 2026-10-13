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
import { artReadiness, createArtReadinessState, intersectingSlots, parseArtEvent, reduceArtEvent, resetArtReadinessState } from "../roku/art-readiness.mjs";

const SAFE_SCREENS = new Set([
  "home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda",
  "search", "settings", "filters", "profiles", "actions",
]);
const SAFE_CHECKS = new Set([
  "home-right", "home-down", "home-down-right", "home-left-nav", "nav-down",
  "movies-grid-right", "movies-grid-down", "movies-grid-left-nav", "series-grid-down", "long-press-actions",
]);
const KEY_NAMES = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Select", back: "Back" };
const SUITE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../suite.json");
const SUITE_SCREENS = JSON.parse(readFileSync(SUITE_FILE, "utf8")).screens;
const MAX_DEBUG_FRAME_BYTES = 16 * 1024;

export function spawnSyncBinary(command, args, options = {}) {
  return spawnSync(command, args, { ...options, encoding: null });
}

export function sampleBackgroundPixel(jpeg) {
  const result = spawnSyncBinary("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-threads", "2", "-filter_threads", "2",
    "-i", "pipe:0", "-vf", "format=rgb24,crop=1:1:10:500", "-frames:v", "1",
    "-threads", "2", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ], {
    input: jpeg,
    timeout: 12000,
    maxBuffer: 4096,
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || result.stdout?.length !== 3) throw new Error("Roku theme verification could not sample the background pixel");
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

export function splitDebugFrames(buffer, chunk) {
  const frames = (buffer + chunk).split("\n");
  const remainder = frames.pop() ?? "";
  if (Buffer.byteLength(remainder, "utf8") > MAX_DEBUG_FRAME_BYTES ||
      frames.some((frame) => Buffer.byteLength(frame, "utf8") > MAX_DEBUG_FRAME_BYTES)) {
    return { frames: [], remainder: "", overflow: true };
  }
  return { frames, remainder, overflow: false };
}

export function parseParityLine(line) {
  const match = /PARITY\|([A-Za-z0-9_-]+)\|(.*)$/.exec(line.replace(/\r$/, ""));
  if (!match) return null;
  return { kind: match[1], value: match[2] };
}

export function createParityState() {
  return {
    screen: "", screenSeq: 0, page: "", browse: "", focus: null,
    focusSeq: 0, focusScreenSeq: 0, focusFloorAtScreen: 0, drawerSource: "",
    calendarView: "", calendarViewSeq: 0, calendarViewScreenSeq: 0,
    eventSeq: 0, artMarkers: { home: 0, movies: 0 }, artState: createArtReadinessState(),
  };
}

export function applyParityLine(state, line) {
  const parsed = parseParityLine(line);
  if (!parsed) return false;
  const { kind, value } = parsed;
  state.eventSeq += 1;
  if (kind === "screen") {
    state.screen = value.trim();
    state.screenSeq += 1;
    state.focusFloorAtScreen = state.focusSeq;
    state.focus = null;
    if (state.screen === "home" || state.screen === "profiles") state.drawerSource = "";
    if (state.screen === "drawer" && !state.drawerSource) state.drawerSource = "actions";
    if (state.screen === "home") state.artMarkers.home = state.eventSeq;
  } else if (kind === "page") {
    state.page = value.trim();
    if (state.page !== "calendar") state.calendarView = "";
  } else if (kind === "calendarView") {
    const view = value.trim();
    if (!["month", "week", "agenda"].includes(view)) return false;
    state.calendarView = view;
    state.calendarViewSeq += 1;
    state.calendarViewScreenSeq = state.screenSeq;
  } else if (kind === "browse") {
    state.browse = value.trim();
    if (state.browse === "movie" || state.browse === "movies") state.artMarkers.movies = state.eventSeq;
  } else if (kind === "art") {
    const event = parseArtEvent(value, state.eventSeq);
    if (!event || event.type !== "slot" || intersectingSlots([event]).length > 0) reduceArtEvent(state.artState, event);
  } else if (kind === "focus") {
    const positioned = /^(.*)\|@([0-9]+):([0-9]+)$/.exec(value.trim());
    state.focus = positioned
      ? { label: positioned[1], position: { rail: Number(positioned[2]), index: Number(positioned[3]) } }
      : value.trim();
    state.focusSeq += 1;
    state.focusScreenSeq = state.screenSeq;
  }
  return true;
}

export async function requestEcp(url, method = "POST", fetcher = fetch) {
  try {
    return await fetcher(url, {
      method,
      headers: { connection: "close" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("Roku ECP transport failed; no automatic retry was attempted and the device outcome may be unknown");
  }
}

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

export function hasFreshProfilesScreen(state, afterScreenSeq) {
  return state.screenSeq > afterScreenSeq && state.screen === "profiles";
}

export function hasFreshHomeContentFocus(state, afterScreenSeq, afterFocusSeq) {
  const position = state.focus?.position;
  return state.screen === "home"
    && state.screenSeq > afterScreenSeq
    && state.focusSeq > afterFocusSeq
    && state.focusScreenSeq === state.screenSeq
    && Number.isInteger(position?.rail) && position.rail >= 0
    && Number.isInteger(position?.index) && position.index >= 0;
}

export function hasFreshBrowseFocus(state, expectedBrowse, afterScreenSeq, afterFocusSeq) {
  const browseMatches = state.browse === expectedBrowse
    || (expectedBrowse === "movie" && state.browse === "movies")
    || (expectedBrowse === "movies" && state.browse === "movie");
  return state.screen === "browse"
    && state.screenSeq > afterScreenSeq
    && browseMatches
    && state.focus !== null
    && state.focusSeq > afterFocusSeq
    && state.focusScreenSeq === state.screenSeq;
}

export function hasFreshCalendarView(state, expectedView, afterViewSeq) {
  return state.screen === "page"
    && state.page === "calendar"
    && state.calendarView === expectedView
    && state.calendarViewSeq > afterViewSeq
    && state.calendarViewScreenSeq === state.screenSeq;
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

export function isLaunchErrorBody(body) {
  return /<\s*(?:error|failure)\b/i.test(body)
    || /^\s*(?:error|failed|failure|unable|cannot|can't|not found)\b/i.test(body)
    || /["'](?:error|failure)["']\s*:/i.test(body);
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

export function routeForState(screen, page, browse, drawerSource, calendarView = "") {
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
    if (page === "calendar") {
      if (calendarView === "agenda") return "/calendar";
      if (calendarView === "month" || calendarView === "week") return `/calendar?view=${calendarView}`;
      return null;
    }
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
  const artEnabled = env.ROKU_ART_READINESS === "1";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const parityState = createParityState();
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
    Object.assign(parityState, { screen: "", page: "", browse: "", focus: null, drawerSource: "", calendarView: "" });
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

  const closeDebug = async () => {
    const previous = socket;
    socket = null;
    if (!previous || previous.closed) return;
    await new Promise((resolveClose) => {
      previous.once("close", resolveClose);
      if (!previous.destroyed) previous.destroy();
    });
  };

  const connectDebug = async () => {
    await closeDebug();
    debugBuffer = "";
    debugFailure = false;
    const connection = net.createConnection({ host: target, port: 8085 });
    socket = connection;
    connection.setEncoding("utf8");
    connection.setTimeout(60000);
    connection.on("data", (chunk) => {
      if (socket !== connection) return;
      const split = splitDebugFrames(debugBuffer, chunk);
      if (split.overflow) {
        debugBuffer = "";
        debugFailure = true;
        connection.destroy();
        return;
      }
      debugBuffer = split.remainder;
      for (const line of split.frames) ingest(line);
    });
    connection.on("error", () => { if (socket === connection) debugFailure = true; });
    connection.on("timeout", () => {
      if (socket === connection) debugFailure = true;
      connection.destroy(new Error("Roku debug console timed out"));
    });
    await new Promise((resolveConnect, rejectConnect) => {
      connection.once("connect", resolveConnect);
      connection.once("error", rejectConnect);
    });
  };

  const sendEcp = async (path, method = "POST") => {
    const response = await requestEcp(`${ecp}/${path}`, method);
    if (!response.ok) throw new Error(`Roku ECP request failed (${response.status})`);
    if (path.split("?")[0] === "launch/dev") {
      let body;
      try {
        body = await response.text();
      } catch {
        throw new Error("Roku ECP launch response could not be read; device outcome may be unknown");
      }
      if (isLaunchErrorBody(body)) throw new Error("Roku ECP launch/dev returned an error response body");
    }
    return response;
  };

  const ingest = (line) => {
    if (!applyParityLine(parityState, line)) return;
    screen = parityState.screen;
    screenSeq = parityState.screenSeq;
    page = parityState.page;
    browse = parityState.browse;
    focus = parityState.focus;
    focusSeq = parityState.focusSeq;
    focusScreenSeq = parityState.focusScreenSeq;
    focusFloorAtScreen = parityState.focusFloorAtScreen;
    drawerSource = parityState.drawerSource;
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
    if (long && key === "select") {
      drawerSource = "actions";
      parityState.drawerSource = drawerSource;
    }
    const actual = routeForState(screen, page, browse, drawerSource, parityState.calendarView);
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

  const waitForArt = async (scope) => {
    const afterSeq = parityState.artMarkers[scope];
    const deadline = Date.now() + 90000;
    let lastReason = "no-fresh-generation";
    while (Date.now() < deadline) {
      assertDebug();
      const candidates = [...parityState.artState.generations.values()]
        .filter((generation) => generation.scope === scope && generation.began && generation.beginSeq > afterSeq)
        .sort((a, b) => b.generation - a.generation);
      if (candidates.length) {
        const result = artReadiness(candidates[0], { scope, afterSeq });
        if (result.ready) return;
        lastReason = result.reason;
        if (result.reason === "art-failed" || result.reason === "no-required-art-slots") break;
      }
      await sleep(250);
    }
    throw new Error(`Roku art readiness rejected ${scope} capture: ${lastReason}`);
  };

  const launchProfiles = async () => {
    await closeDebug();
    resetObservedState();
    await sendEcp("keypress/Home").catch(() => {});
    // Match the established device cold-start: Roku needs time to background the channel
    // before `launch/dev` reliably emits a new screen event on the debug console.
    await sleep(4000);
    if (artEnabled) {
      resetArtReadinessState(parityState.artState);
      parityState.artMarkers = { home: 0, movies: 0 };
    }
    const beforeScreenSeq = screenSeq;
    const beforeFocusSeq = focusSeq;
    resetObservedState();
    await sendEcp(`launch/dev${artEnabled ? "?parityArtReady=1" : ""}`);
    await connectDebug();
    try {
      await waitFor(() => hasFreshProfilesScreen({ screen, screenSeq }, beforeScreenSeq), "fresh signed-in Profiles screen", 40000);
    } catch {
      if (screen === "pairing") throw new Error("Roku remained on the pairing screen; no fresh signed-in Profiles screen arrived");
      if (screen === "status") throw new Error("Roku remained on the status screen; no fresh signed-in Profiles screen arrived");
      throw new Error(`Roku did not reach a fresh profile picker event after cold launch (screen=${screen || "none"}, newScreenEvents=${screenSeq - beforeScreenSeq}, debugConnected=${!!socket && !socket.destroyed && !debugFailure})`);
    }
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
    const beforeHomeScreenSeq = screenSeq;
    const beforeHomeFocusSeq = focusSeq;
    await sendEcp("keypress/Select");
    try {
      await waitFor(() => hasFreshHomeContentFocus({ screen, screenSeq, focus, focusSeq, focusScreenSeq }, beforeHomeScreenSeq, beforeHomeFocusSeq), "fresh positioned Home content focus", 20000);
    } catch {
      if (screen === "pairing") throw new Error("Roku returned to pairing while opening Home");
      if (screen === "home") throw new Error("Roku Home did not report fresh positioned content focus");
      throw new Error(`Roku did not reach fresh Home content focus (screen=${screen || "none"}, newScreenEvents=${screenSeq - beforeHomeScreenSeq})`);
    }
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
    const result = spawnSyncBinary("curl", ["--config", "-"], {
      input: config,
      timeout: 35000,
      maxBuffer: 64 << 20,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0) throw new Error("Roku screenshot request failed");
    return result.stdout;
  };

  const pngFromJpeg = (jpeg) => {
    const result = spawnSyncBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-threads", "2", "-filter_threads", "2", "-i", "pipe:0", "-threads", "2", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], {
      input: jpeg,
      timeout: 20000,
      maxBuffer: 64 << 20,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0 || !result.stdout?.length) throw new Error("Roku screenshot conversion failed");
    return result.stdout;
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
    if (entry.id === "filters") {
      const beforeBrowseScreenSeq = screenSeq;
      const beforeBrowseFocusSeq = focusSeq;
      await press("left");
      for (let i = 0; i < 12; i += 1) await press("down");
      for (let i = 0; i < 6; i += 1) await press("up");
      await press("select");
      await waitFor(
        () => hasFreshBrowseFocus(parityState, "movie", beforeBrowseScreenSeq, beforeBrowseFocusSeq),
        "fresh Movies grid focus before opening Filters",
        30000,
      );
      drawerSource = "filters";
      parityState.drawerSource = "filters";
      await sendEcp("keypress/Info");
      await sleep(keyDelay);
      await press("up");
      const beforeDrawerScreenSeq = screenSeq;
      await press("select");
      await waitFor(
        () => screen === "drawer" && screenSeq > beforeDrawerScreenSeq,
        "fresh Filters drawer screen",
        15000,
      );
    } else if (["calendar-month", "calendar-week", "calendar-agenda"].includes(entry.id)) {
      const targetView = entry.id.slice("calendar-".length);
      const beforeCalendarViewSeq = parityState.calendarViewSeq;
      await press("left");
      for (let i = 0; i < 12; i += 1) await press("down");
      await press("up");
      const beforeCalendarScreenSeq = screenSeq;
      await press("select");
      await waitFor(
        () => screenSeq > beforeCalendarScreenSeq && hasFreshCalendarView(parityState, "month", beforeCalendarViewSeq),
        "fresh Calendar month view",
        30000,
      );
      if (targetView !== "month") {
        const beforeTargetViewSeq = parityState.calendarViewSeq;
        // Calendar starts with its first registered page control focused:
        // Next, Today, Previous, then the range/view button. Move left across
        // those fixed header controls to open the view chooser.
        for (let i = 0; i < 3; i += 1) await press("left");
        await press("select");
        const targetIndex = ["month", "week", "agenda"].indexOf(targetView);
        for (let i = 0; i < targetIndex; i += 1) await press("down");
        await press("select");
        await waitFor(
          () => hasFreshCalendarView(parityState, targetView, beforeTargetViewSeq),
          `fresh Calendar ${targetView} view`,
          15000,
        );
      }
    } else {
      if (entry.id === "actions") drawerSource = "actions";
      parityState.drawerSource = drawerSource;
      for (const item of parseKeySequence(entry.keys)) await press(item.key, { long: item.long });
    }
    const actual = routeForState(screen, page, browse, drawerSource, parityState.calendarView);
    const expectedRoute = entry.id === "calendar-agenda" ? "/calendar" : (entry.match ?? entry.route);
    if (actual !== expectedRoute) throw new Error(`Roku route ended on ${actual}; expected ${expectedRoute}`);
    lastRoute = actual;
  };

  return {
    supports: { downloads: false, notifications: false, nowPlaying: false, "grouped-downloads": false },
    async start() {
      resetObservedState();
      const media = await sendEcp("query/media-player", "GET");
      const playerXml = await media.text();
      if (isActivePlayerResponse(playerXml)) throw new Error("Roku media player is active; refusing to interrupt it");
      try {
        await connectDebug();
        await sleep(700);
        if (screen === "playback") throw new Error("Roku is already on a player screen; refusing this non-player run");
      } finally {
        await closeDebug();
      }
    },
    async stop() { await closeDebug(); },
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
      const current = routeForState(screen, page, browse, drawerSource, parityState.calendarView);
      if (current) lastRoute = current;
      return lastRoute;
    },
    async focused() { assertDebug(); return focus; },
    async screenshot(file) {
      assertDebug();
      if (!out) throw new Error("suite runner output path is required");
      if (!screen || ["pairing", "status"].includes(screen)) throw new Error(`Roku screenshot refused on ${screen || "unknown"} screen`);
      if (screen === "playback") throw new Error("Roku parity driver refuses player screenshots");
      if (artEnabled && screen === "home") { await waitForArt("home"); await sleep(1000); }
      if (artEnabled && screen === "browse" && ["movie", "movies"].includes(browse)) await waitForArt("movies");
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
        route: routeForState(screen, page, browse, drawerSource, parityState.calendarView),
        focus,
      }, null, 2));
    },
    async download() { throw new Error("Roku parity driver does not support Downloads"); },
    async cleanupDownloads() {},
    async playerReady() { throw new Error("Roku parity driver refuses player checks"); },
    async play() { throw new Error("Roku parity driver refuses playback and performance checks"); },
  };
}
