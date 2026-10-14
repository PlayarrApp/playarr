#!/usr/bin/env node
// One command regenerates every web reference screenshot (the pixel reference native clients are scored against).
//   node capture-refs.mjs --parity-root <dir holding the client dirs> [--groups tv,iphone] [--screens home,movies] [--work <dir>] [--no-copy] [--no-reset] [--bak <backup dir name>]
// Needs PARITY_CHROME=<chromium path> (or Playwright's own), and the Device Test account in the environment:
//   PLAYARR_WEB_URL (default https://playarr.app), PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD (read from ~/.secrets
//   PLAYARR_DEVICE_TEST_* when unset; never printed).
// Steps: reset watch progress of the pinned files, capture every screen of web-refs.json x dark/light once per viewport group
// (fresh sign-in, sessionStorage cleared on every document, fonts and images ready, two identical shots), verify, then back up
// each client dir's web/ to web.bak-<date>/ and copy the set to <dir>/web/<id>.png, <dir>/web/light/<id>.png with web/build.json.
// Run it inside a memory scope: systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- node capture-refs.mjs ...
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandKeys, resetProgress } from "./suite-lib.mjs";
import { PNG } from "pngjs";
import { verifyDir } from "./verify-refs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "web-refs.json"), "utf8"));
const suite = JSON.parse(readFileSync(join(here, "suite.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const root = opt("parity-root") && resolve(opt("parity-root"));
const groups = opt("groups", Object.keys(manifest.groups).join(",")).split(",");
const wantScreens = opt("screens", manifest.screens.join(",")).split(",");
const work = resolve(opt("work", join(process.cwd(), "web-refs-work")));
const bakName = opt("bak", `web.bak-${manifest.date}`); // --bak <name>: partial retake, backs up to that name and leaves build.json alone
const partial = args.includes("--bak");
const copy = !args.includes("--no-copy");
if (copy && !root) throw new Error("--parity-root <dir> is required (or --no-copy)");

// Credentials: environment first, else ~/.secrets (values are never logged).
const secrets = {};
if (existsSync(join(process.env.HOME, ".secrets"))) for (const l of readFileSync(join(process.env.HOME, ".secrets"), "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) secrets[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); }
const env = { ...process.env };
env.PLAYARR_SERVER_URL ??= secrets.PLAYARR_DEVICE_TEST_SERVER_URL;
env.PLAYARR_USERNAME ??= secrets.PLAYARR_DEVICE_TEST_USERNAME;
env.PLAYARR_PASSWORD ??= secrets.PLAYARR_DEVICE_TEST_PASSWORD;
env.PARITY_STABLE = "1";
Object.assign(process.env, { PLAYARR_SERVER_URL: env.PLAYARR_SERVER_URL, PLAYARR_USERNAME: env.PLAYARR_USERNAME, PLAYARR_PASSWORD: env.PLAYARR_PASSWORD, PARITY_STABLE: "1" });
if (!env.PLAYARR_SERVER_URL || !env.PLAYARR_USERNAME || !env.PLAYARR_PASSWORD) throw new Error("Device Test credentials missing (PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD)");

// 1. Reset watch progress: the suite's pinned files plus the pinned film's own file, so On deck and Resume are the same for every set.
const srv = env.PLAYARR_SERVER_URL.replace(/\/$/, "");
const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-refs", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
if (!lr.ok) throw new Error(`login ${lr.status}`);
const token = (await lr.json()).access_token, auth = { authorization: `Bearer ${token}` };
const idOf = (id) => suite.screens.find((s) => s.id === id).open.split("/").pop();
const film = await (await fetch(`${srv}/api/v1/catalog/${idOf("film-detail")}`, { headers: auth })).json().catch(() => ({}));
// The pinned series: every episode's progress is reset and its recorded resume answers are cleared, so series-detail shows no Resume or Ask-again state.
const seriesId = idOf("series-detail");
const series = await (await fetch(`${srv}/api/v1/catalog/${seriesId}`, { headers: auth })).json().catch(() => ({}));
const episodeFiles = (series.children?.Series ?? []).flatMap((s) => s.episodes ?? []).map((e) => e.media_file_id);
if (!episodeFiles.length) throw new Error("pinned series has no episodes in the catalogue response");
const pinned = [...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file), film.media_file_id, ...episodeFiles].filter(Boolean);
if (!args.includes("--no-reset")) { await resetProgress(pinned); await fetch(`${srv}/api/v1/catalog/${seriesId}/resume-plan/choices`, { method: "DELETE", headers: auth }); console.log(`reset progress on ${new Set(pinned).size} pinned files`); }

// 2. Capture.
const startedAt = new Date().toISOString();
const driverUrl = pathToFileURL(join(here, "drivers", "web.mjs")).href;
const screens = suite.screens.filter((s) => manifest.screens.includes(s.id) && wantScreens.includes(s.id));
let failed = 0;
for (const name of groups) {
  const g = manifest.groups[name];
  if (!g) throw new Error(`unknown group ${name}`);
  Object.assign(process.env, { PLAYARR_WEB_VIEWPORT_WIDTH: String(g.viewport[0]), PLAYARR_WEB_VIEWPORT_HEIGHT: String(g.viewport[1]), PLAYARR_WEB_VIEWPORT_DPR: String(g.dpr) });
  if (g.mobile) process.env.PLAYARR_WEB_MOBILE = "1"; else delete process.env.PLAYARR_WEB_MOBILE;
  const driver = await (await import(`${driverUrl}?${name}`)).createDriver();
  await driver.start();
  const facts = {};
  for (const theme of ["dark", "light"]) {
    await driver.setTheme(theme);
    mkdirSync(join(work, name, theme), { recursive: true });
    for (const s of screens) {
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
        try {
          await driver.home();
          if (s.id === "actions" && g.mobile) { await driver.route("/movies"); await driver.openActions(); }
          else if (s.open) await driver.route(s.open, { requireHeroAction: /^\/(?:movies|series)\/[^/]+\/?$/.test(s.open) });
          else if (!g.mobile && s.keys) for (const { key, long } of expandKeys(s.keys)) await driver.key(key, { long });
          else await driver.route(s.route);
          await new Promise((r) => setTimeout(r, 1500));
          await driver.screenshot(join(work, name, theme, `${s.id}.png`));
          facts[`${theme}/${s.id}`] = await driver.inspect();
          ok = true; console.log(`ok ${name} ${theme} ${s.id}`);
        } catch (e) { console.log(`retry ${name} ${theme} ${s.id} (${attempt}): ${e.message.split("\n")[0]}`); }
      }
      if (!ok) { failed += 1; console.log(`FAIL ${name} ${theme} ${s.id}`); }
    }
  }
  await driver.stop();
  writeFileSync(join(work, name, "facts.json"), JSON.stringify({ capturedAt: startedAt, facts }, null, 1));
}
if (failed) { console.log(`${failed} screens failed to capture: nothing copied`); process.exit(1); }

// Crop fractional-scale rounding (a group's "crop": [w, h]) off the bottom and right edge.
for (const name of groups) {
  const crop = manifest.groups[name].crop;
  if (!crop) continue;
  for (const theme of ["dark", "light"]) for (const s of screens) {
    const f = join(work, name, theme, `${s.id}.png`), p = PNG.sync.read(readFileSync(f));
    if (p.width === crop[0] && p.height === crop[1]) continue;
    if (p.width < crop[0] || p.height < crop[1] || p.width - crop[0] > 2 || p.height - crop[1] > 2) throw new Error(`${name}/${theme}/${s.id}: ${p.width}x${p.height} cannot be cropped to ${crop.join("x")}`);
    const o = new PNG({ width: crop[0], height: crop[1] });
    PNG.bitblt(p, o, 0, 0, crop[0], crop[1], 0, 0);
    writeFileSync(f, PNG.sync.write(o));
  }
}

// 3. Verify the capture, then back up and publish.
let bad = 0;
for (const name of groups) {
  const problems = verifyDir(join(work, name), manifest.groups[name], manifest, wantScreens);
  for (const p of problems) console.log(`BAD ${name}: ${p}`);
  bad += problems.length;
}
if (bad) { console.log(`${bad} problems: nothing copied`); process.exit(1); }
if (copy) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: here, encoding: "utf8" }).trim();
  for (const name of groups) {
    const g = manifest.groups[name];
    for (const d of g.dirs) {
      const web = join(root, d, "web"), bak = join(root, d, bakName);
      if (existsSync(web) && !existsSync(bak)) cpSync(web, bak, { recursive: true });
      mkdirSync(join(web, "light"), { recursive: true });
      for (const id of wantScreens) {
        cpSync(join(work, name, "dark", `${id}.png`), join(web, `${id}.png`));
        cpSync(join(work, name, "light", `${id}.png`), join(web, "light", `${id}.png`));
      }
      if (!partial) writeFileSync(join(web, "build.json"), JSON.stringify({ branch: "live web", sha, pr: null, captured_at: startedAt, viewport: `${g.viewport.join("x")}@${g.dpr}`, group: name, tool: "scripts/parity/capture-refs.mjs" }));
      console.log(`published ${name} -> ${d}/web`);
    }
  }
}
