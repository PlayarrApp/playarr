#!/usr/bin/env node
// Owner rule 2026-10-14: every page header subtitle is the Movies, Series and Music one. Opens every routed page that has
// a header subtitle at 1920x1080 and 1280x720 in both themes and checks that it has the same computed font size, weight,
// colour (the page ink, never the pink kicker), letter spacing and case as the Movies subtitle, and the same place:
// beside the title with the 1px divider, or, only when the header marked itself wrapped, under the title with the rule.
// Runs against the deterministic mock API, or a fixture server with --base. `--device-test [--site url]` runs the same
// checks on the live web app as the PLAYARR_DEVICE_TEST_* account from ~/.secrets (credentials are never printed).
//
//   node scripts/subtitle-style-e2e.mjs [--dist dist] [--no-build] [--base http://127.0.0.1:18484] [--device-test]
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium-launch.mjs";
import { startServer } from "./nav-perf/server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const DIST = resolve(root, opt("dist", "dist"));
const BASE = opt("base", "");
// --device-test: the live site (--site, default the production web app) with the PLAYARR_DEVICE_TEST_* account from ~/.secrets.
const DEVICE_TEST = args.includes("--device-test");
if (!BASE && !DEVICE_TEST && !args.includes("--no-build") && !args.includes("--dist")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
let apiBase = "";
let s = { access_token: "t", refresh_token: "r", expires_in: 86400, user_id: "00000000-0000-4000-8000-000000000001" };
let server = null;
let base = BASE;
if (DEVICE_TEST) {
  const env = Object.fromEntries(readFileSync(join(homedir(), ".secrets"), "utf8").split("\n").filter((l) => /^PLAYARR_DEVICE_TEST_/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
  apiBase = env.PLAYARR_DEVICE_TEST_SERVER_URL.replace(/\/$/, "");
  const res = await fetch(`${apiBase}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.PLAYARR_DEVICE_TEST_USERNAME, password: env.PLAYARR_DEVICE_TEST_PASSWORD, device_id: "22222222-2222-4222-8222-222222222222", device_name: "subtitle-check", client_platform: "web", client_version: "check" }) });
  s = await res.json();
  if (!s.access_token) { console.log(`FAIL  device-test login failed (${res.status})`); process.exit(1); }
  base = opt("site", "https://playarr.app");
} else if (!BASE) {
  server = await startServer({ distDir: DIST, seasons: 2, seasonEpisodes: 4, canDownload: true, playlists: 3, folders: true, watchlist: 4 });
  base = `http://127.0.0.1:${server.port}`;
}
if (!apiBase) apiBase = base;
const get = async (path) => { try { return await (await fetch(`${apiBase}${path}`, { headers: { authorization: `Bearer ${s.access_token}` } })).json(); } catch { return {}; } };
const firstOf = async (kind) => (await get(`/api/v1/catalog?kind=${kind}&limit=1`)).items?.[0]?.id ?? "";
const ids = { movie: await firstOf("movie"), series: await firstOf("series"), artist: await firstOf("artist") };

const PAGES = [
  ["movies", "/movies"], ["series", "/series"], ["music", "/music"], ["search", "/search?q=e"], ["playlists", "/playlists"],
  ["folders", "/folders"], ["downloads", "/downloads"], ["watchlist", "/watchlist"], ["requests", "/requests"],
  ["calendar", "/calendar?view=agenda"], ["settings", "/settings"],
  ...["appearance", "profile-avatar", "language", "player", "server", "profile-lock", "invite", "request-latency", "remote", "your-data", "home"].map((x) => [`settings-${x}`, `/settings/${x}`]),
  ["film-detail", `/movies/${ids.movie}`], ["series-detail", `/series/${ids.series}`], ["artist-detail", `/music/${ids.artist}`],
];
const PROPS = ["fontSize", "fontWeight", "color", "letterSpacing", "textTransform", "fontStyle"];
const read = (props) => {
  const el = document.querySelector(".page-header-detail");
  const header = document.querySelector(".page-header");
  const style = el ? getComputedStyle(el) : null;
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const shown = el && style.display !== "none";
  return {
    subtitle: shown ? Object.fromEntries(props.map((p) => [p, style[p]])) : null,
    cls: el?.className ?? null,
    wrapped: header?.classList.contains("is-detail-wrapped") ?? false,
    borderLeft: style?.borderLeftWidth ?? null,
    borderTop: style?.borderTopWidth ?? null,
    geo: { sub: box(el), title: box(header?.querySelector("h1")) },
  };
};

const browser = await launchChromium();
let failed = 0;
let reference = null;
for (const theme of ["light", "dark"]) {
  for (const vp of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const context = await browser.newContext({ viewport: vp, colorScheme: theme, reducedMotion: "reduce" });
    await context.addInitScript(({ apiBase, s, theme }) => {
      try {
        localStorage.setItem("playarr-theme", theme);
        localStorage.setItem("playarr:apiBaseUrl", apiBase);
        const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
        localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: apiBase, userId: s.user_id, name: "Viewer", deviceId: "e2e-device", session }]));
        localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: apiBase, userId: s.user_id }));
      } catch {}
    }, { apiBase, s, theme });
    const page = await context.newPage();
    const results = [];
    for (const [id, route] of PAGES) {
      await page.goto(`${base}${route}`, { waitUntil: "load" });
      await page.waitForSelector(".page-header", { timeout: 20000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      results.push([id, await page.evaluate(read, PROPS)]);
    }
    const reference = results.find(([id]) => id === "movies")?.[1].subtitle;
    if (!reference) { console.log(`FAIL  ${theme} ${vp.width}: no Movies subtitle found`); failed++; }
    for (const [id, r] of results) {
      if (!r.subtitle) { console.log(`note  ${theme} ${vp.width} ${id}: no subtitle shown on this page state`); continue; }
      const diffs = reference ? PROPS.filter((p) => r.subtitle[p] !== reference[p]) : PROPS;
      const g = r.geo;
      const beside = g.sub.left >= g.title.right - 1 && g.sub.top < g.title.bottom && r.borderLeft === "1px";
      const under = r.wrapped && g.sub.top >= g.title.bottom - 1 && r.borderTop === "1px";
      if (!(beside || under)) diffs.push(`place(wrapped=${r.wrapped},sub=${JSON.stringify(g.sub)},title=${JSON.stringify(g.title)},borders=${r.borderLeft}/${r.borderTop})`);
      if (/page-subtitle|is-section|tv-detail-heading-item/.test(r.cls ?? "")) diffs.push(`class=${r.cls}`);
      const ok = diffs.length === 0;
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${theme} ${vp.width} ${id}: ${r.subtitle.fontSize} ${r.subtitle.color} ${r.wrapped ? "wrapped" : "beside"}${ok ? "" : ` diffs=${diffs.join(",")}`}`);
    }
    await context.close();
  }
}
await browser.close();
server?.close?.();
console.log(failed ? `${failed} check(s) failed` : "all header subtitles share the one Movies style");
process.exit(failed ? 1 : 0);
