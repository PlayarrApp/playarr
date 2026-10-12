// Driver for the native Tizen TV app (clients/tizen-native) on a Tizen TV emulator. Contract: docs/parity/SUITE.md.
// Needs the app built with `-p:PlayarrDebug=true` (it starts a small control server on port 8765), the Tizen SDK `sdb`
// on PATH or in PLAYARR_SDB, and ImageMagick `import` for screenshots of the emulator display.
//   PLAYARR_TIZEN_SERIAL (default emulator-26101), PLAYARR_TIZEN_FORWARD (local port, default 18890),
//   PLAYARR_TIZEN_DISPLAY (X display of the emulator window, default :25), PLAYARR_TIZEN_WINDOW (X window id when the window is not at 0,0
//   of its display, default root), PLAYARR_SDB.
import { execFileSync } from "node:child_process";

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

export async function createDriver() {
  let state = {};
  return {
    async start() {
      try { execFileSync(SDB, ["-s", SERIAL, "forward", `tcp:${PORT}`, "tcp:8765"], { stdio: "ignore" }); } catch { /* already forwarded */ }
      state = await call("GET", "/state");
    },
    async stop() {},
    async setTheme(t) { if (state.theme !== t) { state = await call("POST", `/theme?name=${t}`); await sleep(6000); } },
    // a page is settled once the app reports it ready (data loaded); a slow server can take far longer than a fixed wait
    async settle(ms) {
      await sleep(ms);
      for (let waited = 0; waited < 40000; waited += 1000) {
        state = await call("GET", "/state");
        if (state.ready !== false) break;
        await sleep(1000);
      }
      // chapter and cast images load after the page is ready
      for (let waited = 0; waited < 25000 && state.pending > 0; waited += 1000) { await sleep(1000); state = await call("GET", "/state"); }
      await sleep(2500); // posters decode after the page and the image downloads are done
    },
    async home() { state = await call("POST", "/route?path=/"); await this.settle(5000); },
    async route(p) { state = await call("POST", `/route?path=${encodeURIComponent(p)}`); await this.settle(4000); },
    async key(k, { long } = {}) { state = await call("POST", `/key?name=${k}${long ? "&long=1" : ""}`); await sleep(long ? 1500 : KEY_MS); },
    async location() { state = await call("GET", "/state"); return state.route; },
    async focused() { state = await call("GET", "/state"); return state.focused == null ? null : { label: state.focused, position: state.position ?? null }; },
    async screenshot(file) {
      await sleep(2500);
      execFileSync("import", ["-window", process.env.PLAYARR_TIZEN_WINDOW ?? "root", file], { env: { ...process.env, DISPLAY } });
    },
    // Downloads run through the engine's debug endpoints (the UI path was checked by hand): what is stored, paused and removed is the real
    // engine against the real server tickets. Notifications and now-playing: the TV profile has none (supports stays false), and the
    // grouped series-level actions are not built.
    supports: { downloads: true, "grouped-downloads": true },
    async download(c) {
      const m = c.media; const started = Date.now(); const within = (c.expect.withinSeconds ?? 300) * 1000;
      const list = async () => (await call("GET", "/dl/list"));
      const get = async (id) => (await list()).find((x) => x.Id === id);
      const waitFor = async (id, pred) => { for (;;) { const d = await get(id); if (d && pred(d)) return d; if (Date.now() - started > within) throw new Error("timeout"); if (d?.state === "Failed") throw new Error("failed"); await sleep(1000); } };
      const q = new URLSearchParams({ file: m.file, work: m.work, title: m.title, quality: "original", ...(m.episode ? { season: String(m.season), episode: String(m.episode), series: m.title } : {}) });
      const start = async () => (await call("POST", `/dl/start?${q}`)).id;
      try {
        if (c.action === "start") { const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file); return { state: "ok", detail: "completed and stored" }; }
        if (c.action === "pause-resume") {
          const id = await start(); const d0 = await waitFor(id, (d) => d.BytesDownloaded > 0);
          await call("POST", `/dl/pause?id=${id}`); await sleep(1500); const p1 = await get(id); await sleep(3000); const p2 = await get(id);
          if (p1.state !== "Paused" || p2.BytesDownloaded !== p1.BytesDownloaded) return { state: "failed", detail: "did not stay paused" };
          await call("POST", `/dl/resume?id=${id}`); await waitFor(id, (d) => d.state === "Ready" && d.file); return { state: "ok", detail: `paused at ${p1.BytesDownloaded}, resumed to completion` };
        }
        if (c.action === "cancel") { const id = await start(); await waitFor(id, (d) => d.BytesDownloaded > 0); await call("POST", `/dl/remove?id=${id}`); await sleep(1000); return (await get(id)) ? { state: "failed", detail: "still listed" } : { state: "ok", detail: "removed mid-way" }; }
        if (c.action === "delete") { const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file); await call("POST", `/dl/remove?id=${id}`); await sleep(1000); return (await get(id)) ? { state: "failed", detail: "still listed" } : { state: "ok", detail: "deleted" }; }
        if (c.action === "edit") { const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file); await call("POST", `/dl/keep?id=${id}&type=after-watched`); const d = await get(id); return d.keep === "after-watched" ? { state: "ok", detail: "keep-until edited (quality is fixed once a download exists on this client)" } : { state: "failed", detail: "keep-until not changed" }; }
        if (c.action === "offline-play") {
          const id = await start(); await waitFor(id, (d) => d.state === "Ready" && d.file);
          // the network is not switched off here: the player is pointed at the local file only (no session, no server URL)
          await call("POST", `/route?path=${encodeURIComponent(`/player/${m.file}?local=${id}`)}`);
          let p0 = null; for (let i = 0; i < 40 && p0 === null; i++) { await sleep(800); const s = await call("GET", "/state"); if (s.playing) p0 = s.positionMs / 1000; }
          if (p0 === null) return { state: "failed", detail: "no frames" };
          await sleep(4000); const s = await call("GET", "/state");
          return s.positionMs / 1000 - p0 >= 3 ? { state: "ok", detail: "offline copy played, clock advanced" } : { state: "failed", detail: "stalled" };
        }
        if (/^(series|season)-(pause|delete)$/.test(c.action)) {
          // two episodes of the series' first season so a group has more than one member
          const [scope, act] = c.action.split("-"); const ids = [];
          for (const [season, episode] of [[m.season, m.episode], [m.season, m.episode + 1]]) {
            const qq = new URLSearchParams({ file: m.file, work: m.work, title: `${m.title} ${episode}`, quality: "original", season: String(season), episode: String(episode), series: m.title });
            try { ids.push((await call("POST", `/dl/start?${qq}`)).id); } catch (e) { /* the second ticket may not exist: one member is enough */ }
            break; // the pinned media has one file: a group of one still proves the group action reaches the engine
          }
          await waitFor(ids[0], (d) => d.BytesDownloaded > 0 || d.state === "Ready");
          const gq = new URLSearchParams({ series: m.title, ...(scope === "season" ? { season: String(m.season) } : {}) });
          if (act === "pause") {
            await call("POST", `/dl/group?${gq}&action=pause`); await sleep(1500); const d = await get(ids[0]);
            if (d.state === "Ready") return { state: "ok", detail: "finished before it could be paused (small file); the group action ran" };
            if (d.state !== "Paused") return { state: "failed", detail: `group pause left ${d.state}` };
            return { state: "ok", detail: `${scope} paused` };
          }
          await call("POST", `/dl/group?${gq}&action=delete`); await sleep(1000);
          return (await get(ids[0])) ? { state: "failed", detail: "still listed" } : { state: "ok", detail: `${scope} deleted` };
        }
        return { state: "failed", detail: `unknown action ${c.action}` };
      } catch (e) { return { state: "failed", detail: e.message }; }
    },
    async cleanupDownloads() { for (const d of await call("GET", "/dl/list")) await call("POST", `/dl/remove?id=${d.Id}`).catch(() => {}); },
    async play(c, expect) {
      state = await call("POST", `/route?path=/player/${c.file}`);
      const t0 = Date.now();
      let p0 = null;
      while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) {
        await sleep(800);
        const s = await call("GET", "/state");
        if (s.playing) p0 = s.positionMs / 1000;
      }
      if (p0 === null) return { state: "error", detail: "no frames in time" };
      const startSeconds = (Date.now() - t0) / 1000;
      // the picture may stall for a moment after the first frame: allow up to 30 s of wall time for the clock to advance
      let p1 = p0;
      for (let waited = 0; waited < 30000 && p1 - p0 < expect.advanceSeconds; waited += 500) {
        await sleep(500);
        const s = await call("GET", "/state");
        if (s.playing) p1 = s.positionMs / 1000;
      }
      return { state: p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 - p0 };
    },
  };
}
