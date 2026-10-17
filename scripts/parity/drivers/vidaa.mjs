// Driver for the shared non-player parity suite on a real Hisense VIDAA TV (docs/parity/SUITE.md). VIDAA runs the web client, so the TV
// loads the debug-mirror build (`pnpm run build:debug-mirror` in clients/tv-web/web) from a local receiver; the receiver stores each frame
// the page posts (PNG, route, focus, identity). Keys go out through the MQTT remote CLI, which refuses to act unless the foreground is Playarr.
//   PLAYARR_VIDAA_CLI      path of the remote wrapper (`vidaa key|open-debug|state ...`; test tooling kept outside the repository)
//   PLAYARR_VIDAA_MIRROR   receiver base URL as this host reaches it (default http://127.0.0.1:18742)
//   PLAYARR_VIDAA_MIRROR_TOKEN in ~/.secrets (or the environment): frame endpoints need it; it is never printed or logged.
// Not supported: long presses (the MQTT remote cannot hold a key), player checks, downloads, build identity (strict readiness stays off).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertDeviceTestIdentity, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl } from "../device-test-guard.mjs";

export const KEY_CODES = { up: "KEY_UP", down: "KEY_DOWN", left: "KEY_LEFT", right: "KEY_RIGHT", select: "KEY_OK", back: "KEY_BACK" };
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
  const flags = ["mirrorPng=1", "mirrorPointer=1", `mirrorTheme=${theme}`];
  if (fixedNow) flags.push(`mirrorNow=${encodeURIComponent(fixedNow.replace(/Z$/, "").replace(/\.\d+$/, ""))}`);
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

function readSecret(name, env, file = join(homedir(), ".secrets")) {
  if (env[name]) return env[name];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} is missing`);
}

export async function createDriver({
  env = process.env,
  cli = env.PLAYARR_VIDAA_CLI,
  base = env.PLAYARR_VIDAA_MIRROR ?? "http://127.0.0.1:18742",
  runCli = (args) => execFileSync(cli, args, { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] }),
  getJson, getBuffer, delay = sleep, now = () => Date.now() / 1000, secrets,
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
  let fixedNow = null;
  let route = "/";

  const guardFrame = (frame) => assertDeviceTestIdentity({ identity: frame.identity, allowedUsernames, expectedServerUrl: trustedServerUrl });
  const latest = async () => json(url("latest.json"));

  // Waits for a frame produced after `since` whose state is unchanged across two polls, so a key's effect has landed.
  async function settled(since) {
    const end = now() + settleTimeoutMs / 1000;
    let previous = null;
    while (now() < end) {
      const frame = await latest();
      if (usableFrame(frame, since)) {
        guardFrame(frame);
        if (sameState(previous, frame)) return frame;
        previous = frame;
      }
      await delay(1200);
    }
    throw new Error("VIDAA mirror produced no settled frame in time (is the TV on and the debug page open?)");
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
      fixedNow = instant; // the clock is frozen by the debug build; zone and locale are the TV page's own
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
    async key(k) {
      const code = KEY_CODES[k];
      if (!code) throw new Error(`VIDAA driver cannot send ${k}`);
      const since = now();
      runCli(["key", code, "--delay", "0.3"]);
      await delay(keyMs);
      await settled(since);
    },
    async location() { return suiteRoute((await settled(now() - 30)).route); },
    async focused() {
      const f = (await settled(now() - 30)).focus;
      if (!f) return null;
      return { label: (f.label || f.text || f.selector || "").slice(0, 80), position: f.position ?? null };
    },
    async screenshot(file) {
      const first = await settled(now() - 30);
      const image = await buffer(url("latest.jpg"));
      const second = await latest();
      guardFrame(second);
      if (!sameState(first, second)) throw new Error("VIDAA page changed while its frame was fetched");
      if (!image.length) throw new Error("VIDAA frame image is empty");
      writeFileSync(file, image);
    },
  };
}
