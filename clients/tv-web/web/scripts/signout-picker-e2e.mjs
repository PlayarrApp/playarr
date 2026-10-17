#!/usr/bin/env node
// Sign-out and boot land on the profile picker, and no credential-less login or refresh runs until a profile is chosen.
//   node scripts/signout-picker-e2e.mjs [--dist dir] [--no-build]
// Fixtures only. The mock answers login with 400 (full-account) and refresh with 401 for a revoked token.
//  1. Three accounts, A active. Sign out A: picker lists B and C, selects none, zero login/refresh calls.
//  2. Reload with no active marker: frame 1 is the picker (never the app shell), zero login/refresh calls.
//  3. Pick B (valid token): signs in to the app. Sign out B: C is the only account left and is signed in at once.
//  4. Sign out C: nothing left, the sign-in page shows.
//  5. Stale boot: saved accounts but a revoked token. The picker paints on frame 1 with zero auth calls; picking the
//     revoked account asks for its credentials instead of showing "API request failed".
//  6. Valid active session: the app shell paints, never the picker.
//  7. No sessions at all: sign-in is the first paint and zero login/refresh calls run over 10 s.
import { boot, USER_ID } from "./e2e-common.mjs";

const { browser, check, finish, server } = await boot({});
const base = `http://127.0.0.1:${server.port}`;
const ID = { a: USER_ID, b: "00000000-0000-4000-8000-0000000000bb", c: "00000000-0000-4000-8000-0000000000cc" };
const NAMES = { [ID.a]: "Fixture Ann", [ID.b]: "Fixture Ben", [ID.c]: "Fixture Cat" };
const jwtFor = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 86_400 })}.sig`;
};

/** A fresh browser context seeded once with `accounts` (ids), `active` (id or none) and the refresh behaviour. */
async function newPage({ accounts, active, revoked = [], expireActive = false, revokeDelayMs = 0 }) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const calls = { login: 0, refresh: 0 };
  await context.addInitScript(({ base, accounts, active, names, tokens, expireActive }) => {
    try {
      if (localStorage.getItem("fixture-seeded")) return;
      localStorage.setItem("fixture-seeded", "1");
      localStorage.setItem("playarr:apiBaseUrl", base);
      const entry = (id) => ({ profileKey: `k-${id}`, apiBaseUrl: base, userId: id, name: names[id], deviceId: "d",
        session: { accessToken: tokens[id], refreshToken: `r-${id}`, tokenType: "Bearer", expiresAt: id === active && expireActive ? Date.now() - 1000 : Date.now() + 86_400_000 } });
      localStorage.setItem("playarr.profileSessions.v4", JSON.stringify(accounts.map(entry)));
      if (active) {
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: `k-${active}`, apiBaseUrl: base, userId: active }));
        localStorage.setItem("playarr:session", JSON.stringify(entry(active).session));
      }
    } catch {}
  }, { base, accounts, active, names: NAMES, tokens: Object.fromEntries(Object.values(ID).map((id) => [id, jwtFor(id)])), expireActive });
  await context.route("**/api/v1/auth/login", async (route) => {
    calls.login += 1;
    await route.fulfill({ status: 400, json: { error: "bad_request", message: "credentials required for full-account login" } });
  });
  await context.route("**/api/v1/auth/refresh", async (route) => {
    calls.refresh += 1;
    const id = String(route.request().postDataJSON().refresh_token).slice(2);
    if (revoked.includes(id)) await new Promise((r) => setTimeout(r, revokeDelayMs));
    if (revoked.includes(id)) return route.fulfill({ status: 401, json: { error: "unauthorized", message: "refresh token is invalid or expired" } });
    await route.fulfill({ json: { access_token: jwtFor(id), refresh_token: `r-${id}`, expires_in: 86400, token_type: "Bearer", user_id: id } });
  });
  await context.route("**/api/v1/users/profiles", async (route) => {
    const auth = route.request().headers()["authorization"] ?? "";
    let id;
    try { id = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub; } catch {}
    await route.fulfill({ json: id ? [{ id, username: NAMES[id], display_name: NAMES[id], is_current: true, pin_locked: false }] : [] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, calls, errors, context };
}

const tiles = (page) => page.$$eval(".profile-choice:not(.profile-skeleton):not(.profile-add)", (els) => els.map((e) => e.textContent.trim()));
/** What the very first painted frames show: the picker, the app shell, or neither. */

// 1. Three accounts, A active: sign out A.
let ctx = await newPage({ accounts: [ID.a, ID.b, ID.c], active: ID.a });
await ctx.page.goto(`${base}/profiles`);
await ctx.page.waitForSelector("#profile-sign-out");
await ctx.page.locator("#profile-sign-out").click();
await ctx.page.waitForTimeout(800);
let shown = await tiles(ctx.page);
check("sign-out with 3: stays on the picker", new URL(ctx.page.url()).pathname === "/profiles", ctx.page.url());
check("sign-out with 3: lists the other 2", shown.length === 2 && shown.some((t) => t.includes("Ben")) && shown.some((t) => t.includes("Cat")), shown.join("|"));
check("sign-out with 3: no account is auto-selected", !shown.some((t) => t.includes("Ann")), shown.join("|"));
check("sign-out with 3: zero login or refresh calls", ctx.calls.login === 0 && ctx.calls.refresh === 0, JSON.stringify(ctx.calls));

// 2. Reload: the picker is the first paint.
await ctx.page.goto(`${base}/`, { waitUntil: "commit" });
const frames = await ctx.page.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    seen.push(document.querySelector(".app-shell") ? "shell" : document.querySelector(".profile-choice") ? "picker" : "none");
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
});
const painted = frames.filter((f) => f !== "none");
check("reload while signed out: the app shell never mounts", !frames.includes("shell"), frames.join(","));
check("reload while signed out: the picker is the first thing painted", painted[0] === "picker", frames.join(","));
await ctx.page.waitForSelector(".profile-choice");
check("reload while signed out: zero login or refresh calls", ctx.calls.login === 0 && ctx.calls.refresh === 0, JSON.stringify(ctx.calls));

// 3. Pick B: signs in. Sign out B: C is the only one left and is signed in at once.
await ctx.page.locator(`#profile-${ID.b}`).click();
await ctx.page.waitForFunction(() => document.querySelector(".app-shell") && !document.querySelector(".profile-choice"), null, { timeout: 15000 });
check("picking a valid account signs in", ctx.calls.refresh >= 1 && ctx.calls.login === 0, JSON.stringify(ctx.calls));
await ctx.page.goto(`${base}/profiles`);
await ctx.page.waitForSelector("#profile-sign-out");
await ctx.page.locator("#profile-sign-out").click();
await ctx.page.waitForFunction(() => document.querySelector(".app-shell") && !document.querySelector(".profile-choice"), null, { timeout: 15000 });
const remaining = await ctx.page.evaluate(() => JSON.parse(localStorage.getItem("playarr.activeProfile.v1") ?? "{}").userId);
check("sign-out with 2: the remaining account is selected", remaining === ID.c && ctx.calls.login === 0, `${remaining} ${JSON.stringify(ctx.calls)}`);

// 4. Sign out C: nothing left.
await ctx.page.goto(`${base}/profiles`);
await ctx.page.waitForSelector("#profile-sign-out");
await ctx.page.locator("#profile-sign-out").click();
await ctx.page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15000 });
check("sign-out with 1: the sign-in page shows", true);
check("no page errors (flow 1-4)", ctx.errors.length === 0, ctx.errors.join("; "));
await ctx.context.close();

// 5. Stale boot: saved accounts, no active marker, revoked token for B.
ctx = await newPage({ accounts: [ID.b, ID.c], active: undefined, revoked: [ID.b] });
await ctx.page.goto(`${base}/`, { waitUntil: "commit" });
const staleFrames = await ctx.page.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    seen.push(document.querySelector(".app-shell") ? "shell" : document.querySelector(".profile-choice") ? "picker" : "none");
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
});
check("stale boot: picker on the first painted frame, shell never", staleFrames.find((f) => f !== "none") === "picker" && !staleFrames.includes("shell"), staleFrames.join(","));
await ctx.page.waitForSelector(".profile-choice");
await ctx.page.waitForTimeout(800);
check("stale boot: zero login or refresh calls", ctx.calls.login === 0 && ctx.calls.refresh === 0, JSON.stringify(ctx.calls));
check("stale boot: no API error text", !(await ctx.page.locator("body").innerText()).includes("API request failed"));
await ctx.page.locator(`#profile-${ID.b}`).click();
await ctx.page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15000 });
check("revoked account: asks for its credentials, no blank login call", ctx.calls.login === 0, JSON.stringify(ctx.calls));
await ctx.context.close();

// 6. Valid active session: app shell.
ctx = await newPage({ accounts: [ID.a], active: ID.a });
await ctx.page.goto(`${base}/`, { waitUntil: "commit" });
const shellFrames = await ctx.page.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    seen.push(document.querySelector(".app-shell") ? "shell" : document.querySelector(".profile-choice") ? "picker" : "none");
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
});
check("valid session: the app shell paints, never the picker", shellFrames.includes("shell") && !shellFrames.includes("picker"), shellFrames.join(","));
await ctx.context.close();

// 7. Zero sessions: sign-in is the first paint, and nothing calls login or refresh for 10 s.
ctx = await newPage({ accounts: [], active: undefined });
await ctx.page.goto(`${base}/`, { waitUntil: "commit" });
const emptyFrames = await ctx.page.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    seen.push(document.querySelector(".app-shell") ? "shell" : document.querySelector(".profile-choice") ? "picker" : "other");
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
});
check("zero sessions: shell and picker never paint", !emptyFrames.includes("shell") && !emptyFrames.includes("picker"), emptyFrames.join(","));
await ctx.page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15000 });
await ctx.page.waitForTimeout(10000);
check("zero sessions: zero login or refresh calls over 10 s", ctx.calls.login === 0 && ctx.calls.refresh === 0, JSON.stringify(ctx.calls));
await ctx.context.close();

// 8. A slow refresh of the active account is refused while the viewer switches to B: B's session survives.
ctx = await newPage({ accounts: [ID.a, ID.b], active: ID.a, revoked: [ID.a], expireActive: true, revokeDelayMs: 2500 });
await ctx.page.goto(`${base}/profiles`);
await ctx.page.waitForSelector(`#profile-${ID.b}`);
await ctx.page.locator(`#profile-${ID.b}`).click();
await ctx.page.waitForTimeout(5000);
const after = await ctx.page.evaluate(() => ({
  marker: JSON.parse(localStorage.getItem("playarr.activeProfile.v1") ?? "{}").userId,
  token: (() => { try { return JSON.parse(JSON.parse(localStorage.getItem("playarr:session") ?? "{}") ? localStorage.getItem("playarr:session") : "{}").refreshToken; } catch { return null; } })(),
}));
check("switch during a refused refresh: the new profile's session survives", after.marker === ID.b && after.token === `r-${ID.b}`, JSON.stringify(after));
check("switch during a refused refresh: no blind login", ctx.calls.login === 0, JSON.stringify(ctx.calls));
await ctx.context.close();

await finish();
