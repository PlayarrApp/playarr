#!/usr/bin/env node
// Runs the shared parity suite (suite.json) through a per-platform driver (docs/parity/SUITE.md).
//   node suite-run.mjs --driver ./drivers/web.mjs --out <dir> [--themes dark,light] [--only screens,dpad,downloads,performance]
//                      [--screens home,movies] [--cases movie-download,cancel] [--checks home-right,player-right] [--player | --skip-player] [--reset-progress] [--via keys|route] [--reference | --expected <expected.json>]
// Writes <out>/<theme>/<id>.png, <out>/dpad.json, <out>/downloads.json (and <out>/performance.json with --only performance) (and expected.json with --reference).
// A screen is never written unless its end state matches the suite route: a wrong or signed-out screen aborts it.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandKeys, focusForCheck, resetProgress, routeMatches, validateSuite } from "./suite-lib.mjs";
import { validateReadOnlyCaptureArgs } from "./readonly-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "suite.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const out = resolve(opt("out", "suite-out"));
const themes = opt("themes", suite.themes.join(",")).split(",");
const only = opt("only", "screens,dpad,downloads").split(",");
const wantScreens = opt("screens", "").split(",").filter(Boolean);
const wantCases = opt("cases", "").split(",").filter(Boolean);
const reset = args.includes("--reset-progress");
const pinned = () => [...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file)];
// Player checks play a title, which changes On deck on the shared account: they run only in the PLAYBACK-PHASE window (the file named by
// PLAYARR_PLAYBACK_PHASE_FILE exists) or with --player, and never with --skip-player.
const isPlayerCheck = (d) => d.id.startsWith("player-");
const playerAllowed = !args.includes("--skip-player") && (args.includes("--player") || (!!process.env.PLAYARR_PLAYBACK_PHASE_FILE && existsSync(process.env.PLAYARR_PLAYBACK_PHASE_FILE)));
const wantChecks = opt("checks", "").split(",").filter(Boolean);
const via = opt("via", "keys");
const reference = args.includes("--reference");
// Without --expected: the web run next to this one, else the committed reference (expected.web.json, the pinned Device Test state).
const committedExpected = join(here, "expected.web.json");
const siblingExpected = join(out, "..", "web", "expected.json");
const expectedFile = resolve(opt("expected", existsSync(siblingExpected) || !existsSync(committedExpected) ? siblingExpected : committedExpected));
const problems = validateSuite(suite);
if (problems.length) throw new Error(`suite.json invalid: ${problems.join("; ")}`);
validateReadOnlyCaptureArgs(args, suite);
if (!opt("driver")) throw new Error("--driver <module> is required");
const expSrc = reference ? join(out, "expected.json") : expectedFile;
const expected = existsSync(expSrc) ? JSON.parse(readFileSync(expSrc, "utf8")) : {};
expected.dpad ??= {}; expected.performance ??= {};
if (!reference && playerAllowed && only.includes("dpad") && suite.dpad.some((d) => d.id === "player-ok-toggle" && (!wantChecks.length || wantChecks.includes(d.id)))
  && !["play", "pause"].includes(focusForCheck(expected.dpad["player-ok-toggle"], "player-ok-toggle").label)) {
  throw new Error("player-ok-toggle web reference has no exact Play/Pause state; regenerate it with --reference before scoring");
}
const driver = await (await import(pathToFileURL(resolve(opt("driver"))).href)).createDriver({ out, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Labels differ in wording per platform ("open x", "x movie · 2003", "x"): same item when one holds the other.
// focused() answers a label string or { label, position: { rail, index } }. Position is the stable check: Home rails reorder
// when other devices play on the shared account, so a `compare: "position"` check ignores the label (kept as info).
const samePosition = (a, b) => !!a && !!b && String(a.rail) === String(b.rail) && Number(a.index) === Number(b.index);
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
  if (screen.open) await driver.route(screen.open, { requireHeroAction: /^\/(?:movies|series)\/[^/]+\/?$/.test(screen.open) });
  else if (via === "route" || !screen.keys) {
    if (via === "keys" && !screen.keys) console.log(`  ${screen.id}: no keys in the suite, deep linking`);
    await driver.route(screen.route);
  } else await press(screen.keys);
  await sleep(1500);
  const at = await driver.location();
  if (!routeMatches(screen.match ?? screen.route, at)) throw new Error(`${screen.id}: ended on ${at}, expected ${screen.route}`);
}

const summary = { screens: 0, failed: [], dpadFailed: [] };
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
// A scored run without the web expected file would write expected: null for every result and overwrite a good dpad.json/performance.json.
if (!reference && ((only.includes("dpad") && !Object.keys(expected.dpad).length) || (only.includes("performance") && !Object.keys(expected.performance).length))) {
  throw new Error(`no expected values for dpad/performance in ${expSrc}: pass --expected <web expected.json> (or --reference) before scoring`);
}
const stamp = { suite: suite.version, checked_at: new Date().toISOString() };
if (only.includes("dpad")) {
  await driver.setTheme("dark");
  const results = [];
  const unstable = [];
  for (const d of suite.dpad.filter((x) => !wantChecks.length || wantChecks.includes(x.id))) {
    if (isPlayerCheck(d) && !playerAllowed) { // skipped, not failed: no playback outside the window
      results.push({ id: d.id, pass: null, state: "skipped: no PLAYBACK-PHASE" });
      console.log(`skip dpad ${d.id}: no PLAYBACK-PHASE (use --player to force, --skip-player to silence)`);
      continue;
    }
    let actual = null, startOk = true, lastKey = null, agreed = false;
    // A check starts from a known focus position (`start`): a wrong start or a lost first key gives a wrong answer, so retry up to 3 times.
    for (let attempt = 1; attempt <= (reference ? 5 : 3); attempt += 1) {
      actual = null; startOk = true;
      try {
        const from = suite.screens.find((x) => x.id === d.from);
        await reach(from);
        // The player needs a known state before the first key: playing, controls up, focus on play/pause (driver.playerReady), else a fixed wait.
        if (d.wait) { if (driver.playerReady) await driver.playerReady(); else await sleep(d.wait); }
        if (d.start) {
          const at = focusForCheck(await driver.focused(), d.id).position;
          startOk = !at || samePosition(at, d.start); // a driver without position cannot assert the start
          if (!startOk) { console.log(`  dpad ${d.id}: start ${at.rail}:${at.index}, expected ${d.start.rail}:${d.start.index} (attempt ${attempt})`); continue; }
        }
        await press(d.keys);
        await sleep(800);
        actual = focusForCheck(await driver.focused(), d.id);
        // observe "state": where the app is (route shape, ids dropped), for Back out of the player: the focus label there varies with timing.
        if (d.observe === "state") actual = { ...actual, label: `${(await driver.location()).split("?")[0].split("/").filter(Boolean).map((s, i) => (i ? ":id" : s)).join("/")}` };
      } catch (e) { console.log(`ERR dpad ${d.id}: ${e.message.split("\n")[0]}`); }
      if (!actual?.label) continue;
      // The reference needs two identical answers in a row: Home rails re-sort while other devices play, which moves a card
      // between positions mid-check. A device run needs one answer.
      if (!reference) { agreed = true; break; }
      const key = JSON.stringify(d.compare === "position" ? actual.position ?? actual.label : actual.label);
      if (key === lastKey) { agreed = true; break; }
      lastKey = key;
    }
    if (reference && !agreed) unstable.push(d.id);
    if (reference) expected.dpad[d.id] = actual && (d.compare === "position" ? actual : actual.label);
    const w = focusForCheck(expected.dpad[d.id], d.id);
    const byPosition = d.compare === "position" && w.position && actual?.position; // a driver without position falls back to the label
    const pass = byPosition ? samePosition(actual.position, w.position) : d.id === "player-ok-toggle"
      ? !!actual?.label && actual.label === w.label
      : !!actual?.label && sameItem(actual.label, w.label);
    if (pass === false) summary.dpadFailed.push(d.id);
    results.push({ id: d.id, pass, compared: byPosition ? "position" : "label", expected: expected.dpad[d.id] ?? null, actual: actual && (actual.position ? actual : actual.label) });
    console.log(`${pass ? "pass" : "FAIL"} dpad ${d.id}: ${actual?.label}${actual?.position ? ` @${actual.position.rail}:${actual.position.index}` : ""}${pass ? "" : ` (expected ${w.label}${w.position ? ` @${w.position.rail}:${w.position.index}` : ""})`}`);
  }
  // The reference must never record a null or a wrong-start answer: fail the run and leave the old expected.json alone.
  if (unstable.length) throw new Error(`reference D-pad checks not stable after 3 attempts: ${unstable.join(", ")}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "dpad.json"), JSON.stringify({ ...stamp, results }, null, 2));
}
if (only.includes("performance")) { // the former playback cases a, b, c: a later performance suite, not parity
  const results = [];
  for (const p of suite.performance) {
    let r;
    try {
      r = await driver.play(p, p.expect);
    } catch (e) { r = { state: "error", detail: e.message.split("\n")[0] }; }
    // Now-playing entry (Media Session or the platform's own): only judged on drivers that can read it.
    const np = p.nowPlaying && driver.supports?.nowPlaying ? r.nowPlaying?.ok === true : true;
    if (p.nowPlaying && !driver.supports?.nowPlaying) r.nowPlaying = "not supported";
    const pass = np && r.state === p.expect.state && (r.advancedSeconds ?? 0) >= p.expect.advanceSeconds && (r.startSeconds ?? 1e9) <= p.expect.startWithinSeconds;
    if (reference) expected.performance[p.id] = { state: r.state };
    if (reset) await resetProgress([p.file]).catch((e) => console.log(`reset-progress: ${e.message}`));
    results.push({ id: p.id, pass, ...r });
    console.log(`${pass ? "pass" : "FAIL"} performance ${p.id}: ${JSON.stringify(r)}`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "performance.json"), JSON.stringify({ ...stamp, results }, null, 2));
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
if (summary.dpadFailed.length) console.log(`failed D-pad checks ${summary.dpadFailed.length}: ${summary.dpadFailed.join(", ")}`);
process.exit(summary.failed.length || summary.dpadFailed.length ? 1 : 0);
