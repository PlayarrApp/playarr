#!/usr/bin/env node
// Design report capture of every iOS screen (design-report/SCREENS-ALL.md): dispatches the hosted "Parity captures: Apple iOS"
// workflow with design=true for one device, waits, downloads the dark and light artifacts and writes
// $DESIGN_REPORT_ROOT/captures/<device>/{dark,light}/<screen>.png plus manifest.json. No legend, no gate.
//   node scripts/parity/ios/design-run.mjs iphone|ipad       env: DESIGN_REPORT_ROOT, optional DESIGN_RUN_ID (resume a dispatched run)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = process.env.DESIGN_REPORT_ROOT;
const device = process.argv[2];
if (!root || !["iphone", "ipad"].includes(device)) throw new Error("usage: DESIGN_REPORT_ROOT=<design-report dir> design-run.mjs iphone|ipad");
const sh = (name, args, { allowFailure = false } = {}) => {
  const r = spawnSync(name, args, { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFailure) throw new Error(`${name} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r;
};
const out = (name, args) => sh(name, args).stdout.trim();
const suiteScreens = JSON.parse(readFileSync(join(repo, "scripts/parity/suite.json"), "utf8")).screens.map(({ id }) => id);
const design = JSON.parse(readFileSync(join(here(), "design-screens.json"), "utf8"));
function here() { return dirname(fileURLToPath(import.meta.url)); }
const sha = out("git", ["rev-parse", "HEAD"]);
const branch = out("git", ["branch", "--show-current"]);
if (out("git", ["status", "--porcelain"])) throw new Error("Commit and push the task worktree first");
if (out("git", ["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] !== sha) throw new Error("The branch must be pushed at the exact capture SHA");

let run = process.env.DESIGN_RUN_ID ? Number(process.env.DESIGN_RUN_ID) : null;
if (!run) {
  const dispatched = out("gh", ["workflow", "run", "parity-apple-ios.yml", "--ref", branch, "-f", `devices=${device}`, "-f", `ref=${sha}`,
    "-f", `screens=${suiteScreens.join(",")}`, "-f", "fixed_now=2026-10-07T12:00:00Z", "-f", "parts=dark,light", "-f", "design=true"]);
  const match = dispatched.match(/github\.com\/PlayarrApp\/playarr\/actions\/runs\/(\d+)/);
  if (!match) throw new Error(`Dispatch returned no run URL: ${dispatched}`);
  run = Number(match[1]);
}
const work = join(root, "work", "ios", `run-${run}-${device}`);
mkdirSync(work, { recursive: true });
console.log(`${device}: run ${run} at ${sha}`);
const waited = sh("gh-watcher", ["wait", "--repo", "PlayarrApp/playarr", "--run", String(run), "--timeout", "4h", "--json"], { allowFailure: true });
writeFileSync(join(work, "wait.json"), waited.stdout || "{}\n");
const captures = join(root, "captures", device);
const screens = {};
let capturedAt = null;
for (const theme of ["dark", "light"]) {
  const dir = join(work, theme);
  const dl = sh("gh", ["run", "download", String(run), "--repo", "PlayarrApp/playarr", "-n", `apple-wall-${device}-${run}-${theme}`, "-D", dir], { allowFailure: true });
  if (dl.status !== 0) { console.error(`${device}/${theme}: artifact unavailable: ${dl.stderr.trim()}`); continue; }
  const build = existsSync(join(dir, "build.json")) ? JSON.parse(readFileSync(join(dir, "build.json"), "utf8")) : null;
  if (build?.sha !== sha) throw new Error(`${device}/${theme}: artifact build.json does not match ${sha}`);
  capturedAt = capturedAt ?? build.captured_at;
  mkdirSync(join(captures, theme), { recursive: true });
  for (const id of [...suiteScreens, ...Object.keys(design.captured)]) {
    const source = join(dir, theme, `${id}.png`);
    screens[id] ??= { dark: null, light: null };
    if (existsSync(source)) { copyFileSync(source, join(captures, theme, `${id}.png`)); screens[id][theme] = `${theme}/${id}.png`; }
  }
}
for (const [id, reason] of Object.entries(design.absent)) screens[id] = { dark: null, light: null, absent: reason };
writeFileSync(join(captures, "manifest.json"), `${JSON.stringify({ device, class: "simulated", build: sha, capturedAt, screens }, null, 2)}\n`);
const missing = Object.entries(screens).flatMap(([id, s]) => s.absent ? [] : ["dark", "light"].filter((t) => !s[t]).map((t) => `${t}/${id}`));
console.log(`${device}: ${Object.keys(screens).length} screens in manifest; missing: ${missing.join(", ") || "none"}`);
process.exitCode = missing.length ? 1 : 0;
