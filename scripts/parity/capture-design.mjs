#!/usr/bin/env node
// Design-report capture of the web client: every screen of design-screens.json, dark and light, on web-tv / web-tablet / web-phone.
//   node capture-design.mjs --out <captures dir> [--devices web-tv,web-tablet,web-phone] [--screens login,downloads] [--themes dark,light] [--work <dir>] [--merge]
// Writes <out>/<device>/<theme>/<id>.png and <out>/<device>/manifest.json (class "reference": the web client is the reference itself).
// --screens limits the run to those ids (or SCREENS-ALL state aliases); with --merge the manifest keeps the entries of the screens not retaken,
// so a later lane can add one new screen without recapturing the rest.
// Same environment as capture-refs.mjs: eval "$(node parity-config.mjs --shell)" (static parity server), PARITY_CHROME, PARITY_CLIENT=refs, PARITY_LOCK_DIR.
// Run it inside a memory scope: systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- node capture-design.mjs ...
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { CAPTURE_REGION, expandKeys } from "./suite-lib.mjs";
import { withCaptureState } from "./capture-state.mjs";
import { deckFromEnv, seedCanonicalDeck } from "./canonical-deck.mjs";
import { readSecrets } from "./dpad-account.mjs";
import { FIXTURE_CLOCK } from "../fixtures/catalog.mjs";
import { loadDesignScreens, validateDesignScreens } from "./suite-design.mjs";
import { installServerApiBaseUrl, installVisualDate } from "./drivers/web.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = dirname(fileURLToPath(import.meta.url));
const spec = loadDesignScreens();
const suite = JSON.parse(readFileSync(join(here, "suite.json"), "utf8"));
const bad = validateDesignScreens(spec, suite);
if (bad.length) throw new Error(`design-screens.json: ${bad.join("; ")}`);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const out = resolve(opt("out", ""));
if (!opt("out")) throw new Error("--out <captures dir> is required");
const devices = opt("devices", Object.keys(spec.devices).join(",")).split(",");
const themes = opt("themes", spec.themes.join(",")).split(",");
const wanted = opt("screens", "").split(",").filter(Boolean).map((id) => spec.aliases?.[id] ? spec.aliases[id] : id);
const screens = spec.screens.filter((s) => !wanted.length || wanted.includes(s.id));
if (wanted.length && screens.length !== new Set(wanted).size) throw new Error(`unknown screen in ${wanted.join(",")}`);
const merge = args.includes("--merge");
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const TV_UA = "Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PlayarrAndroidTV/1.0";

if (!process.env.PARITY_CLIENT) throw new Error("PARITY_CLIENT is required (as for capture-refs.mjs)");
if (!process.env.PARITY_LOCK_DIR) throw new Error("PARITY_LOCK_DIR must point to a scratch lock directory");
const screensClock = JSON.parse(readFileSync(join(here, "screens.json"), "utf8")).determinism?.clock;
if (screensClock !== FIXTURE_CLOCK) throw new Error(`screens.json determinism.clock ${screensClock} differs from FIXTURE_CLOCK ${FIXTURE_CLOCK}`);
const git = (...a) => execFileSync("git", a, { cwd: here, encoding: "utf8" }).trim();
const repoSha = git("rev-parse", "HEAD");
const webUrl = (process.env.PLAYARR_WEB_URL ?? "").replace(/\/$/, "");
if (!webUrl) throw new Error("PLAYARR_WEB_URL is required (eval the parity-config shell output)");
const webBuild = await (await fetch(`${webUrl}/build-info.json`, { cache: "no-store" })).json();

const deckScope = deckFromEnv({ ...process.env, PARITY_SEED_CANONICAL: "1" }, readSecrets()).deckFile;
const stateFiles = [...new Set([...suite.performance.map((p) => p.file), ...Object.values(suite.downloadMedia).map((m) => m.file), deckScope])];

await withCaptureState({ client: process.env.PARITY_CLIENT, files: stateFiles }, async (captureState) => {
  Object.assign(process.env, captureState.env, { PARITY_STABLE: "1" });
  const env = captureState.env;
  const srv = env.PLAYARR_SERVER_URL.replace(/\/$/, "");
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
  if (!lr.ok) throw new Error(`login ${lr.status}`);
  const auth = { authorization: `Bearer ${(await lr.json()).access_token}` };
  const open = (id) => suite.screens.find((s) => s.id === id).open;
  const film = await (await fetch(`${srv}/api/v1/catalog/${open("film-detail").split("/").pop()}`, { headers: auth })).json();
  if (!film.media_file_id) throw new Error("pinned film has no media file");
  const deck = deckFromEnv({ ...process.env, PARITY_SEED_CANONICAL: "1" }, readSecrets());
  await seedCanonicalDeck(captureState, deck);
  for (const file of new Set([...stateFiles, film.media_file_id])) if (file !== deck?.deckFile) await captureState.writeProgress(file, { position_ms: 0, duration_ms: captureState.snapshot.files[file]?.duration_ms ?? 0, completed: false });
  await captureState.clearResumeChoices();

  // Fixture the frozen seed lacks: one playlist of pinned titles, so playlists and playlist-detail show items. Created through the API on the
  // throw-away working copy of the DB (static-server.sh deletes it on exit); nothing persists. Skipped when a playlist already exists.
  const existing = await (await fetch(`${srv}/api/v1/playlists`, { headers: auth })).json();
  if (!(Array.isArray(existing) ? existing : existing.items ?? existing.playlists ?? []).length) {
    const created = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
    if (!created.ok) throw new Error(`create playlist ${created.status}`);
    const playlist = await created.json();
    for (const workId of [open("film-detail"), open("series-detail")].map((r) => r.split("/").pop()).concat(["4ec39b80-28c3-4d83-9f83-f07872e5f4c0"])) {
      const added = await fetch(`${srv}/api/v1/playlists/${playlist.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: workId }) });
      if (!added.ok) throw new Error(`add playlist item ${added.status}`);
    }
  }

  const driverUrl = pathToFileURL(join(here, "drivers", "web.mjs")).href;
  const startedAt = new Date().toISOString();
  for (const name of devices) {
    const g = spec.devices[name];
    if (!g) throw new Error(`unknown device ${name}`);
    Object.assign(process.env, { PLAYARR_WEB_VIEWPORT_WIDTH: String(g.viewport[0]), PLAYARR_WEB_VIEWPORT_HEIGHT: String(g.viewport[1]), PLAYARR_WEB_VIEWPORT_DPR: String(g.dpr) });
    if (g.mobile) process.env.PLAYARR_WEB_MOBILE = "1"; else delete process.env.PLAYARR_WEB_MOBILE;
    const driver = await (await import(`${driverUrl}?${name}`)).createDriver();
    captureState.registerInterruptCleanup(() => driver.stop());
    await driver.setDeterministicCapture({ fixedNow: FIXTURE_CLOCK, disableAnimations: true, ...CAPTURE_REGION });
    const driverBuild = await driver.captureBuildIdentity();
    if (driverBuild !== `${webBuild.sha}@${webBuild.builtAt}`) throw new Error(`driver build ${driverBuild} differs from build-info`);
    const manifestFile = join(out, name, "manifest.json");
    const manifest = merge && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { screens: {} };
    Object.assign(manifest, { device: name, class: "reference", build: repoSha, webBuild: webBuild.sha, capturedAt: startedAt, viewport: `${g.viewport.join("x")}@${g.dpr}`, clock: FIXTURE_CLOCK, server: "static parity server (seeded frozen DB)" });
    for (const s of screens) manifest.screens[s.id] = s.absent ? { dark: null, light: null, absent: s.absent } : (manifest.screens[s.id] && merge ? manifest.screens[s.id] : {});
    const failures = [];
    await driver.start();
    let browser;
    try {
      for (const theme of themes) {
        await driver.setTheme(theme);
        mkdirSync(join(out, name, theme), { recursive: true });
        for (const s of screens) {
          if (s.absent) continue;
          if (s.keysOnly && !g.keys) { manifest.screens[s.id] = { dark: null, light: null, absent: `${s.reason} on ${name}: the touch layout shows no focused rail, the screen equals home` }; continue; }
          const file = join(out, name, theme, `${s.id}.png`);
          try {
            for (let attempt = 1; ; attempt++) {
              if (s.kind === "signedOut") { browser ??= await chromium.launch(process.env.PARITY_CHROME ? { executablePath: process.env.PARITY_CHROME } : {}); await signedOutShot(browser, driver.signedOutOptions(), theme, s, file); break; }
              await driver.home();
              await shotSignedIn(driver, g, s, film, file);
              const f = await driver.inspect();
              const settled = !f.skeletons && !f.brokenSrc?.length && (s.endsOnSignIn || !f.signedOut);
              if (!settled && attempt < 3) { console.log(`retake ${name} ${theme} ${s.id} (attempt ${attempt}: skeletons ${f.skeletons}, broken ${f.brokenSrc?.length}, signedOut ${f.signedOut})`); continue; }
              if (!settled) throw new Error(`not settled: skeletons ${f.skeletons}, broken ${JSON.stringify(f.brokenSrc)}, signedOut ${f.signedOut}`);
              break;
            }
            manifest.screens[s.id] = { ...manifest.screens[s.id], [theme]: `${theme}/${s.id}.png` };
            console.log(`ok ${name} ${theme} ${s.id}`);
          } catch (e) {
            const msg = e.message.split("\n")[0];
            console.log(`FAIL ${name} ${theme} ${s.id}: ${msg}`);
            failures.push(`${theme}/${s.id}: ${msg}`);
            manifest.screens[s.id] = { ...manifest.screens[s.id], [theme]: null, error: msg };
          }
        }
      }
    } finally {
      await browser?.close();
      await driver.stop();
    }
    for (const s of Object.values(manifest.screens)) if (s.dark && s.light && s.error) delete s.error;
    mkdirSync(join(out, name), { recursive: true });
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`manifest ${name}: ${Object.values(manifest.screens).filter((s) => s.dark && s.light).length} screens both themes, ${failures.length} failures`);
  }
});

/** Steps of a screen after the route is open (type, click, waitGone, wait). */
async function runSteps(driver, steps = []) {
  for (const st of steps) {
    await driver.withPage(async (page) => {
      if (st.type === "type") { const input = page.locator(st.selector).first(); await input.waitFor({ timeout: 15000 }); await input.fill(st.value); await page.waitForTimeout(1500); }
      else if (st.type === "click") { const el = st.selector ? page.locator(st.selector).first() : page.getByText(st.text).first(); await el.waitFor({ timeout: 15000 }); await el.click(); await page.waitForTimeout(800); }
      else if (st.type === "waitGone") await page.waitForFunction((t) => !document.body.innerText.includes(t), st.text, { timeout: 20000 });
      else if (st.type === "wait") await page.waitForTimeout(st.ms);
      else throw new Error(`unknown step ${st.type}`);
    });
  }
}

async function shotSignedIn(driver, g, s, film, file) {
  driver.allowApiErrors(s.allowApi ?? []);
  if (s.kind === "player") {
    await driver.playerControls(film.media_file_id);
    if (!s.controls) {
      // Controls hidden: BACK closes the control overlay first (resolvePlayerBack in lib/playerMounting.ts), and a paused player keeps the frame.
      await driver.withPage(async (page) => {
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => { const c = document.querySelector(".player-controls"); return !c || c.classList.contains("is-hidden"); }, null, { timeout: 10000, polling: 250 });
        await page.mouse.move(-1, -1);
        await page.waitForTimeout(800);
        const held = await page.evaluate(() => { const v = document.querySelector("video"), c = document.querySelector(".player-controls"); return { paused: v.paused, t: v.currentTime, hidden: !c || c.classList.contains("is-hidden"), path: location.pathname }; });
        if (!held.paused || Math.abs(held.t - 2) > 0.05 || !held.hidden || !held.path.includes("/player/")) throw new Error(`player not paused at 2 s with controls hidden: ${JSON.stringify(held)}`);
      });
    }
    await driver.plainShot(file);
    return;
  }
  if (s.id === "actions" && !g.keys) { await driver.route("/movies"); await driver.openActions(); }
  else if (s.id === "actions" || s.id === "filters") {
    if (g.keys) for (const { key, long } of expandKeys(suite.screens.find((x) => x.id === s.id).keys)) { await driver.key(key, { long }); await sleep(250); }
    else await driver.route(s.route);
  } else if (s.keysOnly) for (const key of s.keys) { await driver.key(key); await sleep(250); }
  else {
    const route = s.open === "suite" ? suite.screens.find((x) => x.id === s.id).open : s.resolve ? await resolveRoute(driver, s) : s.route;
    // A bare keys path on key layouts reaches the same page as the route for the library, calendar and settings screens; the route is exact and shorter.
    await driver.route(route, { requireHeroAction: /^\/(?:movies|series)\/[^/]+\/?$/.test(route) });
  }
  if (s.id === "home" && g.noFocusRing) await driver.blurFocus();
  await runSteps(driver, s.steps);
  await sleep(600);
  await driver.plainShot(file);
}

async function resolveRoute(driver, s) {
  await driver.route(s.resolve.list);
  const href = await driver.withPage((page) => page.evaluate((prefix) => {
    const local = (x) => { const u = new URL(x.href); return (u.pathname + u.search).replace(/^\/tv/, ""); };
    const a = [...document.querySelectorAll("a[href]")].find((x) => local(x).startsWith(prefix) && local(x) !== prefix);
    return a ? local(a) : null;
  }, s.resolve.prefix));
  if (!href) throw new Error(`no link under ${s.resolve.prefix} on ${s.resolve.list} (the fixture has none)`);
  return href;
}

/** Signed-out screens: a fresh context with no session, the same viewport, user agent, theme, locale, zone, clock and motion policy as the signed-in driver. */
async function signedOutShot(browser, o, theme, s, file) {
  const ctx = await browser.newContext({ viewport: o.viewport, deviceScaleFactor: o.deviceScaleFactor, userAgent: o.mobile ? MOBILE_UA : TV_UA, colorScheme: theme, locale: o.locale, timezoneId: o.timezoneId, ...(o.mobile ? { isMobile: true, hasTouch: true } : {}) });
  try {
    await ctx.addInitScript((t) => localStorage.setItem("playarr-theme", t), theme);
    await ctx.addInitScript(installVisualDate, FIXTURE_CLOCK);
    await ctx.addInitScript(() => {
      const css = "*,*::before,*::after{animation:none!important;scroll-behavior:auto!important;transition:none!important;caret-color:transparent!important}";
      const install = () => { if (!document.head || document.getElementById("parity-motion-off")) return; const style = document.createElement("style"); style.id = "parity-motion-off"; style.textContent = css; document.head.append(style); };
      install(); new MutationObserver(install).observe(document, { childList: true, subtree: true });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...a) { const x = animate.apply(this, a); try { x.finish(); } catch { x.cancel(); } return x; };
    });
    await installServerApiBaseUrl(ctx, o.trustedServerUrl);
    const page = await ctx.newPage();
    await page.goto(o.web + s.route, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("main, form, .login-page, #root > *") !== null, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().width > 0).every((i) => i.complete), null, { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector(".skeleton, [class*=skeleton-], .tv-mini-loader, [class*=spinner], [aria-busy=true]"), null, { timeout: 20000 });
    if (new URL(page.url()).pathname.replace(/^\/tv/, "") !== s.route) throw new Error(`redirected to ${new URL(page.url()).pathname}`);
    await runStepsPlain(page, s.steps);
    await page.mouse.move(-1, -1);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(600);
    writeFileSync(file, await page.screenshot({ animations: "disabled" }));
  } finally { await ctx.close(); }
}

async function runStepsPlain(page, steps = []) {
  for (const st of steps) {
    if (st.type === "click") await (st.selector ? page.locator(st.selector).first() : page.getByText(st.text).first()).click();
    else if (st.type === "type") await page.locator(st.selector).first().fill(st.value);
    else if (st.type === "wait") await page.waitForTimeout(st.ms);
  }
}
