#!/usr/bin/env node
// Runs the shared parity suite (suite.json) through a per-platform driver (docs/parity/SUITE.md).
//   node suite-run.mjs --driver ./drivers/web.mjs --out <dir> [--themes dark,light] [--only screens,dpad,playback]
//                      [--screens home,movies] [--cases movie-download,cancel] [--reset-progress] [--via keys|route] [--reference | --expected <expected.json>]
// Writes <out>/<theme>/<id>.png, <out>/dpad.json, <out>/playback.json and <out>/downloads.json (and expected.json with --reference).
// A screen is never written unless its end state matches the suite route: a wrong or signed-out screen aborts it.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandKeys, resetProgress, routeMatches, validateSuite } from "./suite-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "suite.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const out = resolve(opt("out", "suite-out"));
const themes = opt("themes", suite.themes.join(",")).split(",");
const only = opt("only", "screens,dpad,playback,downloads").split(",");
const wantScreens = opt("screens", "").split(",").filter(Boolean);
const wantCases = opt("cases", "").split(",").filter(Boolean);
const reset = args.includes("--reset-progress");
const pinned = () => [...suite.playback.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file)];
const via = opt("via", "keys");
const reference = args.includes("--reference");
const expectedFile = resolve(opt("expected", join(out, "..", "web", "expected.json")));
const problems = validateSuite(suite);
if (problems.length) throw new Error(`suite.json invalid: ${problems.join("; ")}`);
if (!opt("driver")) throw new Error("--driver <module> is required");
const driver = await (await import(pathToFileURL(resolve(opt("driver"))).href)).createDriver({ out, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
// Labels differ in wording per platform ("open x", "x movie · 2003", "x"): same item when one holds the other.
const sameItem = (a, b) => { const t = (s) => s.replace(/^open /, ""); return !!a && !!b && (a === b || t(a).includes(t(b)) || t(b).includes(t(a))); };

async function press(keys) {
  for (const { key, long } of expandKeys(keys)) await driver.key(key, { long });
}
// One retry: the first key of a run can land before the app shell has settled.
async function reach(screen, tries = 2) {
  try { return await reachOnce(screen); } catch (e) { if (tries > 1) return reach(screen, tries - 1); throw e; }
}
async function reachOnce(screen) {
  await driver.home();
  // A pinned `open` path is always used (every device shows the same title); otherwise keys, or the route as a fallback.
  if (screen.open) await driver.route(screen.open);
  else if (via === "route" || !screen.keys) {
    if (via === "keys" && !screen.keys) console.log(`  ${screen.id}: no keys in the suite, deep linking`);
    await driver.route(screen.route);
  } else await press(screen.keys);
  await sleep(1500);
  const at = await driver.location();
  if (!routeMatches(screen.match ?? screen.route, at)) throw new Error(`${screen.id}: ended on ${at}, expected ${screen.route}`);
}

const summary = { screens: 0, failed: [] };
if (reset) await resetProgress(pinned()); // before any capture: On deck and Resume start from the same state on every device
await driver.start?.({ theme: themes[0] });
if (only.includes("screens")) {
  for (const theme of themes) {
    await driver.setTheme(theme);
    mkdirSync(join(out, theme), { recursive: true });
    for (const s of suite.screens.filter((x) => !wantScreens.length || wantScreens.includes(x.id))) {
      try { await reach(s); await driver.screenshot(join(out, theme, `${s.id}.png`)); summary.screens += 1; console.log(`ok ${theme} ${s.id}`); }
      catch (e) { summary.failed.push(`${theme}/${s.id}`); console.log(`FAIL ${theme} ${s.id}: ${e.message.split("\n")[0]}`); }
    }
  }
}
const expSrc = reference ? join(out, "expected.json") : expectedFile;
const expected = existsSync(expSrc) ? JSON.parse(readFileSync(expSrc, "utf8")) : {};
expected.dpad ??= {}; expected.playback ??= {};
// A scored run without the web expected file would write expected: null for every result and overwrite a good dpad.json/playback.json.
if (!reference && ((only.includes("dpad") && !Object.keys(expected.dpad).length) || (only.includes("playback") && !Object.keys(expected.playback).length))) {
  throw new Error(`no expected values for dpad/playback in ${expSrc}: pass --expected <web expected.json> (or --reference) before scoring`);
}
const stamp = { suite: suite.version, checked_at: new Date().toISOString() };
if (only.includes("dpad")) {
  await driver.setTheme("dark");
  const results = [];
  for (const d of suite.dpad) {
    let actual = null;
    try {
      const from = suite.screens.find((x) => x.id === d.from);
      await reach(from);
      await press(d.keys);
      await sleep(800);
      actual = norm(await driver.focused());
    } catch (e) { console.log(`ERR dpad ${d.id}: ${e.message.split("\n")[0]}`); }
    if (reference) expected.dpad[d.id] = actual;
    const want = expected.dpad[d.id];
    results.push({ id: d.id, pass: sameItem(actual, want), expected: want ?? null, actual });
    console.log(`${results.at(-1).pass ? "pass" : "FAIL"} dpad ${d.id}: ${actual}${actual === want ? "" : ` (expected ${want})`}`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "dpad.json"), JSON.stringify({ ...stamp, results }, null, 2));
}
if (only.includes("playback")) {
  const results = [];
  for (const p of suite.playback) {
    let r;
    try {
      r = await driver.play(p, p.expect);
    } catch (e) { r = { state: "error", detail: e.message.split("\n")[0] }; }
    // Now-playing entry (Media Session or the platform's own): only judged on drivers that can read it.
    const np = p.nowPlaying && driver.supports?.nowPlaying ? r.nowPlaying?.ok === true : true;
    if (p.nowPlaying && !driver.supports?.nowPlaying) r.nowPlaying = "not supported";
    const pass = np && r.state === p.expect.state && (r.advancedSeconds ?? 0) >= p.expect.advanceSeconds && (r.startSeconds ?? 1e9) <= p.expect.startWithinSeconds;
    if (reference) expected.playback[p.id] = { state: r.state };
    if (reset) await resetProgress([p.file]).catch((e) => console.log(`reset-progress: ${e.message}`));
    results.push({ id: p.id, pass, ...r });
    console.log(`${pass ? "pass" : "FAIL"} playback ${p.id}: ${JSON.stringify(r)}`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "playback.json"), JSON.stringify({ ...stamp, results }, null, 2));
}
if (only.includes("downloads")) {
  // pass: null means skipped (not supported / not built yet): not a failure and not counted.
  const results = [];
  for (const d of suite.downloads.filter((x) => !wantCases.length || wantCases.includes(x.id))) {
    let r;
    const sup = driver.supports ?? {};
    if (!sup.downloads) r = { pass: null, state: "not supported" };
    else if (d.requires && !sup[d.requires]) r = { pass: null, state: d.requires === "grouped-downloads" ? "not built yet" : "not supported" };
    else {
      try { r = await driver.download({ ...d, media: suite.downloadMedia[d.media] }, d.expect); } catch (e) { r = { state: "error", detail: e.message.split("\n")[0] }; }
      r.pass = r.state === d.expect.state;
    }
    if (reset && d.action === "offline-play") await resetProgress([d.media ? suite.downloadMedia[d.media].file : ""]).catch((e) => console.log(`reset-progress: ${e.message}`));
    results.push({ id: d.id, ...r });
    console.log(`${r.pass === null ? "skip" : r.pass ? "pass" : "FAIL"} downloads ${d.id}: ${JSON.stringify(r)}`);
  }
  await driver.cleanupDownloads?.();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "downloads.json"), JSON.stringify({ ...stamp, results }, null, 2));
}
if (reference) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "expected.json"), JSON.stringify({ suite: suite.version, ...expected }, null, 2)); }
await driver.stop?.();
console.log(`captured ${summary.screens}, failed ${summary.failed.length}${summary.failed.length ? `: ${summary.failed.join(", ")}` : ""}`);
process.exit(summary.failed.length ? 1 : 0);
