#!/usr/bin/env node
// Web side of the round-3 focus walk: the same key sequences the tablet's focus-walk (foc.sh) sends, printing the focused control's label after each key,
// so the two are compared by label, not key count.   node focus-walk.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const sec = {};
for (const l of readFileSync(process.env.HOME + "/.secrets", "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) sec[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); }
process.env.PLAYARR_SERVER_URL ??= sec.PLAYARR_DEVICE_TEST_SERVER_URL; process.env.PLAYARR_USERNAME ??= sec.PLAYARR_DEVICE_TEST_USERNAME; process.env.PLAYARR_PASSWORD ??= sec.PLAYARR_DEVICE_TEST_PASSWORD;
Object.assign(process.env, { PLAYARR_WEB_VIEWPORT_WIDTH: "1280", PLAYARR_WEB_VIEWPORT_HEIGHT: "800", PLAYARR_WEB_VIEWPORT_DPR: "2", PARITY_STABLE: "1" });
const driver = await (await import(pathToFileURL(join(here, "..", "..", "drivers", "web.mjs")).href)).createDriver();
await driver.start(); await driver.setTheme("dark");
const walks = [
  ["settings", "/settings", ["down", "down", "down", "right", "down", "down"]],
  ["search", "/search", ["down", "down", "down", "right", "right"]],
  ["movies", "/movies", ["right", "right", "down", "down", "left", "up"]],
  ["calendar-week", "/calendar?view=week&date=2026-10-14", ["right", "right", "down", "down", "left"]],
  ["home", "/", ["right", "right", "down", "right", "up"]],
];
const lab = async () => { const f = await driver.focused().catch(() => null); return f ? JSON.stringify(f.label ?? f) : "-"; };
for (const [name, route, keys] of walks) {
  await driver.route(route); console.log("==", name); console.log("start:", await lab());
  for (const k of keys) { await driver.key(k); console.log("key", k + ":", await lab()); }
}
await driver.stop();
