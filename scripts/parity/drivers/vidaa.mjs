// Driver for the shared non-player parity suite on a real Hisense VIDAA TV (docs/parity/SUITE.md). VIDAA runs the web client, so the TV
// loads the debug-mirror build (`pnpm run build:debug-mirror` in clients/tv-web/web) from a local receiver; the receiver stores each frame
// the page posts (PNG, route, focus, identity). Keys go out through the MQTT remote CLI, which refuses to act unless the foreground is Playarr.
//   PLAYARR_VIDAA_CLI      path of the remote wrapper (`vidaa key|open-debug|state ...`; test tooling kept outside the repository)
//   PLAYARR_VIDAA_MIRROR   receiver base URL as this host reaches it (default http://127.0.0.1:18742)
//   PLAYARR_VIDAA_MIRROR_TOKEN in ~/.secrets (or the environment): frame endpoints need it; it is never printed or logged.
// Layout export: the driver queues a job at the receiver (the shared layout exporter, scripts/parity/layout-dump.mjs, as text). The debug page runs it on its
// own DOM right before and after it renders a frame and posts the result under the job's request id in that same frame. The screenshot and the layout of a
// screen both come from the frame carrying the id; a frame that is not stable across its render, or whose id or state does not match, is refused.
// Long press: the remote service's KEY_OK_LONG_PRESS reaches the page as a burst of repeat Enter keydowns plus a keyup, which the app turns into a hold (vidaaLongPress.ts).
// Back: the remote service swallows KEY_BACK, KEY_RETURN and KEY_EXIT (never a key or history event in the page; KEY_EXIT leaves the app), so the debug page is asked for
// the key the app documents as VIDAA's Back button (Backspace, keyCode 8, isVidaaBackKey) through the receiver's one-shot command channel. The owner's physical Back press (30 Oct) arrived as exactly this key, so the injected key is equivalent.
// Not supported: player checks, downloads, build identity (strict readiness stays off).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { layoutExpressionScaled } from "../layout-dump.mjs";
import { assertDeviceTestIdentity, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl } from "../device-test-guard.mjs";

export const KEY_CODES = { up: "KEY_UP", down: "KEY_DOWN", left: "KEY_LEFT", right: "KEY_RIGHT", select: "KEY_OK", back: "KEY_BACK" };
export const LONG_KEY_CODES = { select: "KEY_OK_LONG_PRESS" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Route the suite compares: the hash route when the app is hash-routed, else the path; mirror launch flags and the cache-buster are dropped. */
export function suiteRoute(frameRoute) {
  const raw = String(frameRoute ?? "");
  const hash = raw.indexOf("#/");
  const route = hash >= 0 ? raw.slice(hash + 1) : raw.replace(/#.*$/, "");
  const [path, query = ""] = route.split("?");
  const kept = query.split("&").filter((p) => p && !/^(mirror[A-Za-z]*|platform|r)=/.test(p));
  return kept.length ? `${path}?${kept.join("&")}` : path;
}

/** Launch path for open-debug: the route plus the mirror flags (lossless frames, no focus ring from pointer clicks, theme, frozen clock). */
export function launchPath(route, { theme, fixedNow }) {
  if (!/^\/[A-Za-z0-9_./?=&%-]*$/.test(route) || route.startsWith("//")) throw new Error(`VIDAA route is not a plain app route: ${route.slice(0, 40)}`);
  const flags = ["mirrorPng=1", "mirrorPointer=1", "mirrorWidth=1920", `mirrorTheme=${theme}`]; // 1920: the suite scores against 1920x1080 references
  // mirrorUtc: the page reads local time as UTC (the web references' time zone), so the instant keeps its Z.
  if (fixedNow) flags.push(`mirrorNow=${encodeURIComponent(fixedNow.replace(/\.\d+Z$/, "Z"))}`, "mirrorUtc=1");
  return `${route}${route.includes("?") ? "&" : "?"}${flags.join("&")}`;
}

/** A frame is usable when it is newer than `since` (epoch seconds), has an image and no capture error. */
export function usableFrame(frame, since) {
  return !!frame && frame.hasImage === true && !frame.captureError && Number(frame.receivedAt) > since;
}

/** Two frames show a settled page when route, focus and visible text agree. */
export function sameState(a, b) {
  return !!a && !!b && suiteRoute(a.route) === suiteRoute(b.route) && JSON.stringify(a.focus ?? null) === JSON.stringify(b.focus ?? null) && a.text === b.text;
}

/** Page expression that holds the player on its 2.000 s frame (docs/parity: seek while paused, never play-then-pause, controls visible, focus dropped) and reports what the page shows. */
export const PIN_PLAYER_EXPRESSION = `(async function () {
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var v = document.querySelector("video");
  if (!v) return { held: false, why: "no video" };
  for (var i = 0; i < 80 && v.readyState < 2; i++) await wait(500);
  var held = 0, state = null;
  for (var round = 0; round < 12 && held < 2; round++) {
    v.pause();
    if (Math.abs(v.currentTime - 2) > 0.0005) await new Promise(function (res) { v.addEventListener("seeked", res, { once: true }); v.currentTime = 2; setTimeout(res, 8000); });
    v.pause();
    if (v.requestVideoFrameCallback) await new Promise(function (res) { v.requestVideoFrameCallback(function () { res(); }); setTimeout(res, 3000); });
    var fill = document.querySelector(".player-seek-progress");
    var synced = function () { return !!fill && Math.abs(parseFloat(fill.style.width) - 100 * v.currentTime / v.duration) < 0.15; };
    for (var k = 0; k < 10 && !synced(); k++) { v.dispatchEvent(new Event("timeupdate")); await wait(400); }
    state = { paused: v.paused, t: Math.round(v.currentTime * 1000) / 1000, synced: synced(), controls: !!document.querySelector(".player-controls") && !document.querySelector(".player-controls").classList.contains("is-hidden") };
    held = state.paused && Math.abs(v.currentTime - 2) < 0.001 && state.synced && state.controls ? held + 1 : 0;
    await wait(700);
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  return { held: held >= 2, state: state };
})()`;

/** Detail refs are taken at page top (the web driver and the webOS driver do the same): the focus-scroll to the first episode card must not show in the capture. */
export const DETAIL_TOP_EXPRESSION = `(function () { var n = 0; [document.scrollingElement].concat([].slice.call(document.querySelectorAll("*"))).forEach(function (e) { if (e && e.scrollTop > 0) { e.scrollTop = 0; n++; } }); return { reset: n }; })()`;
export const isDetailRoute = (route) => /^\/(movies|series)\/[^/]+\/?$/.test(String(route).split("?")[0]);

/** The frame a layout job produced is usable when it carries the job's id, rendered an image, saw the page hold still while it rendered and exported elements. */
export function jobFrameProblem(frame, id) {
  if (!frame || frame.requestId !== id) return "frame does not carry the request id";
  if (frame.captureError) return `capture error: ${String(frame.captureError).slice(0, 80)}`;
  if (frame.hasImage !== true) return "frame has no image";
  if (frame.layoutStable !== true) return "page changed while the frame rendered";
  if (!frame.layout || frame.layout.error || !Array.isArray(frame.layout.elements)) return `layout export failed: ${String(frame.layout?.error ?? "no elements").slice(0, 80)}`;
  return null;
}

function readSecret(name, env, file = join(homedir(), ".secrets")) {
  if (env[name]) return env[name];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} is missing`);
}

/** One-line failure text for a vidaa CLI call: its command word and its own stderr (or exit status), never the full command line. */
export function cliFailure(args, error) {
  const said = String(error?.stderr ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  return `vidaa ${args[0] ?? ""} failed${said ? `: ${said}` : ` (${error?.signal ?? `exit ${error?.status ?? "?"}`})`}`;
}

export async function createDriver({
  env = process.env,
  cli = env.PLAYARR_VIDAA_CLI,
  base = env.PLAYARR_VIDAA_MIRROR ?? "http://127.0.0.1:18742",
  runCli = (args) => {
    try { return execFileSync(cli, args, { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { throw new Error(cliFailure(args, error)); } // the suite logs only the first line of an error: keep the CLI's own message there
  },
  getJson, getBuffer, postJson, delay = sleep, now = () => Date.now() / 1000, secrets,
  keyMs = Number(env.PLAYARR_VIDAA_KEY_MS ?? 1500), settleTimeoutMs = 45000,
} = {}) {
  if (!cli && !secrets) throw new Error("PLAYARR_VIDAA_CLI must point at the VIDAA remote wrapper");
  const token = secrets?.token ?? readSecret("PLAYARR_VIDAA_MIRROR_TOKEN", env);
  const allowedUsernames = loadAllowedDeviceTestUsernames({ env, ...(secrets ? { secrets: secrets.device } : {}) });
  const trustedServerUrl = loadTrustedDeviceTestServerUrl({ env, ...(secrets ? { secrets: secrets.device } : {}) });
  const url = (name) => `${base}/__mirror/${name}?t=${encodeURIComponent(token)}`;
  const json = getJson ?? (async (u) => (await fetch(u, { signal: AbortSignal.timeout(8000) })).json());
  const buffer = getBuffer ?? (async (u) => Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(15000) })).arrayBuffer()));
  let theme = "dark";
  let fixedNow = env.PLAYARR_VIDAA_FIXED_NOW ?? null; // set when the suite runs unpinned (PARITY_STABLE=0) so calendar screens still use the reference clock
  let route = "/";
  let captureTarget = null;
  let paired = null; // { screen, id, layout }: the layout that belongs to the last screenshot
  const jobTag = `${Date.now().toString(36)}`;
  let jobSeq = 0;
  const post = postJson ?? (async (u, body) => { const res = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); if (!res.ok) throw new Error(`receiver refused the job (${res.status})`); });

  const guardFrame = (frame) => assertDeviceTestIdentity({ identity: frame.identity, allowedUsernames, expectedServerUrl: trustedServerUrl });
  const latest = async () => json(url("latest.json"));

  // Waits for a frame produced after `since` whose state is unchanged across two distinct frames, so a key's effect has landed. A frame's
// image is rendered at the start of its (seconds-long) capture while route, focus and text are read at the end, so one frame can pair a
// stale image with new metadata; polling that same frame twice must not count as settled. The next frame renders after the key.
  async function settled(since) {
    const end = now() + settleTimeoutMs / 1000;
    let previous = null;
    let pinned = false;
    while (now() < end) {
      const frame = await latest();
      if (usableFrame(frame, since)) {
        guardFrame(frame);
        // A playing clip changes the page every frame (the time label), so the page would never settle: hold it on its 2.000 s frame, paused, once per wait.
        if (!pinned && /^\/player\//.test(suiteRoute(frame.route))) {
          pinned = true;
          await pinPlayer();
          previous = null;
          since = now() - 1;
          continue;
        }
        if (previous && frame.receivedAt !== previous.receivedAt) {
          if (sameState(previous, frame)) return frame;
          previous = frame;
        } else if (!previous) previous = frame;
      }
      await delay(1200);
    }
    throw new Error("VIDAA mirror produced no settled frame in time (is the TV on and the debug page open?)");
  }
  // Runs page code through the job channel and returns what it produced (the page posts the result with the frame that carries the job id).
  async function pageEval(expr) {
    const id = `${jobTag}-${++jobSeq}`;
    await post(url("job"), { id, expr });
    const end = now() + settleTimeoutMs / 1000 + 60;
    while (now() < end) {
      const candidate = await json(`${url("frame.json")}&id=${id}`);
      if (candidate?.requestId === id) { guardFrame(candidate); return candidate.layout; }
      await delay(1200);
    }
    throw new Error("VIDAA page did not answer the page job in time");
  }
  async function pinPlayer() {
    const result = await pageEval(PIN_PLAYER_EXPRESSION);
    if (result?.held !== true) throw new Error(`VIDAA player did not hold paused on its 2.000 s frame: ${JSON.stringify(result).slice(0, 160)}`);
  }
  async function open(path) {
    const since = now();
    runCli(["open-debug", "--path", launchPath(path, { theme, fixedNow }), "--wait", "8"]);
    route = path;
    // A reload resets the page: wait for frames from the new load and for the app to draw something.
    const frame = await settled(since);
    if (!frame.text) throw new Error("VIDAA page loaded but shows no text; refusing to capture an empty screen");
    return frame;
  }

  return {
    supports: {},
    async setDeterministicCapture({ fixedNow: instant } = {}) {
      if (!instant || !Number.isFinite(Date.parse(instant))) throw new Error("VIDAA deterministic capture requires a valid fixedNow instant");
      fixedNow = instant; // the debug build freezes the clock and, with mirrorUtc, reads local time as UTC; locale is the TV page's own
    },
    async start({ theme: first } = {}) {
      if (first) theme = first;
      runCli(["state"]); // fails when the TV or the remote service is unreachable
    },
    async stop() {},
    async setTheme(t) {
      if (t !== "dark" && t !== "light") throw new Error(`unknown theme ${t}`);
      theme = t;
      await open(route);
    },
    async home() { await open("/"); },
    async route(r) { await open(r); },
    async setCaptureTarget(id) { captureTarget = id; paired = null; },
    async key(k, { long } = {}) {
      const code = long ? LONG_KEY_CODES[k] : KEY_CODES[k];
      if (!code || (k === "back" && long)) throw new Error(`VIDAA driver cannot send ${long ? "a long " : ""}${k}`);
      const since = now();
      if (k === "back") { await post(url("cmd"), { id: `${jobTag}-b${++jobSeq}`, key: "back" }); }
      else runCli(["key", code, "--delay", "0.3"]);
      await delay(keyMs);
      await settled(since);
    },
    async location() { return suiteRoute((await settled(now() - 30)).route); },
    async focused() {
      const f = (await settled(now() - 30)).focus;
      if (!f) return null;
      return { label: (f.label || f.text || f.selector || "").slice(0, 80), position: f.position ?? null };
    },
    // The picture and the layout of one frame: queue the exporter as a job, wait for the frame carrying its id, and refuse anything that does not match
    // the settled page state (route, focus and text) the screen was reached in.
    async screenshot(file) {
      const screen = captureTarget;
      if (!screen) throw new Error("VIDAA screenshot needs a capture target (setCaptureTarget)");
      let state = await settled(now() - 30);
      if (isDetailRoute(suiteRoute(state.route))) { await pageEval(DETAIL_TOP_EXPRESSION); state = await settled(now() - 30); }
      let problem = "no attempt";
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const id = `${jobTag}-${++jobSeq}`;
        await post(url("job"), { id, expr: layoutExpressionScaled(screen) });
        const end = now() + settleTimeoutMs / 1000 + 30;
        let frame = null;
        while (now() < end) {
          const candidate = await json(`${url("frame.json")}&id=${id}`);
          if (candidate?.requestId === id) { frame = candidate; break; }
          await delay(1200);
        }
        if (!frame) { problem = "no frame carried the request id in time"; continue; }
        guardFrame(frame);
        problem = jobFrameProblem(frame, id) ?? (sameState(state, frame) ? null : "route, focus or text differ from the settled page");
        if (problem) continue;
        const image = await buffer(`${url("frame.png")}&id=${id}`);
        if (image.length < 8 || image.readUInt32BE(0) !== 0x89504e47) throw new Error("VIDAA frame image is not a PNG");
        if (image.readUInt32BE(16) !== 1920 || image.readUInt32BE(20) !== 1080) throw new Error(`VIDAA frame is ${image.readUInt32BE(16)}x${image.readUInt32BE(20)}, expected 1920x1080`);
        writeFileSync(file, image);
        paired = { screen, id, layout: frame.layout };
        return;
      }
      throw new Error(`VIDAA frame refused after 4 attempts: ${problem}`);
    },
    // The layout schema document (docs/parity/LAYOUT.md) of the frame the last screenshot saved: never of another frame.
    async layoutDump({ screen, theme: t }) {
      if (!paired || paired.screen !== screen) throw new Error(`VIDAA layout for ${screen} has no screenshot frame to pair with`);
      const { layout } = paired;
      return { screen, theme: t, viewport: layout.viewport, clockPinned: !!fixedNow, elements: layout.elements, occluded: layout.occluded };
    },
  };
}
