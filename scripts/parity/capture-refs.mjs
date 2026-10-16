#!/usr/bin/env node
// One command regenerates every web reference screenshot (the pixel reference native clients are scored against).
//   node capture-refs.mjs --parity-root <dir holding the client dirs> [--groups tv,iphone] [--screens home,movies] [--work <dir>] [--no-copy] [--no-reset] [--bak <backup dir name>] [--dry] [--allow-stale-web]
//   --dry prints the plan (groups, viewports, dirs, Downloads hidden or not, live screens) and the web build sha check, then exits without capturing.
//   The web build served at PLAYARR_WEB_URL must contain origin/main's web client (no clients/tv-web change between its sha and origin/main), else the run stops (--allow-stale-web overrides).
// Needs PARITY_CHROME=<chromium path> (or Playwright's own), PARITY_CLIENT, PARITY_LOCK_DIR, and credentials resolved by capture-state.mjs.
// Steps: snapshot account state, reset watch progress of the pinned files, capture each selected supported screen x dark/light once per viewport group
// (fresh sign-in, sessionStorage cleared on every document, fixed fixture clock, deterministic animation policy, readiness checks), verify, then back up
// each client dir's web/ to web.bak-<date>/ and copy the set to <dir>/web/<id>.png, <dir>/web/light/<id>.png with web/build.json.
// Each viewport group writes its own <work>/<group>/captures.json with paths relative to that group; its build fields use webBuild.sha,
// which matches the published web/build.json sha. The driver identity and deployed build are checked before and after capture.
// Run it inside a memory scope: systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- node capture-refs.mjs ...
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandKeys } from "./suite-lib.mjs";
import { assertBuildIdentityStable, selectedLiveScreens, shouldStampReferenceBuild } from "./capture-refs-contract.mjs";
import { withCaptureState } from "./capture-state.mjs";
import { deckFromEnv, seedCanonicalDeck } from "./canonical-deck.mjs";
import { FIXTURE_CLOCK } from "../fixtures/catalog.mjs";
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

// The web build the refs come from: its sha goes into every refs folder's build.json (sha = web build, repoSha = this checkout).
const webUrl = (process.env.PLAYARR_WEB_URL ?? "https://playarr.app").replace(/\/$/, "");
const git = (...a) => execFileSync("git", a, { cwd: here, encoding: "utf8" }).trim();
const repoSha = git("rev-parse", "HEAD");
const webBuild = await (await fetch(`${webUrl}/build-info.json`, { cache: "no-store" })).json().catch(() => ({}));
if (!webBuild.sha || !webBuild.builtAt) throw new Error(`build info at ${webUrl}/build-info.json must include sha and builtAt`);
const mainSha = (() => { try { return git("rev-parse", "origin/main"); } catch { return null; } })();
const staleWeb = mainSha && webBuild.sha !== mainSha ? git("diff", "--name-only", webBuild.sha, mainSha, "--", "clients/tv-web").split("\n").filter(Boolean) : [];
console.log(`web build ${webBuild.sha.slice(0, 9)} (built ${webBuild.builtAt}), origin/main ${mainSha?.slice(0, 9) ?? "unknown"}, ${staleWeb.length ? `STALE: ${staleWeb.length} web files differ` : "web client current"}`);
if (staleWeb.length && !args.includes("--allow-stale-web") && !args.includes("--dry")) throw new Error("the deployed web build lacks origin/main's web client changes (git fetch, wait for the deploy, or --allow-stale-web)");
if (args.includes("--dry")) {
  for (const name of groups) {
    const g = manifest.groups[name];
    if (!g) throw new Error(`unknown group ${name}`);
    console.log(`${name}: ${g.viewport.join("x")}@${g.dpr}${g.mobile ? " phone" : ""}${g.noDownloads ? " NO-DOWNLOADS" : ""} -> ${g.dirs.join(",")}; screens ${wantScreens.filter((x) => manifest.screens.includes(x)).length} x dark/light${g.liveScreens ? `, live ${g.liveScreens.join(",")} (video hidden)` : ""}`);
  }
  process.exit(0);
}

const requestedLiveScreens = selectedLiveScreens(wantScreens, groups, manifest.groups);
if (requestedLiveScreens.length) throw new Error(`unsupported live screen capture: ${requestedLiveScreens.join(", ")}; capture-refs only publishes deterministic web-driver screens`);

if (!process.env.PARITY_CLIENT) throw new Error("PARITY_CLIENT is required for isolated web-reference capture");
if (!process.env.PARITY_LOCK_DIR) throw new Error("PARITY_LOCK_DIR must point to the supplied scratch lock directory");
const fixedNow = process.env.PARITY_FIXED_NOW ?? FIXTURE_CLOCK;
if (!Number.isFinite(Date.parse(fixedNow))) throw new Error("PARITY_FIXED_NOW must be a valid ISO date");
const stateFiles = [...new Set([...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file)])];
await withCaptureState({ client: process.env.PARITY_CLIENT, files: stateFiles }, async (captureState) => {
Object.assign(process.env, captureState.env, { PARITY_STABLE: "1" });
const env = captureState.env;
  const srv = resolveTestServerUrl(env);
const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-refs", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
if (!lr.ok) throw new Error(`login ${lr.status}`);
const login = await lr.json();
if (!login.access_token) throw new Error("reference capture login returned no access token");
const auth = { authorization: `Bearer ${login.access_token}` };
const idOf = (id) => suite.screens.find((s) => s.id === id).open.split("/").pop();
const filmId = idOf("film-detail"), seriesId = idOf("series-detail");
const film = await (await fetch(`${srv}/api/v1/catalog/${filmId}`, { headers: auth })).json();
const series = await (await fetch(`${srv}/api/v1/catalog/${seriesId}`, { headers: auth })).json();
const episodeFiles = (series.children?.Series ?? []).flatMap((s) => s.episodes ?? []).map((e) => e.media_file_id).filter(Boolean);
if (!episodeFiles.length || !film.media_file_id) throw new Error("pinned detail media files are missing from the catalogue");
const pinned = [...stateFiles, film.media_file_id, ...episodeFiles];
const deck = deckFromEnv();
if (deck) await seedCanonicalDeck(captureState, deck);
if (!args.includes("--no-reset")) {
  for (const file of new Set(pinned)) if (file !== deck?.deckFile) await captureState.writeProgress(file, { position_ms: 0, duration_ms: captureState.snapshot.files[file]?.duration_ms ?? 0, completed: false });
  await captureState.clearResumeChoices();
}
const captureSnapshot = await captureState.snapshotNow();
const stateHash = captureSnapshot.hash;

// Capture.
const startedAt = new Date().toISOString();
const driverUrl = pathToFileURL(join(here, "drivers", "web.mjs")).href;
const screens = suite.screens.filter((s) => manifest.screens.includes(s.id) && wantScreens.includes(s.id));
const captureRowsByGroup = new Map();
for (const name of groups) {
  const g = manifest.groups[name];
  if (!g) throw new Error(`unknown group ${name}`);
  Object.assign(process.env, { PLAYARR_WEB_VIEWPORT_WIDTH: String(g.viewport[0]), PLAYARR_WEB_VIEWPORT_HEIGHT: String(g.viewport[1]), PLAYARR_WEB_VIEWPORT_DPR: String(g.dpr) });
  if (g.mobile) process.env.PLAYARR_WEB_MOBILE = "1"; else delete process.env.PLAYARR_WEB_MOBILE;
  if (g.noDownloads) process.env.PLAYARR_WEB_NO_DOWNLOADS = "1"; else delete process.env.PLAYARR_WEB_NO_DOWNLOADS;
  const driver = await (await import(`${driverUrl}?${name}`)).createDriver();
  captureState.registerInterruptCleanup(() => driver.stop());
  const facts = {};
  const captureRows = [];
  try {
    if (!driver.setDeterministicCapture || !driver.waitReady || !driver.captureBuildIdentity) throw new Error("web driver lacks deterministic capture, readiness, or build identity controls");
    await driver.setDeterministicCapture({ fixedNow, disableAnimations: true });
    const driverBuild = await driver.captureBuildIdentity();
    if (driverBuild !== `${webBuild.sha}@${webBuild.builtAt}`) throw new Error(`web driver build identity ${driverBuild} does not match build-info identity ${webBuild.sha}@${webBuild.builtAt}`);
    await driver.start();
    for (const theme of ["dark", "light"]) {
      await driver.setTheme(theme);
      mkdirSync(join(work, name, theme), { recursive: true });
      for (const s of screens) {
        try {
          await driver.home();
          if (s.id === "actions" && g.mobile) { await driver.route("/movies"); await driver.openActions(); }
          else if (s.open) await driver.route(s.open, { requireHeroAction: /^\/(?:movies|series)\/[^/]+\/?$/.test(s.open) });
          else if (!g.mobile && s.keys) for (const { key, long } of expandKeys(s.keys)) await driver.key(key, { long });
          else await driver.route(s.route);
          await driver.waitReady({ screen: s.id, phase: "route" });
          await driver.waitReady({ screen: s.id, phase: "capture" });
          const imagePath = join(work, name, theme, `${s.id}.png`);
          await driver.screenshot(imagePath);
          captureRows.push({ id: s.id, theme, path: `${theme}/${s.id}.png`, sha256: createHash("sha256").update(readFileSync(imagePath)).digest("hex"), build: webBuild.sha, checked_at: new Date().toISOString() });
          facts[`${theme}/${s.id}`] = await driver.inspect();
          console.log(`ok ${name} ${theme} ${s.id}`);
        } catch (e) { console.log(`FAIL ${name} ${theme} ${s.id}: ${e.message.split("\n")[0]}`); throw e; }
      }
    }
    const finalDriverBuild = await driver.captureBuildIdentity();
    assertBuildIdentityStable(driverBuild, finalDriverBuild, `${name} web driver`);
  } finally {
    await driver.stop();
  }
  writeFileSync(join(work, name, "facts.json"), JSON.stringify({ capturedAt: startedAt, facts }, null, 1));
  captureRowsByGroup.set(name, captureRows);
}
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
if (bad) throw new Error(`${bad} reference verification problems; nothing copied`);
const finalBuildResponse = await fetch(`${webUrl}/build-info.json`, { cache: "no-store" });
if (!finalBuildResponse.ok) throw new Error(`final build identity request returned ${finalBuildResponse.status}`);
const finalWebBuild = await finalBuildResponse.json();
assertBuildIdentityStable(`${webBuild.sha}@${webBuild.builtAt}`, `${finalWebBuild.sha}@${finalWebBuild.builtAt}`, "deployed web");
const checkedAt = new Date().toISOString();
for (const name of groups) {
  const captures = captureRowsByGroup.get(name).map((capture) => ({
    ...capture,
    sha256: createHash("sha256").update(readFileSync(join(work, name, capture.path))).digest("hex"),
  }));
  writeFileSync(join(work, name, "captures.json"), JSON.stringify({
    suite: suite.version,
    checked_at: checkedAt,
    provenance: { suite: suite.version, build: webBuild.sha, clock: fixedNow, state: stateHash },
    captures,
  }, null, 2));
}
if (copy) {
  for (const name of groups) {
    const g = manifest.groups[name];
    for (const d of g.dirs) {
      const web = join(root, d, "web"), bak = join(root, d, bakName);
      if (existsSync(web) && !existsSync(bak)) cpSync(web, bak, { recursive: true });
      mkdirSync(join(web, "light"), { recursive: true });
      for (const id of screens.map((screen) => screen.id)) {
        cpSync(join(work, name, "dark", `${id}.png`), join(web, `${id}.png`));
        cpSync(join(work, name, "light", `${id}.png`), join(web, "light", `${id}.png`));
      }
      if (shouldStampReferenceBuild({ partial, liveScreens: g.liveScreens ?? [] })) writeFileSync(join(web, "build.json"), JSON.stringify({ branch: "live web", sha: webBuild.sha, repoSha, webBuiltAt: webBuild.builtAt, pr: null, captured_at: startedAt, viewport: `${g.viewport.join("x")}@${g.dpr}`, group: name, tool: "scripts/parity/capture-refs.mjs" }));
      console.log(`published ${name} -> ${d}/web`);
    }
  }
}
});
