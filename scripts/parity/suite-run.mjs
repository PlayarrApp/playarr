#!/usr/bin/env node
// Runs the shared parity suite (suite.json) through a per-platform driver (docs/parity/SUITE.md).
//   node suite-run.mjs --driver ./drivers/web.mjs --out <dir> [--themes dark,light] [--only screens,dpad,downloads,performance]
//                      [--screens home,movies] [--cases movie-download,cancel] [--checks home-right,player-right] [--player | --skip-player] [--reset-progress] [--via keys|route] [--reference | --expected <expected.json>]
// Writes <out>/<theme>/<id>.png, <out>/captures.json for stable screen runs, <out>/dpad.json, <out>/downloads.json (and <out>/performance.json with --only performance) (and expected.json with --reference).
// A screen is never written unless its end state matches the suite route: a wrong or signed-out screen aborts it.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { assertCanonicalHomeProgress, pinCapture, readinessMode, expandKeys, focusForCheck, pinnedCatalogFiles, resetProgress, routeMatches, routeStateLabel, validateSuite } from "./suite-lib.mjs";
import { dpadAttempts, routeAttempts } from "./run-policy.mjs";
import { FIXTURE_CLOCK } from "../fixtures/catalog.mjs";
import { mergeSelectedResults } from "./selective-results.mjs";
import { resolveCaptureEnvironment, withCaptureState } from "./capture-state.mjs";
import { applyCanonicalDeck } from "./canonical-deck.mjs";
import { readSecrets } from "./dpad-account.mjs";
import { assertCaptureManifestTargetAvailable, buildShaFromIdentity, createCaptureManifest, sameCaptureBuildIdentity } from "./capture-manifest.mjs";

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
const failFast = args.includes("--fail-fast");
const preflightHomeFixture = args.includes("--preflight-home-fixture");
const pinned = () => [...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file)];
// Player checks play a title, which changes On deck on the shared account: they run only in the PLAYBACK-PHASE window (the file named by
// PLAYARR_PLAYBACK_PHASE_FILE exists) or with --player, and never with --skip-player.
const isPlayerCheck = (d) => d.id.startsWith("player-");
const playerAllowed = !args.includes("--skip-player") && (args.includes("--player") || (!!process.env.PLAYARR_PLAYBACK_PHASE_FILE && existsSync(process.env.PLAYARR_PLAYBACK_PHASE_FILE)));
const wantChecks = opt("checks", "").split(",").filter(Boolean);
const checkIds = suite.dpad.map((d) => d.id);
const unknownChecks = wantChecks.filter((id) => !checkIds.includes(id));
if (unknownChecks.length) throw new Error(`unknown --checks id(s): ${unknownChecks.join(", ")}`);
if (new Set(wantChecks).size !== wantChecks.length) throw new Error("--checks contains duplicate ids");
const screenIds = suite.screens.map((s) => s.id);
const unknownScreens = wantScreens.filter((id) => !screenIds.includes(id));
if (unknownScreens.length) throw new Error(`unknown --screens id(s): ${unknownScreens.join(", ")}`);
const knownOnly = new Set(["screens", "dpad", "downloads", "performance"]);
const unknownOnly = only.filter((name) => !knownOnly.has(name));
if (unknownOnly.length) throw new Error(`unknown --only section(s): ${unknownOnly.join(", ")}`);
const via = opt("via", "keys");
const reference = args.includes("--reference");
// Stable is the default so client captures match the web refs (fixed clock, canonical On deck); PARITY_STABLE=0 is the only opt-out.
let deterministic = args.includes("--stable") || process.env.PARITY_STABLE !== "0";
// State pinning (clock, canonical deck, catalogue, animations) applies to every driver; strict readiness and build identity
// only to drivers that declare driver.strictReadiness. Others use their own normal readiness wait.
let strict = false;
if (deterministic) process.env.PARITY_SEED_CANONICAL ??= "1";
if (deterministic && reset) throw new Error("stable capture cannot combine with --reset-progress; seed canonical state before running");
if (preflightHomeFixture && reset) throw new Error("Home fixture preflight cannot run with --reset-progress; verify canonical state without mutation");
const fixedNow = process.env.DEVICE === "ipad"
  ? (process.env.PARITY_CAPTURE_NOW || FIXTURE_CLOCK)
  : (process.env.PARITY_FIXED_NOW ?? FIXTURE_CLOCK);
const regressionReason = process.env.PARITY_REGRESSION_REASON;
const unknownThemes = themes.filter((theme) => !suite.themes.includes(theme));
if (unknownThemes.length) throw new Error(`unknown --themes value(s): ${unknownThemes.join(", ")}`);
// Without --expected: the web run next to this one, else the committed reference (expected.web.json, the pinned Device Test state).
const committedExpected = join(here, "expected.web.json");
const siblingExpected = join(out, "..", "web", "expected.json");
const expectedFile = resolve(opt("expected", existsSync(siblingExpected) || !existsSync(committedExpected) ? siblingExpected : committedExpected));
const problems = validateSuite(suite);
if (problems.length) throw new Error(`suite.json invalid: ${problems.join("; ")}`);
if (!opt("driver")) throw new Error("--driver <module> is required");
const expSrc = reference ? join(out, "expected.json") : expectedFile;
const expected = existsSync(expSrc) ? JSON.parse(readFileSync(expSrc, "utf8")) : {};
const expectedReferenceSha256 = createHash("sha256").update(existsSync(expSrc) ? readFileSync(expSrc) : Buffer.from(JSON.stringify(expected))).digest("hex");
expected.dpad ??= {}; expected.performance ??= {};
if (!reference && playerAllowed && only.includes("dpad") && suite.dpad.some((d) => d.id === "player-ok-toggle" && (!wantChecks.length || wantChecks.includes(d.id)))
  && !["play", "pause"].includes(focusForCheck(expected.dpad["player-ok-toggle"], "player-ok-toggle").label)) {
  throw new Error("player-ok-toggle web reference has no exact Play/Pause state; regenerate it with --reference before scoring");
}
async function runSuite(captureSnapshot, registerInterruptCleanup) {
if (preflightHomeFixture && (!only.includes("screens") || (wantScreens.length > 0 && !wantScreens.includes("home")))) {
  throw new Error("--preflight-home-fixture requires a screen capture that includes Home");
}
const driver = await (await import(pathToFileURL(resolve(opt("driver"))).href)).createDriver({ out, args });
let signalReceived = null;
let stopPromise = null;
let cleanupDownloadsPromise = null;
let downloadSectionStarted = false;
const stopDriver = async () => {
  stopPromise ??= Promise.resolve().then(() => driver.stop?.());
  return stopPromise;
};
const cleanupRunDownloads = async () => {
  if (!downloadSectionStarted || typeof driver.cleanupDownloads !== "function") return;
  cleanupDownloadsPromise ??= Promise.resolve().then(() => driver.cleanupDownloads()).catch((error) => {
    console.log(`download cleanup skipped: ${String(error?.message ?? error).split("\n")[0]}`);
  });
  await cleanupDownloadsPromise;
};
registerInterruptCleanup?.(stopDriver);
const onTermination = (signal) => {
  signalReceived = signal;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  void stopDriver().catch(() => {});
};
const onSigint = () => onTermination("SIGINT");
const onSigterm = () => onTermination("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
const summary = { screens: 0, failed: [], dpadFailed: [] };
let checksFailed = false;
let failureContext = { stage: "runtime" };
const allowedCheckIds = new Set([...suite.screens, ...suite.crops ?? [], ...suite.dpad, ...suite.downloads, ...suite.performance].map((item) => item.id));
function safeFailureCategory(error) {
  const message = String(error?.message ?? "");
  if (/ended on/.test(message)) return "route-mismatch";
  if (/wrong start/.test(message)) return "focus-start-mismatch";
  if (/no focused item/.test(message)) return "focus-unavailable";
  if (/did not (?:settle|acknowledge|reach|start)/.test(message)) return "navigation-timeout";
  return "check-failed";
}
function writeFailureReport(error) {
  const { stage, id, route } = failureContext;
  const safeId = typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) && allowedCheckIds.has(id) ? id : undefined;
  const report = { suite: suite.version, stage: ["screens", "dpad", "downloads", "performance", "runtime"].includes(stage) ? stage : "runtime", ...(safeId ? { id: safeId } : {}), ...(typeof route === "string" && /^(?:home|[a-z][a-z0-9-]*(?:\/:id)*(?:\?view=(?:month|week|agenda))?)$/.test(route) ? { route } : {}), category: safeFailureCategory(error) };
  mkdirSync(out, { recursive: true });
  const tempPath = join(out, "failure.json.tmp");
  writeFileSync(tempPath, JSON.stringify(report, null, 2));
  renameSync(tempPath, join(out, "failure.json"));
}
try {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assertNotInterrupted = () => { if (signalReceived) throw new Error(`suite interrupted by ${signalReceived}`); };
// Labels differ in wording per platform ("open x", "x movie · 2003", "x"): same item when one holds the other.
// focused() answers a label string or { label, position: { rail, index } }. Position is the stable check: Home rails reorder
// when other devices play on the shared account, so a `compare: "position"` check ignores the label (kept as info).
const samePosition = (a, b) => !!a && !!b && String(a.rail) === String(b.rail) && Number(a.index) === Number(b.index);
const sameItem = (a, b) => { const t = (s) => s.replace(/^open /, ""); return !!a && !!b && (a === b || t(a).includes(t(b)) || t(b).includes(t(a))); };

async function press(keys) {
  for (const { key, long } of expandKeys(keys)) { assertNotInterrupted(); await driver.key(key, { long }); assertNotInterrupted(); }
}
async function waitReady(screen, phase) {
  assertNotInterrupted();
  if (!strict) return;
  if (driver.waitReady) { await driver.waitReady({ screen, phase }); assertNotInterrupted(); return; }
  throw new Error(`stable capture unsupported: driver lacks waitReady(${phase})`);
}
async function reach(screen, tries = routeAttempts({ failFast })) {
  try { return await reachOnce(screen); }
  catch (error) { if (tries > 1 && !signalReceived) return reach(screen, tries - 1); throw error; }
}
async function reachOnce(screen) {
  assertNotInterrupted();
  await driver.setCaptureTarget?.(screen.id);
  await driver.home();
  assertNotInterrupted();
  // A pinned `open` path is always used (every device shows the same title); otherwise keys, or the route as a fallback.
  if (screen.open) await driver.route(screen.open, { requireHeroAction: /^\/(?:movies|series)\/[^/]+\/?$/.test(screen.open), screenId: screen.id });
  else if (via === "route" || !screen.keys) {
    if (via === "keys" && !screen.keys) console.log(`  ${screen.id}: no keys in the suite, deep linking`);
    await driver.route(screen.route, { screenId: screen.id });
  } else await press(screen.keys);
  assertNotInterrupted();
  await waitReady(screen.id, "route");
  const at = await driver.location();
  assertNotInterrupted();
  if (!routeMatches(screen.match ?? screen.route, at)) throw new Error(`${screen.id}: ended on ${at}, expected ${screen.route}`);
}

if (preflightHomeFixture) {
  await assertCanonicalHomeProgress(process.env);
  console.log("Home fixture preflight passed before app launch: one canonical part_watched row");
}
if (reset) {
  assertNotInterrupted();
  await resetProgress([...pinned(), ...catalogFiles]);
  assertNotInterrupted();
} // before any capture: On deck and Resume start from the same state on every device
if (deterministic) {
  deterministic = await pinCapture(driver, { fixedNow, explicit: args.includes("--stable") });
  assertNotInterrupted();
}
const readiness = readinessMode(driver, deterministic);
strict = readiness === "strict";
console.log(`capture state pinned=${deterministic} readiness=${readiness}`);
const buildBeforeCapture = strict ? await driver.captureBuildIdentity() : null;
assertNotInterrupted();
await driver.start?.({ theme: themes[0] });
assertNotInterrupted();
await waitReady("home", "route");
const referenceBuildBeforeCapture = reference && !deterministic ? await driver.captureBuildIdentity?.() : null;
if (only.includes("screens")) {
  const selectedScreens = suite.screens.filter((x) => !wantScreens.length || wantScreens.includes(x.id));
  const selectiveCapture = selectedScreens.length !== suite.screens.length || themes.length !== suite.themes.length || themes.some((theme, index) => theme !== suite.themes[index]);
  if (strict) assertCaptureManifestTargetAvailable(selectiveCapture, existsSync(join(out, "captures.json")));
  const captureRows = [];
  for (const theme of themes) {
    assertNotInterrupted();
    await driver.setTheme(theme);
    assertNotInterrupted();
    mkdirSync(join(out, theme), { recursive: true });
    for (const s of selectedScreens) {
      assertNotInterrupted();
      for (let attempt = 1; ; attempt++) {
      failureContext = { stage: "screens", id: s.id, route: routeStateLabel(s.route) };
      driver.takeNetworkFlaps?.();
      try {
        let homeFixtureBefore = null;
        if (preflightHomeFixture && s.id === "home") {
          homeFixtureBefore = await assertCanonicalHomeProgress(process.env);
          console.log("Home fixture preflight passed before navigation: one canonical part_watched row");
        }
        await reach(s);
        await waitReady(s.id, "capture");
        const path = join(out, theme, `${s.id}.png`);
        await driver.screenshot(path);
        assertNotInterrupted();
        if (preflightHomeFixture && s.id === "home") {
          const homeFixtureAfter = await assertCanonicalHomeProgress(process.env);
          if (homeFixtureBefore.signature !== homeFixtureAfter.signature) {
            throw new Error("Home fixture changed during capture; capture refused");
          }
          console.log("Home fixture preflight passed after capture: one canonical part_watched row");
        }
        captureRows.push({ id: s.id, theme, path: `${theme}/${s.id}.png`, bytes: readFileSync(path), capturedAt: new Date().toISOString() });
        summary.screens += 1;
        const flaps = driver.takeNetworkFlaps?.() ?? 0;
        if (flaps && attempt < 3) { // a flap mid-capture can leave images missing: retake
          captureRows.pop(); summary.screens -= 1;
          console.log(`RETAKE ${theme} ${s.id}: ${flaps} request(s) aborted by net::ERR_NETWORK_CHANGED (host interface change), attempt ${attempt}`);
          continue;
        }
        console.log(`ok ${theme} ${s.id}`);
      }
      catch (e) {
        if (signalReceived) throw e;
        const flaps = driver.takeNetworkFlaps?.() ?? 0;
        if (flaps && attempt < 3) { console.log(`RETAKE ${theme} ${s.id}: ${flaps} request(s) aborted by net::ERR_NETWORK_CHANGED (host interface change), attempt ${attempt}`); continue; }
        if (preflightHomeFixture && s.id === "home") {
          writeFileSync(join(out, "home-fixture-invalid.json"), `${JSON.stringify({ valid: false, reason: "Home fixture verification or capture failed" })}\n`);
        }
        summary.failed.push(`${theme}/${s.id}`); checksFailed = true; console.log(`FAIL ${theme} ${s.id}: ${e.message.split("\n")[0]}`); if (failFast) throw e;
      }
      break;
      }
    }
  }
  if (strict && summary.failed.length === 0) {
    if (!captureSnapshot?.hash) throw new Error("stable screen manifest requires an isolated state snapshot");
    const buildAfterScreens = await driver.captureBuildIdentity?.();
    if (!buildBeforeCapture || !sameCaptureBuildIdentity(buildBeforeCapture, buildAfterScreens)) throw new Error("stable screen manifest requires an unchanged verified build identity");
    const captures = createCaptureManifest({ suite: suite.version, buildIdentity: buildAfterScreens, clock: fixedNow, state: captureSnapshot.hash, readiness, captures: captureRows });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "captures.json"), `${JSON.stringify(captures, null, 2)}\n`, { flag: "wx" });
  }
  if (deterministic && !strict && summary.failed.length === 0) { // no verified build identity here, so the readiness mode is logged on its own
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "readiness.json"), `${JSON.stringify({ suite: suite.version, clock: fixedNow, state: captureSnapshot?.hash ?? "unisolated", readiness, captures: captureRows.map(({ id, theme, path }) => ({ id, theme, path })) }, null, 2)}\n`, { flag: "wx" });
  }
  if (reference && referenceBuildBeforeCapture && summary.failed.length === 0) {
    const referenceBuildAfterCapture = await driver.captureBuildIdentity?.();
    if (!sameCaptureBuildIdentity(referenceBuildBeforeCapture, referenceBuildAfterCapture)) throw new Error("deployed build changed during reference capture");
    const match = /^([0-9a-f]{40,64})@(.+)$/i.exec(referenceBuildAfterCapture);
    if (!match || !Number.isFinite(Date.parse(match[2]))) throw new Error("reference capture build identity is invalid");
    writeFileSync(join(out, "reference-build.json"), `${JSON.stringify({ sha: match[1], built_at: match[2] }, null, 2)}\n`, { flag: "wx" });
  }
}
// Extra captures for focus-crop checks (the last row of a long grid, the last item of a short one): not scored, no web ref, and only
// for a driver that asks for them (`endCrops`). Written to <theme>/crops/<id>.png.
// Opt-in: only a screens-without-dpad run takes them (about 22 captures, so with the D-pad checks the step hits its 60 min limit before dpad.json).
if (only.includes("screens") && !only.includes("dpad") && driver.endCrops) {
  for (const theme of themes) {
    assertNotInterrupted();
    await driver.setTheme(theme);
    mkdirSync(join(out, theme, "crops"), { recursive: true });
    for (const c of suite.crops ?? []) {
      assertNotInterrupted();
      try {
        await driver.setLaunchArgs?.(c.launchArgs ?? []); // e.g. Home artwork = Covers
        await reach(suite.screens.find((x) => x.id === c.from));
        await press(c.keys);
        if (strict) await waitReady(c.id, "capture");
        else await sleep(c.settle ?? 1200); // legacy captures can preserve intentional motion sampling
        await driver.screenshot(join(out, theme, "crops", `${c.id}.png`));
        console.log(`ok ${theme} crop ${c.id}`);
      } catch (e) { if (signalReceived) throw e; console.log(`FAIL ${theme} crop ${c.id}: ${e.message.split("\n")[0]}`); } // a crop never fails the run
    }
    await driver.setLaunchArgs?.([]);
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
    failureContext = { stage: "dpad", id: d.id, route: routeStateLabel(suite.screens.find((x) => x.id === d.from)?.route ?? "home") };
    assertNotInterrupted();
    if (isPlayerCheck(d) && !playerAllowed) { // skipped, not failed: no playback outside the window
      results.push({ id: d.id, pass: null, state: "skipped: no PLAYBACK-PHASE" });
      console.log(`skip dpad ${d.id}: no PLAYBACK-PHASE (use --player to force, --skip-player to silence)`);
      continue;
    }
    let actual = null, agreed = false, why = "";
    {
      actual = null; why = "";
      try {
        const from = suite.screens.find((x) => x.id === d.from);
        await reach(from);
        // The player needs a known state before the first key: playing, controls up, focus on play/pause (driver.playerReady), else a fixed wait.
        if (d.wait) {
          if (driver.playerReady) await driver.playerReady(); else if (strict) throw new Error("stable capture unsupported: driver lacks playerReady"); else await sleep(d.wait);
          assertNotInterrupted();
          // Every driver: the playhead must be past 1 s before the first key (a slow player eats keys and shows the wrong state).
          if (driver.playhead) { const t0 = Date.now(); while (Date.now() - t0 < 45000) { assertNotInterrupted(); const head = await driver.playhead(); assertNotInterrupted(); if (head > 1) break; await sleep(500); } if (!((await driver.playhead()) > 1)) throw new Error("player did not start playing within 45 s"); assertNotInterrupted(); }
        }
        if (d.start) {
          const focus = await driver.focused(); assertNotInterrupted();
          const at = focusForCheck(focus, d.id).position;
          const startOk = !at || samePosition(at, d.start); // a driver without position cannot assert the start
          if (!startOk) throw new Error(`wrong start ${at.rail}:${at.index}, expected ${d.start.rail}:${d.start.index}`);
        }
        await press(d.keys);
        await waitReady(d.id, "focus");
        const focused = await driver.focused(); assertNotInterrupted();
        actual = focusForCheck(focused, d.id);
        // observe "state": where the app is (route shape, ids dropped), for Back out of the player: the focus label there varies with timing.
        // observe "panel": whether the audio/subtitle panel is open (driver.panelOpen), else the focused label.
        if (d.observe === "panel" && driver.panelOpen) { const panel = await driver.panelOpen(); assertNotInterrupted(); actual = { ...actual, label: `panel:${panel ? "open" : "closed"}` }; }
        if (d.observe === "state") { const location = await driver.location(); assertNotInterrupted(); actual = { ...actual, label: `${location.split("?")[0].split("/").filter(Boolean).map((s, i) => (i ? ":id" : s)).join("/")}` }; }
      } catch (e) { if (signalReceived) throw e; assertNotInterrupted(); why = e.message.split("\n")[0]; console.log(`ERR dpad ${d.id}: ${why}`); }
      assertNotInterrupted();
      if (!actual?.label) { why ||= "the driver reported no focused item"; }
      else if (!why) agreed = true;
    }
    if (reference && !agreed) unstable.push(d.id);
    if (reference) expected.dpad[d.id] = actual && (d.compare === "position" ? actual : actual.label);
    const w = focusForCheck(expected.dpad[d.id], d.id);
    const byPosition = d.compare === "position" && w.position && actual?.position; // a driver without position falls back to the label
    const pass = !why && (byPosition ? samePosition(actual.position, w.position) : d.id === "player-ok-toggle"
      ? !!actual?.label && actual.label === w.label
      : !!actual?.label && sameItem(actual.label, w.label));
    if (pass === false) { summary.dpadFailed.push(d.id); checksFailed = true; }
    if (!pass && failFast) throw new Error(`${d.id}: ${why || `focus ${actual?.label}, expected ${w.label}`}`);
    results.push({ id: d.id, pass, compared: byPosition ? "position" : "label", expected: expected.dpad[d.id] ?? null, actual: actual && (actual.position ? actual : actual.label),
      ...(pass ? {} : { detail: why || `focus ${actual?.label} @${actual?.position ? `${actual.position.rail}:${actual.position.index}` : "?"}, expected ${w.label}${w.position ? ` @${w.position.rail}:${w.position.index}` : ""}` }) });
    console.log(`${pass ? "pass" : "FAIL"} dpad ${d.id}: ${actual?.label}${actual?.position ? ` @${actual.position.rail}:${actual.position.index}` : ""}${pass ? "" : ` (expected ${w.label}${w.position ? ` @${w.position.rail}:${w.position.index}` : ""})`}`);
  }
  // The reference must never record a null or a wrong-start answer: fail the run and leave the old expected.json alone.
  if (unstable.length) throw new Error(`reference D-pad checks did not produce a valid observation: ${unstable.join(", ")}`);
  mkdirSync(out, { recursive: true });
  const dpadFile = join(out, "dpad.json");
  const selectedIds = suite.dpad.filter((x) => !wantChecks.length || wantChecks.includes(x.id)).map((x) => x.id);
  const buildAfter = strict ? await driver.captureBuildIdentity?.() : null;
  assertNotInterrupted();
  if (strict && !sameCaptureBuildIdentity(buildBeforeCapture, buildAfter)) throw new Error(`deployed build changed during capture: ${JSON.stringify(buildBeforeCapture) ?? "unknown"} to ${JSON.stringify(buildAfter) ?? "unknown"}`);
  const build = buildAfter;
  if (strict && (!build || !captureSnapshot?.hash)) throw new Error("stable capture requires build identity and isolated state snapshot");
  const provenance = {
    suite: suite.version,
    build: build ? buildShaFromIdentity(build) : "unverified-build",
    clock: deterministic ? fixedNow : "unpinned",
    state: captureSnapshot?.hash ?? "unisolated",
    stable: strict,
    pinned: deterministic,
    readiness,
    referenceSha256: expectedReferenceSha256,
  };
  const previous = existsSync(dpadFile) ? JSON.parse(readFileSync(dpadFile, "utf8")) : null;
  const completeSelection = selectedIds.length === checkIds.length;
  if (deterministic && completeSelection && previous?.provenance?.build === provenance.build
      && previous?.provenance?.clock === provenance.clock && previous?.provenance?.state === provenance.state
      && previous?.provenance?.stable === provenance.stable && previous?.provenance?.referenceSha256 === provenance.referenceSha256
      && results.filter((r) => r.pass === true).length < (previous.results ?? []).filter((r) => r.pass === true).length
      && !(typeof regressionReason === "string" && regressionReason.trim())) {
    throw new Error("complete D-pad run regressed against the same provenance; provide PARITY_REGRESSION_REASON to acknowledge the regression");
  }
  const published = completeSelection
    ? { ...stamp, suite: suite.version, provenance, ...(regressionReason?.trim() ? { regressionReason: regressionReason.trim() } : {}), results: results.map((r) => ({ ...r, checked_at: stamp.checked_at })) }
    : deterministic && previous
      ? mergeSelectedResults({ previous, results, selectedIds, allIds: checkIds, stamp, provenance, regressionReason })
      : deterministic
        ? (() => { throw new Error("stable selective D-pad publication requires a complete prior result with matching provenance"); })()
        : { ...stamp, suite: suite.version, provenance, results: results.map((r) => ({ ...r, checked_at: stamp.checked_at })) };
  assertNotInterrupted();
  writeFileSync(dpadFile, JSON.stringify(published, null, 2));
}
if (only.includes("performance")) { // the former playback cases a, b, c: a later performance suite, not parity
  const results = [];
  for (const p of suite.performance) {
    failureContext = { stage: "performance", id: p.id };
    assertNotInterrupted();
    let r;
    try {
      r = await driver.play(p, p.expect);
      assertNotInterrupted();
    } catch (e) { if (signalReceived) throw e; assertNotInterrupted(); r = { state: "error", detail: e.message.split("\n")[0] }; }
    // Now-playing entry (Media Session or the platform's own): only judged on drivers that can read it.
    const np = p.nowPlaying && driver.supports?.nowPlaying ? r.nowPlaying?.ok === true : true;
    if (p.nowPlaying && !driver.supports?.nowPlaying) r.nowPlaying = "not supported";
    const pass = np && r.state === p.expect.state && (r.advancedSeconds ?? 0) >= p.expect.advanceSeconds && (r.startSeconds ?? 1e9) <= p.expect.startWithinSeconds;
    if (!pass && failFast) throw new Error(`${p.id}: performance check failed`);
    if (!pass) checksFailed = true;
    if (reference) expected.performance[p.id] = { state: r.state };
    if (reset) { assertNotInterrupted(); try { await resetProgress([p.file]); } catch (e) { assertNotInterrupted(); console.log(`reset-progress: ${e.message}`); } assertNotInterrupted(); }
    results.push({ id: p.id, pass, ...r });
    console.log(`${pass ? "pass" : "FAIL"} performance ${p.id}: ${JSON.stringify(r)}`);
  }
  assertNotInterrupted();
  mkdirSync(out, { recursive: true });
  assertNotInterrupted();
  writeFileSync(join(out, "performance.json"), JSON.stringify({ ...stamp, results }, null, 2));
}
if (only.includes("downloads")) {
  // pass: null means skipped (not supported / not built yet): not a failure and not counted.
  const results = [];
  for (const d of suite.downloads.filter((x) => !wantCases.length || wantCases.includes(x.id))) {
    failureContext = { stage: "downloads", id: d.id };
    assertNotInterrupted();
    let r;
    const sup = driver.supports ?? {};
    if (!sup.downloads) r = { pass: null, state: "not supported" };
    else if (d.requires && !sup[d.requires]) r = { pass: null, state: d.requires === "grouped-downloads" ? "not built yet" : "not supported" };
    else {
      downloadSectionStarted = true;
      try { r = await driver.download({ ...d, media: suite.downloadMedia[d.media] }, d.expect); assertNotInterrupted(); } catch (e) { if (signalReceived) throw e; assertNotInterrupted(); r = { state: "error", detail: e.message.split("\n")[0] }; }
      r.pass = r.state === d.expect.state;
    }
    assertNotInterrupted();
    if (reset && d.action === "offline-play") { try { await resetProgress([suite.downloadMedia[d.media].file]); } catch (e) { assertNotInterrupted(); console.log(`reset-progress: ${e.message}`); } assertNotInterrupted(); }
    results.push({ id: d.id, ...r });
    if (r.pass === false) { checksFailed = true; if (failFast) throw new Error(`${d.id}: download check failed`); }
    console.log(`${r.pass === null ? "skip" : r.pass ? "pass" : "FAIL"} downloads ${d.id}: ${JSON.stringify(r)}`);
  }
  assertNotInterrupted();
  await cleanupRunDownloads();
  assertNotInterrupted();
  mkdirSync(out, { recursive: true });
  assertNotInterrupted();
  writeFileSync(join(out, "downloads.json"), JSON.stringify({ ...stamp, results }, null, 2));
}
if (reference && !checksFailed) { assertNotInterrupted(); mkdirSync(out, { recursive: true }); assertNotInterrupted(); writeFileSync(join(out, "expected.json"), JSON.stringify({ suite: suite.version, ...expected }, null, 2)); }
console.log(`captured ${summary.screens}, failed ${summary.failed.length}${summary.failed.length ? `: ${summary.failed.join(", ")}` : ""}`);
if (summary.dpadFailed.length) console.log(`failed D-pad checks ${summary.dpadFailed.length}: ${summary.dpadFailed.join(", ")}`);
process.exitCode = summary.failed.length || summary.dpadFailed.length ? 1 : 0;
} catch (error) {
  if (!signalReceived) { if (failFast) writeFailureReport(error); throw error; }
} finally {
  await cleanupRunDownloads();
  try { await stopDriver(); } catch (error) { console.log(`driver stop skipped: ${String(error?.message ?? error).split("\n")[0]}`); }
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  if (signalReceived) process.exitCode = signalReceived === "SIGINT" ? 130 : 143;
}
}

if (deterministic && only.includes("dpad") && !process.env.PARITY_CLIENT) throw new Error("PARITY_CLIENT is required for isolated stable D-pad capture state");
if (deterministic && only.includes("dpad") && !process.env.PARITY_LOCK_DIR) throw new Error("PARITY_LOCK_DIR must point to the supplied scratch lock directory");
const captureEnv = process.env.PARITY_CLIENT ? resolveCaptureEnvironment(process.env.PARITY_CLIENT) : process.env;
const catalogFiles = reset || deterministic ? await pinnedCatalogFiles(suite, captureEnv, { required: deterministic }) : [];
const stateFiles = [...new Set([
  ...pinned(),
  ...Object.values(suite.downloadMedia).map((m) => m.file),
  ...catalogFiles,
])];
if (process.env.PARITY_CLIENT) {
  await withCaptureState({ client: process.env.PARITY_CLIENT, files: stateFiles, env: captureEnv }, async (context) => {
    const { env } = context;
    Object.assign(process.env, env);
    let snapshot = context.snapshot;
    const seeded = await applyCanonicalDeck(context, process.env, readSecrets());
    if (seeded) snapshot = seeded;
    else {
      await context.clearResumeChoices();
      snapshot = await context.snapshotNow();
    }
    await runSuite(snapshot, context.registerInterruptCleanup);
  });
} else {
  if (deterministic) throw new Error("stable capture requires isolated account state via PARITY_CLIENT");
  await runSuite(null);
}
