#!/usr/bin/env node
// Web reference for poster ("Covers") mode at the tablet viewport (1280x800 at 2x): Home and Movies, each artwork size, both themes.
//   node cover-refs.mjs <outdir>     (credentials: PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD, or ~/.secrets PLAYARR_DEVICE_TEST_*)
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2]; if (!out) throw new Error("usage: cover-refs.mjs <outdir>");
const sec = {};
for (const l of readFileSync(process.env.HOME + "/.secrets", "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) sec[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); }
process.env.PLAYARR_SERVER_URL ??= sec.PLAYARR_DEVICE_TEST_SERVER_URL;
process.env.PLAYARR_USERNAME ??= sec.PLAYARR_DEVICE_TEST_USERNAME;
process.env.PLAYARR_PASSWORD ??= sec.PLAYARR_DEVICE_TEST_PASSWORD;
Object.assign(process.env, { PLAYARR_WEB_VIEWPORT_WIDTH: "1280", PLAYARR_WEB_VIEWPORT_HEIGHT: "800", PLAYARR_WEB_VIEWPORT_DPR: "2", PARITY_STABLE: "1" });
delete process.env.PLAYARR_WEB_MOBILE;
for (const size of ["small", "medium", "large"]) {
  process.env.PLAYARR_WEB_INIT_STORAGE = JSON.stringify({ "playarr-home-view": "cover", "playarr-artwork-size": size });
  const driver = await (await import(pathToFileURL(join(here, "..", "..", "drivers", "web.mjs")).href + "?" + size)).createDriver();
  await driver.start();
  for (const theme of ["dark", "light"]) {
    await driver.setTheme(theme); mkdirSync(join(out, size, theme), { recursive: true });
    await driver.home(); await new Promise((r) => setTimeout(r, 1500)); await driver.screenshot(join(out, size, theme, "home.png"));
    await driver.route("/movies"); await new Promise((r) => setTimeout(r, 1500)); await driver.screenshot(join(out, size, theme, "movies.png"));
    console.log("ok", size, theme);
  }
  await driver.stop();
}
