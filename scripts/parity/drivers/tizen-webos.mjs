// Suite driver (docs/parity/SUITE.md) for the Samsung Tizen emulator and the LG webOS simulator.
//   DEVICE=tizen|webos  [TIZEN_DISPLAY=:25] [WEBOS_DISPLAY=:26] [WEBOS_CDP=9226] [PARITY_NETLOG=<dir>]
// webOS: Chrome DevTools Protocol (keys and eval). Tizen: X key events to the emulator window plus the debug build's
// netlog.js eval channel (a debug build with scripts/parity/tizen-webos/netlog.js; the host side is logserver.py <dir>/log.txt). Both then drive the same page functions.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NETLOG = process.env.PARITY_NETLOG ?? join(tmpdir(), "playarr-netlog");
const XCLICK = join(here, "..", "tizen-webos", "xclick.py");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYCODE = { up: 38, down: 40, left: 37, right: 39, select: 13, back: 27 };
const KEYNAME = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", select: "Enter", back: "Escape" };
const XKEY = { up: "Up", down: "Down", left: "Left", right: "Right", select: "Return", back: "Escape" };
const BAD = "/could not be loaded|not signed in|link code/i.test(document.body.innerText)";

export async function createDriver() {
  const device = process.env.DEVICE;
  if (!["tizen", "webos"].includes(device)) throw new Error("DEVICE=tizen|webos required");
  const display = device === "tizen" ? process.env.TIZEN_DISPLAY ?? ":25" : process.env.WEBOS_DISPLAY ?? ":26";
  const cdpPort = process.env.WEBOS_CDP ?? "9226";
  let ws, seq = 0, pending = new Map(), evalSeq = 0;

  async function cdpConnect() {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const t = list.find((x) => /webos-stage/.test(x.url));
    if (!t) throw new Error("webOS app page not found (launcher showing?)");
    ws = new WebSocket(t.webSocketDebuggerUrl);
    pending = new Map();
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  }
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  async function ev(expr) {
    if (device === "tizen") {
      const id = `d${Date.now()}${evalSeq++}`;
      writeFileSync(`${NETLOG}/cmd.txt`, `eval:${id}:${expr.replace(/\n/g, " ")}`);
      for (let i = 0; i < 40; i += 1) {
        await sleep(500);
        const hit = readFileSync(`${NETLOG}/log.txt`, "utf8").split("\n").reverse().find((l) => l.includes(`"id":"${id}"`));
        if (hit) { const o = JSON.parse(hit.slice(hit.indexOf("{"))); if (o.error) throw new Error(o.error); return o.value; }
      }
      return undefined;
    }
    if (!ws || ws.readyState !== 1) await cdpConnect();
    const r = (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result;
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  }
  // Reload at a hash route and wait until the app is up again (a reload drops the debug channel for a few seconds).
  async function load(route) {
    if (device === "tizen") {
      // The host is shared and often loaded: allow a slow reload before re-sending (a command polled during a reload is lost).
      for (let a = 0; a < 4; a += 1) {
        writeFileSync(`${NETLOG}/cmd.txt`, `hash:${route}`);
        await sleep(8000);
        for (let i = 0; i < 6; i += 1) if ((await ev("location.hash").catch(() => undefined)) === `#${route}`) return;
      }
      throw new Error(`tizen did not reach ${route}`);
    }
    await ev(`(history.replaceState(null, "", "#" + ${JSON.stringify(route)}), setTimeout(() => location.reload(), 50), true)`).catch(() => {});
    await sleep(2500);
    ws = undefined;
    await cdpConnect();
  }
  async function until(expr, ms = 90000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(1000); }
    return false;
  }
  const settle = async () => {
    await until("[...document.images].every((i) => i.complete)", 30000);
    await sleep(1500);
  };
  const xkey = (k, long) => execFileSync("python3", [XCLICK, display, ...(long ? ["hold", XKEY[k], "900"] : ["press", XKEY[k]])], { stdio: "ignore" });

  return {
    async start() {
      if (device === "webos") await cdpConnect();
      // X autorepeat would turn a held key into repeated presses and cancel the long-press timer.
      else execFileSync("xset", ["-display", display, "r", "off"], { stdio: "ignore" });
    },
    async stop() { ws?.close(); },
    async setTheme(t) {
      await ev(`(localStorage.setItem("playarr-theme", ${JSON.stringify(t)}), true)`);
    },
    async home() {
      await load("/");
      if (!(await until(`document.querySelectorAll(".app-nav-link").length >= 6 && !document.querySelector(".app-nav-link-placeholder") && !!document.querySelector(".tv-home-card")`))) throw new Error("home did not load");
      // A key sent before the first card holds focus is lost.
      if (!(await until("!!document.activeElement && document.activeElement !== document.body", 10000))) throw new Error("no focus on home");
      // Rails fill in asynchronously and reorder the cards: wait until the card list holds still before focusing.
      let last = "", still = 0;
      for (let i = 0; i < 40 && still < 3; i += 1) {
        const now = await ev(`[...document.querySelectorAll(".tv-home-card")].map((c) => c.getAttribute("aria-label") || c.textContent.trim().slice(0, 40)).join("|")`).catch(() => "");
        still = now && now === last ? still + 1 : 0; last = now; await sleep(1500);
      }
      // The contract: Home with its first card focused (the app can restore an earlier focus).
      await ev(`(document.querySelector(".tv-home-card").focus(), true)`);
      await sleep(3500); // the key handler attaches a moment after the first focus
      console.log(`  home first card: ${last.split("|")[0]}`);
      await settle();
    },
    async route(r) { await load(r); await settle(); },
    async key(k, { long } = {}) {
      if (device === "tizen") xkey(k, long);
      else {
        const c = { key: KEYNAME[k], code: KEYNAME[k], windowsVirtualKeyCode: KEYCODE[k], nativeVirtualKeyCode: KEYCODE[k] };
        await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...c });
        if (long) await sleep(900);
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...c });
      }
      await sleep(device === "webos" ? 750 : 350); // the simulator drops presses that come faster than it renders
    },
    async location() { return (await ev("location.hash.replace(/^#/, '')")) ?? null; },
    async focused() {
      return ev(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; return e.getAttribute("aria-label") || e.textContent.trim().slice(0, 80) || e.className.toString(); })()`);
    },
    async screenshot(file) {
      await ev("(document.activeElement && document.activeElement.blur && document.activeElement.blur(), true)");
      if (await ev(BAD)) throw new Error("signed out or error page");
      await settle();
      const xwd = `${file}.xwd`;
      writeFileSync(xwd, execFileSync("xwd", ["-display", display, "-root", "-silent"], { maxBuffer: 64 << 20 }));
      execFileSync("magick", [`xwd:${xwd}`, `png:${file}`]);
      rmSync(xwd);
    },
    // Opens the file's player by deep link (as the web driver does), samples the playhead of <video> or Tizen AVPlay.
    async play(c, expect) {
      const pos = `(() => { const v = document.querySelector("video"); if (v && !v.error && v.readyState >= 2) return v.currentTime;
        try { const a = webapis.avplay; if (a.getState() === "PLAYING") return a.getCurrentTime() / 1000; } catch (e) {} return null; })()`;
      await load("/player/" + c.file);
      const t0 = Date.now();
      let p0 = null;
      while (p0 === null && Date.now() - t0 < expect.startWithinSeconds * 1000) { await sleep(500); p0 = await ev(pos).catch(() => null) ?? null; }
      let out;
      if (p0 === null) out = { state: "error", detail: "no frames in time" };
      else {
        const startSeconds = (Date.now() - t0) / 1000;
        // Playing means the playhead advanced by advanceSeconds within advanceSeconds + 6 s of wall clock (startup buffering eats part of a short window).
        let p1 = p0;
        for (let i = 0; i < (expect.advanceSeconds + 6) * 2 && p1 - p0 < expect.advanceSeconds; i += 1) { await sleep(500); p1 = (await ev(pos).catch(() => null)) ?? p1; }
        out = { state: p1 - p0 >= expect.advanceSeconds ? "playing" : "stalled", startSeconds, advancedSeconds: p1 - p0 };
      }
      // AVPlay hangs the app if the page reloads while it plays: stop it first.
      await ev(`(() => { try { webapis.avplay.stop(); webapis.avplay.close(); } catch (e) {} return true; })()`).catch(() => {});
      return out;
    },
  };
}
