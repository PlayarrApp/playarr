#!/usr/bin/env node
// Installed apps never show the marketing site (owner rule, 2026-10-18).
//   node scripts/no-marketing-e2e.mjs [--dist dir] [--no-build]
// Fixtures only. The real worker.js routes every request; its SITE binding is a stub that renders a marketing marker
// and its ASSETS binding proxies to the nav-perf mock (dist + mock API), so the routing decision is the production one.
//  1. "/?platform=<any>" signed out and signed in: the app renders, the marketing stub is never fetched.
//  2. App user agents (VIDAA, Xbox, Playarr Android) at a bare "/": the app renders.
//  3. After one app visit the app cookie keeps a bare "/" on the app, signed out.
//  4. Sign-out (non-TV and TV installed apps) then a cold bare "/": the app, never marketing.
//  5. Control: a plain browser signed out at "/" does get the marketing stub (so the checks above can fail).
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import worker from "../worker.js";
import { startServer } from "./nav-perf/server.mjs";
import { chromiumExecutable } from "./chromium-launch.mjs";
import { root, opt, USER_ID } from "./e2e-common.mjs";

if (!process.argv.includes("--no-build") && !opt("dist", "")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const mock = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 6, series: 2, artists: 0 });
const mockBase = `http://127.0.0.1:${mock.port}`;

let siteHits = 0;
const env = {
  SITE: {
    fetch: async () => {
      siteHits += 1;
      return new Response("<!doctype html><title>Playarr marketing</title><main data-marketing-site>Marketing</main>", {
        headers: { "Content-Type": "text/html" },
      });
    },
  },
  ASSETS: {
    fetch: async (request) => {
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete("host");
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
      return fetch(`${mockBase}${url.pathname}${url.search}`, { method: request.method, headers, body, redirect: "manual" });
    },
  },
};
const front = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://127.0.0.1:${front.address().port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((r) => front.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${front.address().port}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -- ${detail}`}`);
};

const exe = chromiumExecutable();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const UA = {
  vidaa: "Mozilla/5.0 (Linux; VIDAA 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36",
  xbox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 Chrome/110.0 Edge/44.18363",
  androidMobile: "Mozilla/5.0 (Linux; Android 14) PlayarrAndroidMobile/1.0.0",
  androidTv: "Mozilla/5.0 (Linux; Android 14) PlayarrAndroidTV/1.0.0",
};

async function newContext({ userAgent, signedIn }) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...(userAgent ? { userAgent } : {}) });
  // The hosted device-link calls go to the real playarr.app when the page is not on it: never reach production from a test.
  await context.route("https://playarr.app/**", (route) => route.abort());
  await context.addInitScript(
    ({ base, userId, signedIn }) => {
      try {
        if (localStorage.getItem("fixture-seeded")) return;
        localStorage.setItem("fixture-seeded", "1");
        localStorage.setItem("playarr:apiBaseUrl", base);
        if (!signedIn) return;
        const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86_400_000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: base, userId, name: "E2E", deviceId: "d", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: base, userId }));
      } catch {}
    },
    { base, userId: USER_ID, signedIn }
  );
  return context;
}

const isMarketing = (page) => page.evaluate(() => Boolean(document.querySelector("[data-marketing-site]")));
const appRendered = (page, signedIn) =>
  page
    .waitForFunction(
      // Signed out the app shows sign-in or the profile picker; either way something of the app is in #root.
      (signedIn) => (signedIn ? Boolean(document.querySelector(".app-shell")) : Boolean(document.querySelector("#root > *"))),
      signedIn,
      { timeout: 15000 }
    )
    .then(() => true, () => false);

async function expectApp(name, page, signedIn, hitsBefore) {
  const rendered = await appRendered(page, signedIn);
  check(`${name}: the app renders`, rendered, page.url());
  check(`${name}: marketing is never fetched or rendered`, siteHits === hitsBefore && !(await isMarketing(page)), `siteHits +${siteHits - hitsBefore}`);
}

// 1. Any platform marker, signed out and signed in.
for (const platform of ["tv-vidaa", "tv-webos", "tv-tizen", "android-tv", "android-mobile", "xbox", "web", "unknown-client"]) {
  for (const signedIn of [false, true]) {
    const context = await newContext({ signedIn });
    const page = await context.newPage();
    const before = siteHits;
    await page.goto(`${base}/?platform=${platform}`);
    await expectApp(`?platform=${platform} ${signedIn ? "signed in" : "signed out"}`, page, signedIn, before);
    await context.close();
  }
}

// 1b. A deep link into an app route with the marker.
{
  const context = await newContext({ signedIn: false });
  const page = await context.newPage();
  const before = siteHits;
  await page.goto(`${base}/series?platform=tv-vidaa`);
  await expectApp("deep link /series?platform=tv-vidaa signed out", page, false, before);
  await context.close();
}

// 2. App user agents with no marker at all.
for (const [name, userAgent] of Object.entries(UA)) {
  for (const signedIn of [false, true]) {
    const context = await newContext({ userAgent, signedIn });
    const page = await context.newPage();
    const before = siteHits;
    await page.goto(`${base}/`);
    await expectApp(`bare / with the ${name} user agent ${signedIn ? "signed in" : "signed out"}`, page, signedIn, before);
    await context.close();
  }
}

// 3. One app visit sets the app cookie; a later bare "/" in the same browser profile stays on the app.
{
  const context = await newContext({ signedIn: false });
  const page = await context.newPage();
  await page.goto(`${base}/?platform=tv-vidaa`);
  await appRendered(page, false);
  const before = siteHits;
  await page.goto(`${base}/`);
  await expectApp("bare / after an app visit (cookie), signed out", page, false, before);
  await context.close();
}

// 4. Sign-out, then a cold bare "/".
for (const [name, userAgent, entry] of [
  ["non-TV app (Playarr Android user agent)", UA.androidMobile, "/profiles"],
  ["TV app (?platform=tv-vidaa)", undefined, "/profiles?platform=tv-vidaa"],
]) {
  const context = await newContext({ userAgent, signedIn: true });
  const page = await context.newPage();
  const before = siteHits;
  await page.goto(`${base}${entry}`);
  await page.waitForSelector("#profile-sign-out", { timeout: 15000 });
  await page.locator("#profile-sign-out").click();
  await page.waitForFunction(() => !document.querySelector(".app-shell"), null, { timeout: 15000 });
  await expectApp(`sign-out in the ${name}`, page, false, before);
  await page.goto(`${base}/`);
  await expectApp(`cold bare / after sign-out in the ${name}`, page, false, before);
  await context.close();
}

// 5. Control: a plain browser, signed out, does get the marketing site.
{
  const context = await newContext({ signedIn: false });
  const page = await context.newPage();
  const before = siteHits;
  await page.goto(`${base}/`);
  check("control: a plain signed-out browser at / gets the marketing stub", siteHits === before + 1 && (await isMarketing(page)), `siteHits +${siteHits - before}`);
  await context.close();
}

await browser.close();
front.close();
mock.close?.();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
