// Design-report capture of the screens the parity suite does not reach (design-report/SCREENS-ALL.md), for the LG webOS simulator and the
// Samsung Tizen emulator. Lane-local: it drives drivers/tizen-webos.mjs (open/evaluate/screenshot) and never edits the shared suite.
//   DEVICE=webos|tizen [PARITY_NETLOG=<dir>] node tizen-webos/design-capture.mjs --out <captures/<device> dir> [--themes dark,light] [--screens a,b]
// The 15 suite screens come from suite-run.mjs (see design-report/status/tizen-webos.md); this script adds the rest and writes results.json
// (id -> theme -> png | null, plus notes) next to the PNGs for the manifest step (design-manifest.mjs).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createDriver } from "../drivers/tizen-webos-design.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const out = opt("out");
if (!out) throw new Error("--out <captures dir for this device> required");
const themes = opt("themes", "dark,light").split(",");
const want = opt("screens", "").split(",").filter(Boolean);
const fixedNow = process.env.PARITY_FIXED_NOW ?? "2026-10-07T12:00:00Z";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = (id) => `!!document.querySelector('[data-page-id="${id}"]')`;
const text = (re) => `new RegExp(${JSON.stringify(re)}, "i").test(document.body.innerText)`;
// First link under a section, read from its list page (the fixture ids are not fixed in this file).
const firstHref = (prefix) => `(() => { const p = ${JSON.stringify("#" + prefix)}; const q = p.endsWith("=") ? "" : "/"; const a = [...document.querySelectorAll("a[href]")].find((x) => { const h = x.getAttribute("href") || ""; return h.startsWith(p + q) && h.length > (p + q).length && !h.slice((p + q).length).includes("/"); }); return a ? a.getAttribute("href").replace(/^#/, "") : null; })()`;

// id, route (or resolve: [list route, ready expression, href prefix]), ready expression
const SCREENS = [
  { id: "login", route: "/login", ready: text("sign in|log in|username") },
  { id: "login-qr", route: "/login/qr", ready: `!!document.querySelector(".device-login-qr")` },
  { id: "signup", route: "/signup", ready: text("sign up|create") },
  { id: "link", route: "/link", ready: text("link|code") },
  { id: "household", route: "/household", ready: text("household") },
  { id: "downloads", route: "/downloads", ready: page("downloads") },
  { id: "sites", route: "/sites", ready: page("library") },
  { id: "music-detail", resolve: ["/music", page("library"), "/music"], ready: page("music-detail") },
  { id: "search-results", route: "/search?q=the", ready: `!!document.querySelector(".tv-search-results")` },
  { id: "watchlist", route: "/watchlist", ready: page("watchlist") },
  { id: "requests", route: "/requests", ready: page("requests") },
  { id: "playlists", route: "/playlists", ready: page("playlists") },
  { id: "playlist-detail", resolve: ["/playlists", page("playlists"), "/playlists?playlist="], ready: page("playlists") },
  { id: "folders", route: "/folders", ready: `!!document.querySelector("[data-page-id]")` },
  ...["appearance", "profile-avatar", "language", "player", "server", "profile-lock", "invite", "request-latency", "remote", "your-data", "home"].map((s) => ({
    id: `settings-${s}`, route: `/settings/${s}`, ready: `!!document.querySelector('[data-page-id="settings"] .settings-workspace')`,
  })),
  { id: "not-found", route: "/does-not-exist", ready: text("not found|404|doesn.t exist") },
];

mkdirSync(out, { recursive: true });
const resultsFile = join(out, "..", "..", "work", "tizen-webos", `results-${process.env.DEVICE}.json`);
mkdirSync(dirname(resultsFile), { recursive: true });
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : {};

const driver = await createDriver();
await driver.setDeterministicCapture({ fixedNow });
await driver.start();
const selected = SCREENS.filter((s) => !want.length || want.includes(s.id));
for (const theme of themes) {
  await driver.setTheme(theme);
  mkdirSync(join(out, theme), { recursive: true });
  for (const s of selected) {
    const file = join(out, theme, `${s.id}.png`);
    try {
      let route = s.route;
      if (s.resolve) {
        const [list, ready, prefix] = s.resolve;
        await driver.open(list, ready);
        await sleep(1500);
        for (let i = 0; i < 30 && !route; i += 1) { route = await driver.evaluate(firstHref(prefix)); if (!route) await sleep(1000); }
        if (!route) throw new Error(`no ${prefix}/:id link on ${list}`);
      }
      await driver.open(route, s.ready);
      await sleep(1000);
      // A focused text field (sign-in, sign-up) opens the system keyboard, which the driver refuses to capture over: blur and wait for it to close.
      await driver.evaluate(`(document.activeElement instanceof HTMLElement && document.activeElement.blur(), true)`);
      await sleep(2500);
      await driver.screenshot(file);
      (results[s.id] ??= {})[theme] = `${theme}/${s.id}.png`;
      console.log(`ok ${theme} ${s.id} ${route}`);
    } catch (e) {
      (results[s.id] ??= {})[theme] ??= null;
      (results[s.id].errors ??= {})[theme] = String(e.message).split("\n")[0];
      console.log(`FAIL ${theme} ${s.id}: ${String(e.message).split("\n")[0]}`);
    }
    writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
  }
}
await driver.stop();
