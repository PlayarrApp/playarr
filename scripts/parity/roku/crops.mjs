#!/usr/bin/env node
// Focus crop audit for the Roku: drives the first, last and top-row items of the Movies grid, the Home rails and the film
// detail rails, and saves one screenshot per stop so the ring and glow can be checked at every edge, in whichever theme the
// channel is set to (set it first with capture.mjs <out> light|dark, or the profile picker's theme dropdown).
//   ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> node scripts/parity/roku/crops.mjs <out-dir> [tag]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [out, tag = "crop"] = process.argv.slice(2);
const target = process.env.ROKU_DEV_TARGET;
const password = process.env.ROKU_DEV_PASSWORD;
if (!out || !target || !password) { console.error("usage: ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> crops.mjs <out-dir> [tag]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const ecp = (path) => spawnSync("curl", ["-s", "-X", "POST", `http://${target}:8060/${path}`], { stdio: "ignore" });
const press = async (key, n = 1, wait = 0.5) => { for (let i = 0; i < n; i += 1) { ecp(`keypress/${key}`); await sleep(wait); } await sleep(1.2); };
const dig = ["--digest", "-u", `rokudev:${password}`, "--silent", "--show-error"];
const shot = (name) => {
  const jpg = join(out, `${tag}-${name}.jpg`);
  spawnSync("curl", [...dig, "-F", "mysubmit=Screenshot", "-F", "passwd=", `http://${target}/plugin_inspect`], { stdio: "ignore" });
  spawnSync("curl", [...dig, "-o", jpg, `http://${target}/pkgs/dev.jpg?time=${Date.now()}`]);
  console.log(`saved ${jpg}`);
};
// Cold start into Home, then the dock: Left, Down to the bottom, Up to the entry (Movies is 6 up from the identity chip).
const coldStart = async () => { await press("Home", 1, 3); ecp("launch/dev"); await sleep(10); await press("Down", 2, 0.6); await press("Left", 1, 0.6); await press("Up", 1, 0.6); await press("Select", 1, 1); await sleep(10); };
const dock = async (up) => { await press("Left"); await press("Down", 12, 0.35); await press("Up", up, 0.6); await press("Select"); await sleep(12); };

await coldStart();
shot("home-first");
await press("Down"); await press("Right", 40, 0.35); shot("home-rail2-last");
await press("Down"); await press("Right", 40, 0.35); shot("home-rail3-last");
await coldStart(); await dock(6);
shot("movies-first");
await press("Right", 2); shot("movies-last-column");
await press("Down", 3); shot("movies-row4");
await press("Left", 2); await press("Up", 3); shot("movies-top-row");
await press("Select"); await sleep(10);
await press("Down", 2); await press("Right", 3); shot("detail-chapters-mid");
await press("Down"); await press("Right", 5); shot("detail-cast-mid");
ecp("keypress/Home");
