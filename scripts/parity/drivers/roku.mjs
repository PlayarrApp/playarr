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
  "home", "movies", "series", "music", "calendar-month", "search", "settings", "filters", "profiles", "actions",
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
    if (screens.includes("calendar-month") && option(args, "via") !== "route") {
      throw new Error("Roku calendar-month must use --via route so the default Month state is verified without selecting media");
    }
  }
  if (only.includes("dpad")) {
    const checks = option(args, "checks").split(",").filter(Boolean);
    if (!checks.length) throw new Error("Roku driver requires an explicit non-player --checks allowlist");
    const unsafe = checks.filter((x) => !SAFE_CHECKS.has(x));
    if (unsafe.length) throw new Error(`Roku driver refuses unsupported D-pad check(s): ${unsafe.join(", ")}`);
  }
  return true;
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

function routeForState(screen, page, browse, drawerSource) {
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
    if (page === "calendar") return "/calendar?view=month";
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
  let page = "";
  let browse = "";
  let focus = null;
  let drawerSource = "";
  let lastRoute = null;

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
      if (predicate()) return;
      await sleep(250);
    }
    throw new Error(`Roku did not reach ${label}`);
  };

  const launchProfiles = async () => {
    await sendEcp("keypress/Home").catch(() => {});
    await sleep(900);
    await sendEcp("launch/dev");
    await waitFor(() => screen === "profiles" || screen === "pairing" || screen === "status", "profile picker", 30000);
    if (screen !== "profiles") throw new Error(`Roku is on ${screen}; expected signed-in Profiles`);
    // Resume can retain focus on a bottom-row action. This deterministic path restores the first profile.
    for (const key of ["down", "down", "left", "up"]) {
      await sendEcp(`keypress/${KEY_NAMES[key]}`);
      await sleep(650);
    }
    await waitFor(() => typeof focus === "string" && focus.length > 0, "profile focus", 5000);
    if (focus !== "Device Test") throw new Error("Roku focus is not the Device Test profile; refusing to select another profile");
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
    for (let i = 0; i < index; i += 1) {
      await sendEcp("keypress/Down");
      await sleep(500);
    }
    await sendEcp("keypress/Select");
    await sleep(1500);
    if (screen !== "profiles") throw new Error("Theme picker left the profile screen unexpectedly");
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
    if (entry.id === "calendar-month") {
      // The Roku calendar's default is Month. The shared web path reaches a view dialog via a different focus model,
      // so open the native Calendar page directly through its normal D-pad path and verify the default route.
      for (const item of parseKeySequence(["left", "down*12", "up", "select"])) await press(item.key, { long: item.long });
    } else {
      for (const item of parseKeySequence(entry.keys)) await press(item.key, { long: item.long });
    }
    const actual = routeForState(screen, page, browse, drawerSource);
    if (actual !== (entry.match ?? entry.route)) throw new Error(`Roku route ended on ${actual}; expected ${entry.match ?? entry.route}`);
    lastRoute = actual;
  };

  return {
    supports: { downloads: false, notifications: false, nowPlaying: false, "grouped-downloads": false },
    async start() {
      socket = net.createConnection({ host: target, port: 8085 });
      socket.setEncoding("utf8");
      socket.setTimeout(60000);
      socket.on("data", (chunk) => {
        debugBuffer += chunk;
        const lines = debugBuffer.split("\n");
        debugBuffer = lines.pop() ?? "";
        for (const line of lines) ingest(line);
      });
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
      if (screen === "playback") return "/player/unsupported";
      const current = routeForState(screen, page, browse, drawerSource);
      if (current) lastRoute = current;
      return lastRoute;
    },
    async focused() { return focus; },
    async screenshot(file) {
      if (!out) throw new Error("suite runner output path is required");
      if (!screen || ["pairing", "status"].includes(screen)) throw new Error(`Roku screenshot refused on ${screen || "unknown"} screen`);
      if (screen === "playback") throw new Error("Roku parity driver refuses player screenshots");
      const html = curl(curlConfig(`http://${target}/plugin_inspect`, "mysubmit=Screenshot")).toString("utf8");
      const path = /pkgs\/dev\.[a-z]+\?time=\d+/.exec(html)?.[0];
      if (!path) throw new Error("Roku dev installer did not return a screenshot path");
      const jpg = curl(curlConfig(`http://${target}/${path}`));
      if (jpg.length < 10000 || jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error("Roku screenshot was not a valid JPEG frame");
      mkdirSync(dirname(resolve(file)), { recursive: true });
      const png = pngFromJpeg(jpg);
      if (png.length < 24 || png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080) {
        throw new Error("Roku screenshot was not a 1920x1080 frame");
      }
      writeFileSync(file, png);
    },
    async download() { throw new Error("Roku parity driver does not support Downloads"); },
    async cleanupDownloads() {},
    async playerReady() { throw new Error("Roku parity driver refuses player checks"); },
    async play() { throw new Error("Roku parity driver refuses playback and performance checks"); },
  };
}
