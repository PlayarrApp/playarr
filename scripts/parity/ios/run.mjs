#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deviceDirectories, inspectRun, publishRun, removeDownloadedImages } from "./publish.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const required = (key) => {
  if (!process.env[key]) throw new Error(`Set ${key}; see docs/parity/DEVICES.md`);
  return resolve(process.env[key]);
};
const legendRoot = required("PARITY_LEGEND_ROOT");
const root = required("PARITY_RUN_ROOT");
const archive = required("PARITY_ARCHIVE_SCRIPT");
const cleanup = required("PARITY_CLEANUP_SCRIPT");
for (const path of [legendRoot, root, archive, cleanup]) if (!existsSync(path)) throw new Error(`Required path does not exist: ${path}`);
const command = (name, args, { allowFailure = false } = {}) => {
  const result = spawnSync(name, args, { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${name} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
};
const output = (name, args) => command(name, args).stdout.trim();
const devices = (process.argv[2] || "iphone,ipad").split(",");
if (devices.some((device) => !deviceDirectories[device]) || new Set(devices).size !== devices.length) throw new Error("Devices must be iphone, ipad, or iphone,ipad");
const allScreens = JSON.parse(readFileSync(join(repo, "scripts/parity/suite.json"), "utf8")).screens.map(({ id }) => id);
const screens = process.argv[3] ? process.argv[3].split(",") : allScreens;
if (!screens.length || screens.some((screen) => !allScreens.includes(screen))) throw new Error("Unknown capture screen");
const sha = output("git", ["rev-parse", "HEAD"]);
const branch = output("git", ["branch", "--show-current"]);
if (!branch || output("git", ["status", "--porcelain"])) throw new Error("Commit and push the task worktree before capturing");
if (output("git", ["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] !== sha) throw new Error("The branch must be pushed at the exact capture SHA");
const pr = JSON.parse(output("gh", ["pr", "view", "--json", "number,url,headRefOid,baseRefName"]));
if (pr.headRefOid !== sha || pr.baseRefName !== "integration/parity") throw new Error("The capture must belong to the current parity PR");
const resume = process.env.PARITY_IOS_RUN_ID;
if (resume && (devices.length !== 1 || !/^\d+$/.test(resume))) throw new Error("Resume requires one device and a numeric PARITY_IOS_RUN_ID");
let failed = false;
for (const device of devices) {
  let run = resume ? Number(resume) : null;
  if (!run) {
    const dispatched = output("gh", ["workflow", "run", "parity-apple-ios.yml", "--ref", branch, "-f", `devices=${device}`, "-f", `ref=${sha}`, "-f", `screens=${screens.join(",")}`, "-f", "fixed_now=2026-10-07T12:00:00Z", "-f", "parts=dark,light"]);
    const match = dispatched.match(/github\.com\/PlayarrApp\/playarr\/actions\/runs\/(\d+)/);
    if (!match) throw new Error(`Dispatch did not return an exact run URL. Locate the new run once, then resume with PARITY_IOS_RUN_ID. Response: ${dispatched}`);
    run = Number(match[1]);
  }
  const url = `https://github.com/PlayarrApp/playarr/actions/runs/${run}`;
  const work = join(root, `run-${run}-${device}`);
  mkdirSync(work, { recursive: true });
  const request = { device, sha, branch, pr: pr.url, run, screens };
  const requestPath = join(work, "request.json");
  if (existsSync(requestPath) && JSON.stringify(JSON.parse(readFileSync(requestPath, "utf8"))) !== JSON.stringify(request)) throw new Error(`Resume arguments differ from ${requestPath}`);
  writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  console.log(`${device}: waiting for ${url}`);
  // One foreground waiter owns the complete hosted run. No run-list or check polling loop.
  const waited = command("gh-watcher", ["wait", "--repo", "PlayarrApp/playarr", "--run", String(run), "--timeout", "4h", "--json"], { allowFailure: true });
  writeFileSync(join(work, "wait.json"), waited.stdout || "{}\n");
  if (waited.status !== 0) failed = true;
  for (const theme of ["dark", "light"]) {
    const args = ["run", "download", String(run), "--repo", "PlayarrApp/playarr", "-n", `apple-wall-${device}-${run}-${theme}`, "-D", join(work, theme)];
    let downloaded = command("gh", args, { allowFailure: true });
    if (downloaded.status !== 0) {
      if (/403|secondary rate limit/i.test(downloaded.stderr + downloaded.stdout)) {
        console.log("GitHub rate limited the download; backing off five minutes before the one retry.");
        await new Promise((done) => setTimeout(done, 300_000));
      }
      downloaded = command("gh", args, { allowFailure: true });
      if (downloaded.status !== 0) {
        failed = true;
        console.error(`${device}/${theme}: artifact unavailable: ${downloaded.stderr.trim()}`);
      }
    }
  }
  const manifest = inspectRun({ work, device, sha, screens, legendRoot });
  if (!Object.values(manifest.themes).some(({ rows }) => rows.some((row) => row.png))) throw new Error(`No captures available; active candidate preserved. Evidence: ${work}`);
  if (process.env.PARITY_IOS_INSPECT_ONLY === "1") {
    console.log(`Captures ready for the exporter audit: ${work}. Resume this run without PARITY_IOS_INSPECT_ONLY to publish.`);
    continue;
  }
  const candidate = publishRun({ work, legendRoot, device, sha, branch, pr: pr.number, run, manifest });
  // Required campaign order: publish, archive all result JSON, then clean captures.
  console.log(output("python3", ["-I", archive]));
  console.log(output("python3", ["-I", cleanup, "--apply"]));
  for (const theme of ["dark", "light"]) removeDownloadedImages(join(work, theme));
  for (const [theme, { rows }] of Object.entries(manifest.themes)) for (const row of rows) {
    console.log(`${device} ${theme} ${row.screen}: layout ${row.score?.score ?? "missing"}%, screenshot ${row.png ? "present" : "missing"}`);
    if (!row.png || !row.layout) failed = true;
  }
  console.log(`Published ${candidate}. Evidence ${work}. PR ${pr.url}`);
}
if (failed) process.exitCode = 1;
