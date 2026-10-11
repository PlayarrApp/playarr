// Driver for the native Tizen TV app (clients/tizen-native) on a Tizen TV emulator. Contract: docs/parity/SUITE.md.
// Needs the app built with `-p:PlayarrDebug=true` (it starts a small control server on port 8765), the Tizen SDK `sdb`
// on PATH or in PLAYARR_SDB, and ImageMagick `import` for screenshots of the emulator display.
//   PLAYARR_TIZEN_SERIAL (default emulator-26101), PLAYARR_TIZEN_FORWARD (local port, default 18890),
//   PLAYARR_TIZEN_DISPLAY (X display of the emulator window, default :25), PLAYARR_SDB.
import { execFileSync } from "node:child_process";

const SDB = process.env.PLAYARR_SDB ?? "sdb";
const SERIAL = process.env.PLAYARR_TIZEN_SERIAL ?? "emulator-26101";
const PORT = Number(process.env.PLAYARR_TIZEN_FORWARD ?? 18890);
const DISPLAY = process.env.PLAYARR_TIZEN_DISPLAY ?? ":25";
const base = `http://127.0.0.1:${PORT}`;
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
    async home() { state = await call("POST", "/route?path=/"); await sleep(9000); },
    async route(p) { state = await call("POST", `/route?path=${encodeURIComponent(p)}`); await sleep(7000); },
    async key(k, { long } = {}) { state = await call("POST", `/key?name=${k}${long ? "&long=1" : ""}`); await sleep(long ? 1500 : 900); },
    async location() { state = await call("GET", "/state"); return state.route; },
    async focused() { state = await call("GET", "/state"); return state.focused ?? null; },
    async screenshot(file) {
      await sleep(2500);
      execFileSync("import", ["-window", "root", file], { env: { ...process.env, DISPLAY } });
    },
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
      // the picture may stall for a moment after the first frame: allow up to 15 s of wall time for the clock to advance
      let p1 = p0;
      for (let waited = 0; waited < 15000 && p1 - p0 < expect.advanceSeconds; waited += 500) {
        await sleep(500);
        const s = await call("GET", "/state");
        if (s.playing) p1 = s.positionMs / 1000;
      }
      return { state: p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 - p0 };
    },
  };
}
