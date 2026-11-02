// Design-report capture of the key-driven states (design-report/SCREENS-ALL.md): home--focus-second-rail, profiles--add, player, search--keyboard.
// Same driver and results.json as design-capture.mjs.
//   DEVICE=webos|tizen [PARITY_NETLOG=<dir>] node tizen-webos/design-states.mjs --out <captures/<device> dir> [--themes dark,light] [--states a,b]
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDriver } from "../drivers/tizen-webos.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const out = opt("out");
if (!out) throw new Error("--out <captures dir for this device> required");
const themes = opt("themes", "dark,light").split(",");
const want = opt("states", "").split(",").filter(Boolean);
const fixedNow = process.env.PARITY_FIXED_NOW ?? "2026-10-07T12:00:00Z";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const device = process.env.DEVICE;
const display = device === "tizen" ? process.env.TIZEN_DISPLAY ?? ":25" : process.env.WEBOS_DISPLAY ?? ":26";

const resultsFile = join(out, "..", "..", "work", "tizen-webos", `results-${device}.json`);
mkdirSync(dirname(resultsFile), { recursive: true });
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : {};

const driver = await createDriver();
await driver.setDeterministicCapture({ fixedNow });
await driver.start();
const press = async (keys) => { for (const k of keys) { const m = /^(.*)\*(\d+)$/.exec(k); const n = m ? Number(m[2]) : 1; for (let i = 0; i < n; i += 1) await driver.key(m ? m[1] : k); } };
const blur = () => driver.evaluate(`(document.activeElement instanceof HTMLElement && document.activeElement.blur(), true)`);
// Raw display grab (the driver's screenshot refuses a frame with the system keyboard over it).
const rawGrab = (file) => { const xwd = `${file}.xwd`; writeFileSync(xwd, execFileSync("xwd", ["-display", display, "-root", "-silent"], { maxBuffer: 64 << 20 })); execFileSync("magick", [`xwd:${xwd}`, `png:${file}`]); rmSync(xwd); };

const STATES = {
  "home--focus-second-rail": async (file) => { await driver.home(); await press(["down"]); await sleep(1500); await driver.screenshot(file); },
  "profiles--add": async (file) => {
    await driver.open("/profiles", `!!document.getElementById("profile-add")`);
    await driver.evaluate(`(document.getElementById("profile-add").focus(), true)`);
    await sleep(1500);
    await driver.screenshot(file);
  },
  // Playing, controls hidden, paused at 0:02: reach the player as the suite does (Movies, first film, Play), then pause at 2 s and let the controls hide.
  player: async (file) => {
    await driver.home();
    await press(["left", "down*12", "up*6", "select", "right", "select"]);
    const probe = `(() => { const v = document.querySelector("video"); const a = window.webapis && window.webapis.avplay; let t = null; try { t = a && a.getState() === "PLAYING" ? a.getCurrentTime() / 1000 : null; } catch (e) {} return (v && !v.paused && v.currentTime > 2.2) || (t !== null && t > 2.2); })()`;
    for (let i = 0; i < 100; i += 1) { if (await driver.evaluate(probe).catch(() => false)) break; await sleep(450); }
    await driver.evaluate(`(() => { const v = document.querySelector("video"); const a = window.webapis && window.webapis.avplay; try { if (a && a.getState() === "PLAYING") { a.pause(); a.seekTo(2000); } } catch (e) {} if (v) { v.pause(); v.currentTime = 2; } return true; })()`);
    await sleep(8000); // the controls hide after 5 s without input
    const hidden = await driver.evaluate(`(() => { const c = document.querySelector(".player-controls"); return !c || c.classList.contains("is-hidden") || getComputedStyle(c).opacity === "0" || getComputedStyle(c).visibility === "hidden"; })()`);
    console.log(`  player controls hidden: ${hidden}`);
    await driver.screenshot(file);
  },
  "search--keyboard": async (file) => {
    await driver.open("/search", `!!document.querySelector('.tv-search-form input[type="search"]')`);
    await driver.evaluate(`(document.querySelector('.tv-search-form input[type="search"]').focus(), true)`);
    await driver.key("select");
    await sleep(4000);
    rawGrab(file);
  },
};

for (const theme of themes) {
  await driver.setTheme(theme);
  mkdirSync(join(out, theme), { recursive: true });
  for (const [id, run] of Object.entries(STATES)) {
    if (want.length && !want.includes(id)) continue;
    const file = join(out, theme, `${id}.png`);
    try {
      await run(file);
      (results[id] ??= {})[theme] = `${theme}/${id}.png`;
      console.log(`ok ${theme} ${id}`);
    } catch (e) {
      (results[id] ??= {})[theme] ??= null;
      (results[id].errors ??= {})[theme] = String(e.message).split("\n")[0];
      console.log(`FAIL ${theme} ${id}: ${String(e.message).split("\n")[0]}`);
    }
    writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
  }
  await blur().catch(() => {});
}
await driver.stop();
