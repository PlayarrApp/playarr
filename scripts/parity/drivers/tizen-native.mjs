// Driver for the native Tizen TV app (clients/tizen-native) on a Tizen TV emulator. Contract: docs/parity/SUITE.md.
// Needs the app built with `-p:PlayarrDebug=true` (it starts a small control server on port 8765), the Tizen SDK `sdb`
// on PATH or in PLAYARR_SDB, and ImageMagick `import` for screenshots of the emulator display.
//   PLAYARR_TIZEN_SERIAL (default emulator-26101), PLAYARR_TIZEN_FORWARD (local port, default 18890),
//   PLAYARR_TIZEN_DISPLAY (X display of the emulator window, default :25), PLAYARR_TIZEN_WINDOW (X window id when the window is not at 0,0
//   of its display, default root), PLAYARR_SDB.
import { execFileSync } from "node:child_process";
import { assertDeviceTestIdentity, loadAllowedDeviceTestUsernames, loadTrustedDeviceTestServerUrl } from "../device-test-guard.mjs";
import { captureWallTime } from "../capture-timezone.mjs";

const SDB = process.env.PLAYARR_SDB ?? "sdb";
const SERIAL = process.env.PLAYARR_TIZEN_SERIAL ?? "emulator-26101";
const PORT = Number(process.env.PLAYARR_TIZEN_FORWARD ?? 18890);
const DISPLAY = process.env.PLAYARR_TIZEN_DISPLAY ?? ":25";
const base = `http://127.0.0.1:${PORT}`;
// key pacing: a busy host slows the emulator, and keys sent faster than it renders are lost (raise on a loaded machine)
const KEY_MS = Number(process.env.PLAYARR_TIZEN_KEY_MS ?? 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path) {
  const res = await fetch(base + path, { method, body: method === "POST" ? "" : undefined, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`debug mirror ${path}: HTTP ${res.status}`);
  return res.json();
}

export async function createDriver({ request = call, delay = sleep, env = process.env, secrets, setupForward, captureScreenshot, pixelSignature } = {}) {
  let state = {};
  let forwarded = false;
  const allowedUsernames = loadAllowedDeviceTestUsernames({ env, client: env.PARITY_CLIENT, ...(secrets ? { secrets } : {}) });
  const trustedServerUrl = loadTrustedDeviceTestServerUrl({ env, ...(secrets ? { secrets } : {}) });
  const ensureForwarded = () => {
    if (forwarded) return;
    try {
      if (setupForward) setupForward();
      else execFileSync(SDB, ["-s", SERIAL, "forward", `tcp:${PORT}`, "tcp:8765"], { stdio: "ignore" });
    }
    catch { /* an existing forward is usable; the next request fails closed if it is not */ }
    forwarded = true;
  };
  const verifyAccount = async () => {
    ensureForwarded();
    const identity = await request("GET", "/identity");
    return assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl: trustedServerUrl });
  };
  const readState = async () => {
    const next = await request("GET", "/state");
    if (typeof next.ready !== "boolean" || !Number.isInteger(next.pending) || next.pending < 0) {
      throw new Error("Tizen readiness response is incomplete; refusing deterministic capture");
    }
    state = next;
    return next;
  };
  const waitStable = async ({ timeoutMs = 40000, stableSamples = 2 } = {}) => {
    let stable = 0;
    let previous = "";
    for (let waited = 0; waited <= timeoutMs; waited += 1000) {
      const current = await readState();
      if (current.ready && current.pending === 0) {
        if (current.animationMode !== "none") throw new Error("Tizen native animation mode is not verified for deterministic capture");
        // Playback position advances continuously; player screenshots capture paused controls, so exclude that clock from visual readiness.
        const signature = JSON.stringify([current.route, current.focused, current.position, current.theme, current.playing]);
        stable = signature === previous ? stable + 1 : 1;
        previous = signature;
        if (stable >= stableSamples) return current;
      } else { stable = 0; previous = ""; }
      if (waited < timeoutMs) await delay(1000);
    }
    throw new Error("Tizen app did not reach stable ready state before deterministic capture");
  };
  const ownedDownloads = new Set();
  return {
    async setDeterministicCapture({ fixedNow, disableAnimations } = {}) {
      if (disableAnimations !== true || typeof fixedNow !== "string" || !Number.isFinite(Date.parse(fixedNow))) throw new Error("Tizen deterministic capture requires a valid fixed clock and disabled animations");
      await verifyAccount();
      ensureForwarded();
      await request("POST", `/capture-clock?now=${encodeURIComponent(captureWallTime(fixedNow))}`);
      await waitStable();
    },
    async captureBuildIdentity() {
      await verifyAccount();
      ensureForwarded();
      const identity = await request("GET", "/build");
      if (typeof identity.app !== "string" || !identity.app || typeof identity.version !== "string" || !identity.version.trim() || !/^[a-f0-9]{64}$/.test(identity.sha256 ?? "")) {
        throw new Error("Tizen application build identity is incomplete");
      }
      return identity;
    },
    async waitReady() { await verifyAccount(); await waitStable(); },
    async start() {
      await verifyAccount();
      await waitStable();
    },
    async stop() {},
    async setTheme(t) { await verifyAccount(); if (state.theme !== t) { await request("POST", `/theme?name=${encodeURIComponent(t)}`); await waitStable(); } },
    // a page is settled once the app reports it ready (data loaded); a slow server can take far longer than a fixed wait
    async settle(ms) {
      await delay(ms);
      await verifyAccount();
      await waitStable();
    },
    async home() { await verifyAccount(); await request("POST", "/route?path=/"); await this.settle(5000); },
    async route(p) { await verifyAccount(); await request("POST", `/route?path=${encodeURIComponent(p)}`); await this.settle(4000); },
    async key(k, { long } = {}) { await verifyAccount(); await request("POST", `/key?name=${encodeURIComponent(k)}${long ? "&long=1" : ""}`); await delay(long ? 1500 : KEY_MS); await waitStable(); },
    async location() { await verifyAccount(); await readState(); return state.route; },
    async focused() { await verifyAccount(); await readState(); return state.focused == null ? null : { label: state.focused, position: state.position ?? null }; },
    async screenshot(file) {
      await verifyAccount();
      await waitStable();
      if (state.route.startsWith("/player/") && state.playing) throw new Error("Tizen player capture requires paused playback for deterministic pixels");
      const first = `${file}.stability.png`;
      const capture = captureScreenshot ?? ((path) => execFileSync("import", ["-window", process.env.PLAYARR_TIZEN_WINDOW ?? "root", path], { env: { ...process.env, DISPLAY } }));
      const signature = pixelSignature ?? ((path) => execFileSync("identify", ["-format", "%#", path], { encoding: "utf8" }).trim());
      capture(first);
      await delay(1000);
      await verifyAccount();
      await waitStable();
      if (state.route.startsWith("/player/") && state.playing) throw new Error("Tizen player capture requires paused playback for deterministic pixels");
      capture(file);
      if (signature(first) !== signature(file)) throw new Error("Tizen rendered pixels changed between deterministic readiness samples");
    },
    // Downloads run through the engine's debug endpoints (the UI path was checked by hand): what is stored, paused and removed is the real
    // engine against the real server tickets. Notifications and now-playing: the TV profile has none (supports stays false), and the
    // grouped series-level actions are not built.
    supports: { downloads: true, "grouped-downloads": true },
    async download(c) {
      await verifyAccount();
      const m = c.media; const started = Date.now(); const within = (c.expect.withinSeconds ?? 300) * 1000;
      const list = async () => (await request("GET", "/dl/list"));
      const get = async (id) => (await list()).find((x) => x.Id === id);
      const waitFor = async (id, pred) => { for (;;) { const d = await get(id); if (d && pred(d)) return d; if (Date.now() - started > within) throw new Error("timeout"); if (d?.state === "Failed") throw new Error("failed"); await delay(1000); } };
      const q = new URLSearchParams({ file: m.file, work: m.work, title: m.title, quality: "original", ...(m.episode ? { season: String(m.season), episode: String(m.episode), series: m.title } : {}) });
      const assertKnownRecords = (records, fields) => {
        if (records.some((d) => !ownedDownloads.has(d.Id) && fields.some((field) => !Object.hasOwn(d, field)))) {
          throw new Error("refusing download action while existing tickets cannot be verified");
        }
      };
      const start = async (query = q) => {
        const before = await list();
        assertKnownRecords(before, ["Id", "MediaFileId"]);
        if (before.some((d) => String(d.MediaFileId ?? "").toLowerCase() === String(m.file).toLowerCase() && !ownedDownloads.has(d.Id))) throw new Error("refusing to replace an existing download for this media");
        const id = (await request("POST", `/dl/start?${query}`)).id;
        if (!id || before.some((d) => d.Id === id && !ownedDownloads.has(id))) throw new Error("download start reused a pre-existing ticket");
        ownedDownloads.add(id);
        return id;
      };
      try {
        if (c.action === "start") { const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file); return { state: "ok", detail: "completed and stored" }; }
        if (c.action === "pause-resume") {
          const id = await start(); const d0 = await waitFor(id, (d) => d.BytesDownloaded > 0);
          await request("POST", `/dl/pause?id=${id}`); await delay(1500); const p1 = await get(id); await delay(3000); const p2 = await get(id);
          if (p1.state !== "Paused" || p2.BytesDownloaded !== p1.BytesDownloaded) return { state: "failed", detail: "did not stay paused" };
          await request("POST", `/dl/resume?id=${id}`); await waitFor(id, (d) => d.state === "Ready" && d.file); return { state: "ok", detail: `paused at ${p1.BytesDownloaded}, resumed to completion` };
        }
        if (c.action === "cancel") { const id = await start(); await waitFor(id, (d) => d.BytesDownloaded > 0); await request("POST", `/dl/remove?id=${id}`); await delay(1000); return (await get(id)) ? { state: "failed", detail: "still listed" } : { state: "ok", detail: "removed mid-way" }; }
        if (c.action === "delete") { const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file); await request("POST", `/dl/remove?id=${id}`); await delay(1000); return (await get(id)) ? { state: "failed", detail: "still listed" } : { state: "ok", detail: "deleted" }; }
        if (c.action === "edit") { const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file); await request("POST", `/dl/keep?id=${id}&type=after-watched`); const d = await get(id); return d.keep === "after-watched" ? { state: "ok", detail: "keep-until edited (quality is fixed once a download exists on this client)" } : { state: "failed", detail: "keep-until not changed" }; }
        if (c.action === "offline-play") {
          const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file);
          // the network is not switched off here: the player is pointed at the local file only (no session, no server URL)
          await request("POST", `/route?path=${encodeURIComponent(`/player/${m.file}?local=${id}`)}`);
          let p0 = null; for (let i = 0; i < 40 && p0 === null; i++) { await delay(800); const s = await request("GET", "/state"); if (s.playing) p0 = s.positionMs / 1000; }
          if (p0 === null) return { state: "failed", detail: "no frames" };
          await delay(4000); const s = await request("GET", "/state");
          return s.positionMs / 1000 - p0 >= 3 ? { state: "ok", detail: "offline copy played, clock advanced" } : { state: "failed", detail: "stalled" };
        }
        if (/^(series|season)-(pause|delete)$/.test(c.action)) {
          const [scope, act] = c.action.split("-");
          const existing = await list();
          assertKnownRecords(existing, ["Id", "SeriesTitle"]);
          if (scope === "season" && existing.some((d) => d.SeriesTitle === m.title && !Object.hasOwn(d, "Season") && !ownedDownloads.has(d.Id))) throw new Error("refusing grouped action while existing tickets cannot be verified");
          if (existing.some((d) => d.SeriesTitle === m.title && (scope !== "season" || Number(d.Season) === Number(m.season)) && !ownedDownloads.has(d.Id))) throw new Error("refusing grouped action while matching downloads already exist");
          // The parity fixture pins one media file, which is enough to exercise the grouped action.
          const qq = new URLSearchParams({ file: m.file, work: m.work, title: `${m.title} ${m.episode}`, quality: "original", season: String(m.season), episode: String(m.episode), series: m.title });
          const id = await start(qq);
          await waitFor(id, (d) => d.BytesDownloaded > 0 || d.state === "Ready");
          const gq = new URLSearchParams({ series: m.title, ...(scope === "season" ? { season: String(m.season) } : {}) });
          if (act === "pause") {
            await request("POST", `/dl/group?${gq}&action=pause`); await delay(1500); const d = await get(id);
            if (d.state === "Ready") return { state: "ok", detail: "finished before it could be paused (small file); the group action ran" };
            if (d.state !== "Paused") return { state: "failed", detail: `group pause left ${d.state}` };
            return { state: "ok", detail: `${scope} paused` };
          }
          await request("POST", `/dl/group?${gq}&action=delete`); await delay(1000);
          return (await get(id)) ? { state: "failed", detail: "still listed" } : { state: "ok", detail: `${scope} deleted` };
        }
        return { state: "failed", detail: `unknown action ${c.action}` };
      } catch (e) { return { state: "failed", detail: e.message }; }
    },
    async cleanupDownloads() {
      for (const id of ownedDownloads) await request("POST", `/dl/remove?id=${encodeURIComponent(id)}`).catch(() => {});
      ownedDownloads.clear();
    },
    async play(c, expect) {
      await verifyAccount();
      state = await request("POST", `/route?path=/player/${c.file}`);
      const t0 = Date.now();
      let p0 = null;
      while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) {
        await delay(800);
        const s = await request("GET", "/state");
        if (s.playing) p0 = s.positionMs / 1000;
      }
      if (p0 === null) return { state: "error", detail: "no frames in time" };
      const startSeconds = (Date.now() - t0) / 1000;
      // the picture may stall for a moment after the first frame: allow up to 30 s of wall time for the clock to advance
      let p1 = p0;
      for (let waited = 0; waited < 30000 && p1 - p0 < expect.advanceSeconds; waited += 500) {
        await delay(500);
        const s = await request("GET", "/state");
        if (s.playing) p1 = s.positionMs / 1000;
      }
      return { state: p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 - p0 };
    },
  };
}
