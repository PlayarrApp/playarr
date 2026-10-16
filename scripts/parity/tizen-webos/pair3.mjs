// Screen-capture tool for the webOS simulator and the Tizen debug build (not the shared suite runner: the suite does D-pad, playback, downloads).
// PARITY_OUT=<dir> PARITY_CHROME=<chromium> PLAYARR_DEVICE_TEST_* env. DEVICES="webos:9226::26,tizen:0::25" node pair3.mjs [screen ...]
// Drives live web (Playwright, TV UA) and the TV shell (CDP) through the SAME steps per screen, then saves
// web/<id>.png and <cand>/<id>.png (1920x1080) for the wall legend. The web context is seeded with the shell's
// own login as the same account and profile. No secret is printed.
// Scratch only (real titles): never commit these images.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
import { resolveTestServerUrl } from "../test-server-env.mjs";
const ROOT = process.env.PARITY_OUT ?? "parity-out"; // <ROOT>/web, <ROOT>/<cand>, with -light variants
const XCLICK = new URL("./xclick.py", import.meta.url).pathname;
const only = process.argv.slice(2);
// THEME=light captures into web-light/ and <cand>-light/ (dark stays in web/ and <cand>/ for the legend).
const THEME = process.env.THEME ?? "dark";
const SUF = THEME === "dark" ? "" : `-${THEME}`;
// DEVICES="webos:9226::26,tizen:0::25" (candidate:cdpPort:display). Every device and web are driven through the
// same steps in the same run, so web/<id>.png is the reference for all candidates.
const DEVICES = (process.env.DEVICES ?? "webos:9226::26,tizen:0::25").split(",").map((spec) => {
  const [cand, port, ...rest] = spec.split(":");
  return { cand, port, display: rest.join(":") };
});
mkdirSync(`${ROOT}/web${SUF}`, { recursive: true });
for (const d of DEVICES) mkdirSync(`${ROOT}/${d.cand}${SUF}`, { recursive: true });
const UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27 };
const X_KEYS = { ArrowLeft: "Left", ArrowUp: "Up", ArrowRight: "Right", ArrowDown: "Down", Enter: "Return", Escape: "Escape" };
import { readFileSync as readLog, writeFileSync as writeCmd } from "node:fs";
const NETLOG = process.env.PARITY_NETLOG ?? `${ROOT}/netlog`;

// webOS simulator: Chrome DevTools Protocol.
async function cdpConnect(d) {
  const list = await (await fetch(`http://127.0.0.1:${d.port}/json/list`)).json();
  const t = list.find((x) => /webos-stage/.test(x.url));
  d.ws = new WebSocket(t.webSocketDebuggerUrl);
  d.seq = 0;
  d.pending = new Map();
  d.ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && d.pending.has(msg.id)) { d.pending.get(msg.id)(msg); d.pending.delete(msg.id); } };
  await new Promise((r) => (d.ws.onopen = r));
}
const cdpSend = (d, method, params = {}) => new Promise((r) => { const i = ++d.seq; d.pending.set(i, r); d.ws.send(JSON.stringify({ id: i, method, params })); });
// Tizen emulator (no inspector): a debug-only build polls the host log sink for commands and posts results back.
let evalSeq = 0;
async function tizenEval(expression) {
  const id = `e${Date.now()}${evalSeq++}`;
  writeCmd(`${NETLOG}/cmd.txt`, `eval:${id}:${expression.replace(/\n/g, " ")}`);
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const hit = readLog(`${NETLOG}/log.txt`, "utf8").split("\n").find((line) => line.includes(`"id":"${id}"`));
    if (hit) return JSON.parse(hit.slice(hit.indexOf("{"))).value;
  }
  return undefined;
}
async function devEval(d, expression) {
  if (d.cand === "tizen") return tizenEval(expression);
  return (await cdpSend(d, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
}
async function devKey(d, key) {
  if (d.cand === "tizen") {
    execFileSync("python3", [XCLICK, d.display, "press", X_KEYS[key]], { stdio: "ignore" });
    return;
  }
  const common = { key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  await cdpSend(d, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await cdpSend(d, "Input.dispatchKeyEvent", { type: "keyUp", ...common });
}
async function devGoto(d, route) {
  if (d.cand === "tizen") {
    // A command polled during a reload is lost, so confirm the route and retry.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      writeCmd(`${NETLOG}/cmd.txt`, `hash:${route}`);
      await sleep(6000);
      const hash = await tizenEval("location.hash");
      if (hash === `#${route}`) return;
    }
    console.log("WARN tizen did not reach", route);
    return;
  }
  await devEval(d, `(sessionStorage.clear(), history.scrollRestoration = "manual", history.replaceState(null, "", "#" + ${JSON.stringify(route)}), location.reload(), true)`).catch(() => {});
  await sleep(1500);
  await cdpConnect(d);
}

const screens = {
  home: { route: "/" }, movies: { route: "/movies" }, series: { route: "/series" }, music: { route: "/music" },
  "calendar-month": { route: "/calendar?view=month" }, "calendar-week": { route: "/calendar?view=week" }, "calendar-agenda": { route: "/calendar?view=agenda" },
  search: { route: "/search", type: "the" },
  "film-detail": { route: "/movies", openFirst: "/movies/" }, "series-detail": { route: "/series", openFirst: "/series/" },
  settings: { route: "/settings" }, filters: { route: "/movies", click: "Filters" }, profiles: { route: "/profiles" },
  "player-controls": { route: "/movies", openFirst: "/movies/", keys: ["Enter"], player: true },
  actions: { route: "/movies", actions: true },
  // Behaviour checks (not legend screens): the same D-pad presses on both sides.
  "b-home-right": { route: "/", keys: ["ArrowRight", "ArrowRight"] },
  "b-home-down": { route: "/", keys: ["ArrowDown"] },
  "b-home-nav": { route: "/", keys: ["ArrowLeft"] },
  "b-movies-grid": { route: "/movies", keys: ["ArrowRight", "ArrowDown"] },
  "b-series-detail-back": { route: "/series", openFirst: "/series/", keys: ["ArrowDown", "Escape"] },
};

// Same DOM steps on both sides, as page functions.
const STEP = {
  type: (q) => { const i = document.querySelector("input"); if (!i) return false; i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, q); i.dispatchEvent(new Event("input", { bubbles: true })); return true; },
  click: (name) => { const b = [...document.querySelectorAll("button,[role=button]")].find((x) => new RegExp(name, "i").test(x.getAttribute("aria-label") || x.textContent || "")); if (!b) return false; b.click(); return true; },
  openFirst: (prefix) => { const a = [...document.querySelectorAll("main a[href]")].find((x) => (x.getAttribute("href") || "").replace(/^#/, "").startsWith(prefix)); return a ? (a.getAttribute("href") || "").replace(/^#/, "") : null; },
  // Fair capture: keyboard dismissed on every side (web has none); video plane hidden (AVPlay is a native overlay the screenshot cannot see).
  settle: (o) => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (o) document.querySelectorAll("video").forEach((v) => { v.pause(); v.style.visibility = "hidden"; }); return true; },
  actions: () => { const a = document.querySelector("main a[href*='/movies/']"); if (!a) return false; a.focus(); a.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); return true; },
};
const call = (fn, arg) => `(${fn.toString()})(${JSON.stringify(arg)})`;

for (const d of DEVICES) if (d.cand !== "tizen") await cdpConnect(d);
for (const d of DEVICES) await devEval(d, `(localStorage.setItem("playarr-theme", ${JSON.stringify(THEME)}), true)`);
// The web side signs in on its own (its own device id and session), as the device test account on the
// Device Test profile. Sharing the shell's session would make the two clients rotate each other's refresh token.
const api = resolveTestServerUrl(process.env);
const DEV = "5a1e0000-0000-4000-8000-00000000c6a5";
async function j(path, token, init = {}) {
  let r;
  for (let n = 0; n < 12; n += 1) {
    try { r = await fetch(api + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } }); break; } catch (e) { if (n === 11) throw e; await sleep(5000); }
  }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
const client = { device_id: DEV, device_name: "parity-tizen-webos-web", client_platform: "web", client_version: "parity" };
let s = await j("/api/v1/auth/login", null, { method: "POST", body: JSON.stringify({ username: process.env.PLAYARR_DEVICE_TEST_USERNAME, password: process.env.PLAYARR_DEVICE_TEST_PASSWORD, ...client }) });
const profiles = await j("/api/v1/users/profiles", s.access_token).then((p) => (Array.isArray(p) ? p : p.profiles ?? []));
const want = profiles.find((p) => p.display_name === "Device Test");
if (want && want.id !== s.user_id) s = await j("/api/v1/auth/login", s.access_token, { method: "POST", body: JSON.stringify({ ...client, profile_user_id: want.id }) });
s.name = profiles.find((p) => p.id === s.user_id)?.display_name ?? "Device Test";
// Headless Chromium hides scrollbars by default; a TV browser does not.
const browser = await chromium.launch({ executablePath: process.env.PARITY_CHROME, ignoreDefaultArgs: ["--hide-scrollbars"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: UA, colorScheme: THEME, locale: "en-GB", timezoneId: "Asia/Bangkok" });
await context.addInitScript(({ api, s, dev, theme }) => {
  localStorage.setItem("playarr-theme", theme);
  localStorage.setItem("playarr:apiBaseUrl", api);
  const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
  localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "parity", apiBaseUrl: api, userId: s.user_id, name: s.name, deviceId: dev, session }]));
  localStorage.setItem("playarr.currentUserName", s.name);
  localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "parity", apiBaseUrl: api, userId: s.user_id }));
}, { api, s, dev: DEV, theme: THEME });
await context.route(/\/api\/v1\/playback\/(progress|[^/]+\/progress|sessions\/[^/]+\/events)/, (r) => (r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 204, body: "" })));
const page = await context.newPage();

async function goBoth(route) {
  await page.goto(`https://playarr.app${route}`, { waitUntil: "load" }).catch(() => {});
  for (const d of DEVICES) await devGoto(d, route);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(Number(process.env.PAIR_WAIT ?? 12000));
  // The live reference occasionally shows a transient load error; reload once rather than capture it.
  if (await page.getByText(/could not be loaded/i).count().catch(() => 0)) {
    await page.reload({ waitUntil: "load" }).catch(() => {});
    await sleep(10000);
  }
}
async function both(fn, arg) {
  const web = await page.evaluate(call(fn, arg));
  for (const d of DEVICES) await devEval(d, call(fn, arg));
  return [web];
}
async function keyAll(k) { await page.keyboard.press(k); for (const d of DEVICES) await devKey(d, k); }

const BAD = () => /could not be loaded|not signed in|link code/i.test(document.body.innerText);
for (const [id, sc] of Object.entries(screens)) {
  if (only.length && !only.includes(id)) continue;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    await goBoth(sc.route);
    if (sc.openFirst) {
      const [href] = await both(STEP.openFirst, sc.openFirst);
      if (href) await goBoth(href);
    }
    if (sc.type) { await both(STEP.type, sc.type); await sleep(4000); }
    if (sc.click) { await both(STEP.click, sc.click); await sleep(7000); }
    if (sc.actions) { await both(STEP.actions); await sleep(7000); }
    for (const k of sc.keys ?? []) { await keyAll(k); await sleep(1000); }
    if (sc.player) { await sleep(8000); await keyAll("ArrowDown"); await sleep(1500); }
    if (sc.type || sc.player) { await both(STEP.settle, !!sc.player); await sleep(5000); }
    // Never publish an error or signed-out screen: retry the whole screen, then fail.
    const bad = [await page.evaluate(BAD), ...(await Promise.all(DEVICES.map((d) => devEval(d, `(${BAD.toString()})()`))))];
    if (bad.some(Boolean)) throw new Error(`error screen on ${bad.map((b, i) => (b ? ["web", ...DEVICES.map((d) => d.cand)][i] : "")).join(" ")}`);
    await page.screenshot({ path: `${ROOT}/web${SUF}/${id}.png` });
    for (const d of DEVICES) {
      const xwd = `${ROOT}/${d.cand}${SUF}/${id}.xwd`;
      writeFileSync(xwd, execFileSync("xwd", ["-display", d.display, "-root", "-silent"], { maxBuffer: 64 << 20 }));
      execFileSync("magick", [`xwd:${xwd}`, `png:${ROOT}/${d.cand}${SUF}/${id}.png`]);
      rmSync(xwd);
      // Close the on-screen keyboard (opened by a focused text field) before the next screen.
      await devEval(d, "document.activeElement && document.activeElement.blur && document.activeElement.blur(), true");
    }
    // Leave the player through the app (Back) before the next screen: reloading the page while AVPlay is
    // active hangs the Tizen app's main thread.
    if (sc.player) { for (let i = 0; i < 2; i += 1) { await keyAll("Escape"); await sleep(1500); } }
    console.log("captured", id);
    break;
  } catch (e) { console.log("FAILED", id, attempt, String(e).slice(0, 200)); await sleep(15000); }
  }
}
for (const d of DEVICES) await devGoto(d, "/");
await browser.close();
process.exit(0);
