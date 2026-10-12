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

export function createDriver() {
  const env = process.env, pkg = env.PARITY_PACKAGE ?? "io.playarr.mobile";
  const adbBin = env.ANDROID_HOME ? `${env.ANDROID_HOME}/platform-tools/adb` : "adb";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const adbOnce = async (...a) => (await run(adbBin, a, { maxBuffer: 64 << 20, encoding: "utf8" })).stdout;
  // An emulator that restarts mid-run (a crash): wait for it to boot again, then retry the command once.
  const adb = async (...a) => {
    try { return await adbOnce(...a); } catch (e) {
      if (!/offline|closed|not found|no devices|cannot connect/i.test(String(e.stderr ?? e.message))) throw e;
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 5000)); try { if ((await adbOnce("shell", "getprop", "sys.boot_completed")).trim() === "1") break; } catch { /* still booting */ } }
      await new Promise((r) => setTimeout(r, 30000));
      return adbOnce(...a);
    }
  };
  const shell = (...a) => adb("shell", ...a);
  let theme = "dark";

  const parityLines = async () => (await adb("logcat", "-d", "-s", "PlayarrParity:I")).split("\n").map((l) => l.replace(/^.*PlayarrParity: /, "")).filter(Boolean);
  // pause: the debug build pauses the player at its first frame (a still frame for the player-controls screen); off for playback cases.
  const launch = async (route, pause = true) => {
    await shell("am", "force-stop", pkg);
    await adb("logcat", "-c");
    await shell("am", "start", "-n", `${pkg}/.MainActivity`, "--es", "parity_route", route, ...(pause ? ["--el", "parity_pause_at_ms", "500"] : []));
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
  const tree = async () => {
    await shell("uiautomator", "dump", "/sdcard/parity-ui.xml");
    return adb("exec-out", "cat", "/sdcard/parity-ui.xml");
  };
  const attr = (node, name) => (node.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const bounds = (n) => (attr(n, "bounds").match(/\d+/g) ?? []).map(Number);

  // Wait until the app has put focus on something (a loaded page): keys sent before that are lost.
  const settled = async (maxSeconds = 60) => {
    for (let i = 0; i < maxSeconds / 3; i++) {
      await sleep(3000);
      const xml = await tree();
      // Loaded: focus sits on content (past the 140 px rail), or the sign-in screen is up.
      const onContent = (xml.match(/<node [^>]*>/g) ?? []).some((n) => attr(n, "focused") === "true" && attr(n, "focusable") === "true" && (bounds(n)[0] ?? 0) >= 140);
      if (/Sign in to Playarr/.test(xml) || onContent) { await sleep(1500); return; }
    }
  };
  // The sign-in screen shows a link code; approve it (PARITY_LINK_CMD) and relaunch. Returns true when it had to sign in.
  const relink = async (route, pause) => {
    for (let tries = 0; tries < 3; tries++) {
      const xml = await tree();
      if (!/Sign in to Playarr/.test(xml)) return tries > 0;
      const code = /text="([A-Z0-9]{4}-[A-Z0-9]{4})"/.exec(xml)?.[1];
      if (!code || !env.PARITY_LINK_CMD) throw new Error("signed out and no link code or PARITY_LINK_CMD to approve it");
      const [cmd, ...rest] = env.PARITY_LINK_CMD.split(" ");
      await run(cmd, [...rest, code]);
      await sleep(25000);
      await launch(route, pause);
      await settled();
    }
    throw new Error("still signed out after linking");
  };
  return {
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
      const xml = await tree();
      if (/Try again|Sign in to Playarr|Scan the QR code/i.test(xml.replace(/<node [^>]*package="(?!io\.playarr)[^>]*>/g, ""))) throw new Error("signed out or error screen");
      const png = env.PARITY_XDISPLAY
        ? (await run("import", ["-window", "root", "png:-"], { encoding: "buffer", maxBuffer: 64 << 20, env: { ...env, DISPLAY: env.PARITY_XDISPLAY } })).stdout
        : (await run(adbBin, ["exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 << 20 })).stdout;
      writeFileSync(file, png);
    },
    // Plays media file `c.file` through the player route and watches the position the debug log reports.
    async play(c, expect) {
      await launch(`experience-player/${c.file}`, false);
      const t0 = Date.now(), pos = async () => {
        const ms = (await parityLines()).filter((l) => l.startsWith("player positionMs=")).map((l) => Number(l.slice(18)));
        return ms.length ? ms.at(-1) : null;
      };
      let p0 = null;
      while ((p0 === null || p0 <= 0) && Date.now() - t0 < expect.startWithinSeconds * 1000) { await sleep(1000); p0 = await pos(); }
      if (p0 === null || p0 <= 0) return { state: "error", detail: "no frames in time" };
      const startSeconds = (Date.now() - t0) / 1000;
      // Playing means the position moves by advanceSeconds soon after the first frame (the first seconds can be a seek or a rebuffer).
      let advancedSeconds = 0;
      for (let i = 0; i < expect.advanceSeconds + 15 && advancedSeconds < expect.advanceSeconds; i++) {
        await sleep(1000);
        const p1 = await pos();
        advancedSeconds = p1 === null ? 0 : (p1 - p0) / 1000;
      }
      return { state: advancedSeconds >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds };
    },
  };
}
