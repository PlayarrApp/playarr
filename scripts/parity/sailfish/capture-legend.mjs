#!/usr/bin/env node
// Orchestrate the existing Sailfish capture, attest what is installed, then publish PNGs only.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "../../..");
const THEMES = ["dark", "light"];
const SCREENS = ["home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "player-controls", "actions", "calendar-link"];
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isoNow = () => new Date().toISOString();

function git(args, encoding = "utf8") {
  return execFileSync("git", ["-C", APP, ...args], { encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function captureInputPaths() {
  const listed = git(["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "clients/sailfish/qml", "scripts/parity/sailfish"]).split("\0").filter(Boolean);
  const fixed = [
    "scripts/parity/suite-run.mjs", "scripts/parity/suite-lib.mjs", "scripts/parity/suite.json",
    "scripts/parity/screens.json", "scripts/parity/parity-config.mjs", "scripts/parity/capture-state.mjs",
    "scripts/parity/capture-timezone.mjs", "scripts/parity/capture-manifest.mjs",
    "scripts/parity/run-policy.mjs", "scripts/fixtures/catalog.mjs", "scripts/parity/selective-results.mjs",
    "scripts/parity/canonical-deck.mjs", "scripts/parity/dpad-account.mjs", "scripts/parity/static/catalogue.mjs",
    "scripts/parity/web-refs.json", "scripts/parity/expected.static.json", "scripts/parity/expected.web.json",
    "scripts/parity/package.json", "scripts/parity/package-lock.json",
  ];
  const paths = [...new Set([...listed, ...fixed])].sort();
  if (paths.filter((path) => path.startsWith("clients/sailfish/qml/")).length !== 57) {
    throw new Error("Expected 57 committed Sailfish QML files in the capture source");
  }
  return paths;
}

export function sourceSnapshot() {
  const sha = git(["rev-parse", "HEAD"]).trim();
  const branch = git(["branch", "--show-current"]).trim();
  const paths = captureInputPaths();
  const files = {};
  for (const path of paths) {
    let bytes;
    try { bytes = readFileSync(join(APP, path)); } catch { throw new Error(`Capture source is missing: ${path}`); }
    const actual = hash(bytes);
    const committed = hash(git(["show", `HEAD:${path}`], null));
    if (actual !== committed) throw new Error(`Capture source differs from HEAD: ${path}`);
    files[path] = actual;
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", "clients/sailfish/qml", "scripts/parity/sailfish"]).split("\0").filter(Boolean);
  if (untracked.length) throw new Error(`Untracked Sailfish capture source exists: ${untracked[0]}`);
  return { sha, branch, files, manifestSha256: hash(Buffer.from(JSON.stringify(files))) };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function guestSnapshot(source, env) {
  const key = env.PLAYARR_SF_SSH_KEY;
  if (!key) throw new Error("PLAYARR_SF_SSH_KEY is required for guest attestation");
  const host = env.PLAYARR_SF_SSH_HOST ?? "127.0.0.1";
  const port = env.PLAYARR_SF_SSH_PORT ?? "2223";
  const args = [];
  if (env.PLAYARR_SF_SSH_CONFIG) args.push("-F", env.PLAYARR_SF_SSH_CONFIG);
  args.push("-i", key, "-p", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10");
  const qml = Object.keys(source.files).filter((path) => path.startsWith("clients/sailfish/qml/")).map((path) => path.slice("clients/sailfish/qml/".length)).sort();
  const command = [
    "set -eu",
    "cd /usr/share/harbour-playarr/qml",
    `count=$(find . -type f | wc -l | tr -d ' ')`,
    `test \"$count\" = ${qml.length}`,
    `test -z \"$(find . -type l -print -quit)\"`,
    ...qml.map((path) => `test -f ${shellQuote(path)} && sha256sum ${shellQuote(path)}`),
    "sha256sum /usr/bin/harbour-playarr",
  ].join("; ");
  let output;
  try {
    output = execFileSync("ssh", [...args, `root@${host}`, command], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Guest source/binary attestation failed; SSH diagnostics were withheld");
  }
  const guestFiles = {};
  let executableSha256 = null;
  for (const line of output.trim().split("\n")) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error("Guest attestation returned an invalid hash record");
    const [, digest, path] = match;
    if (path === "/usr/bin/harbour-playarr") executableSha256 = digest;
    else guestFiles[`clients/sailfish/qml/${path}`] = digest;
  }
  const expected = Object.keys(source.files).filter((path) => path.startsWith("clients/sailfish/qml/")).sort();
  if (Object.keys(guestFiles).sort().join("\n") !== expected.join("\n")) throw new Error("Installed guest QML file set differs from committed source");
  for (const path of expected) if (guestFiles[path] !== source.files[path]) throw new Error(`Installed guest QML differs from capture source: ${path}`);
  if (!executableSha256) throw new Error("Guest executable SHA256 was not reported");
  return { qmlFiles: guestFiles, qmlManifestSha256: hash(Buffer.from(JSON.stringify(guestFiles))), executableSha256 };
}

function readPng(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Capture is not a regular file: ${path}`);
  const bytes = readFileSync(path);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) throw new Error(`Invalid PNG: ${path}`);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width !== 768 || height !== 1344) throw new Error(`Unexpected PNG size ${width}x${height}: ${path}`);
  let decoded;
  try { decoded = PNG.sync.read(bytes); } catch { throw new Error(`PNG image data is not valid in ${path}`); }
  if (decoded.width !== width || decoded.height !== height) throw new Error(`Decoded PNG dimensions changed in ${path}`);
  return { bytes, sha256: hash(bytes), width, height };
}

export function validateRun(runDir) {
  const run = resolve(runDir);
  const files = {};
  const expectedNames = new Set(SCREENS.map((screen) => `${screen}.png`));
  for (const theme of THEMES) {
    const dir = join(run, theme);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) throw new Error(`Missing theme capture directory: ${theme}`);
    const names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".png")).sort();
    if (names.length !== SCREENS.length || names.some((name) => !expectedNames.has(name))) throw new Error(`Expected exactly 16 ${theme} PNGs`);
    for (const screen of SCREENS) {
      const path = join(dir, `${screen}.png`);
      const png = readPng(path);
      files[`${theme}/${screen}`] = { path, ...png };
    }
  }
  if (Object.keys(files).length !== 32) throw new Error("Expected exactly 32 Sailfish screenshots");
  return files;
}

// One layout document per screen and theme, written by the driver in the same run as the screenshot.
export function validateLayouts(runDir) {
  const docs = {};
  for (const theme of THEMES) for (const screen of SCREENS) {
    const path = join(resolve(runDir), "layout", theme, `${screen}.json`);
    if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`Missing layout document: ${theme}/${screen}`);
    const bytes = readFileSync(path);
    let doc;
    try { doc = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`Layout document is not JSON: ${theme}/${screen}`); }
    if (doc.screen !== screen || doc.theme !== theme || !Array.isArray(doc.elements) || doc.elements.length === 0) throw new Error(`Layout document does not match its screen and theme: ${theme}/${screen}`);
    if (doc.elements.some((element) => element._src !== undefined || element._dbg !== undefined)) throw new Error(`Layout document carries development fields: ${theme}/${screen}`);
    docs[`${theme}/${screen}`] = { bytes, sha256: hash(bytes) };
  }
  return docs;
}

export function assertSafeScratch(scratchPath, legendRootPath) {
  const scratch = resolve(scratchPath);
  const legendRoot = resolve(legendRootPath);
  const scratchStat = lstatSync(scratch);
  if (!scratchStat.isDirectory() || scratchStat.isSymbolicLink() || realpathSync(scratch) !== scratch) {
    throw new Error("Capture scratch must be an existing canonical directory");
  }
  const within = (parent, child) => {
    const rel = relative(parent, child);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
  };
  if (within(legendRoot, scratch) || within(scratch, legendRoot)) {
    throw new Error("Capture scratch must be outside and disjoint from the legend root");
  }
  return scratch;
}

export function removeValidatedPngs(captures) {
  const entries = Object.values(captures);
  if (entries.length !== 32) throw new Error("Refusing raw PNG cleanup without exactly 32 validated captures");
  for (const capture of entries) {
    const stat = lstatSync(capture.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing to remove non-regular capture: ${capture.path}`);
    if (hash(readFileSync(capture.path)) !== capture.sha256) throw new Error(`Capture changed after validation: ${capture.path}`);
  }
  for (const capture of entries) unlinkSync(capture.path);
}

export async function runCaptureLifecycle({ captureAndPublish, archive, cleanup, remove }) {
  let publication = null;
  let captures = null;
  let captureError = null;
  try {
    const result = await captureAndPublish();
    publication = result.publication;
    captures = result.captures;
  } catch (error) {
    captureError = error;
  }

  let archiveError = null;
  let cleanupError = null;
  let cleanupSkipped = false;
  try {
    await archive();
    try { await cleanup(); }
    catch (error) { cleanupError = error; }
  } catch (error) {
    archiveError = error;
    cleanupSkipped = true;
  }

  if (publication && archiveError === null && cleanupError === null) {
    try { await remove(captures); }
    catch (error) { cleanupError = error; }
  }

  if (captureError || archiveError || cleanupError) {
    const status = (error) => error ? "failed" : "ok";
    const detail = (error) => error ? ` (${error.message})` : "";
    throw new Error([
      `Capture lifecycle failed (published: ${publication ? "yes" : "no"})`,
      `capture: ${status(captureError)}${detail(captureError)}`,
      `archive: ${status(archiveError)}${detail(archiveError)}`,
      `cleanup: ${cleanupSkipped ? "not run after archive failure" : status(cleanupError)}${detail(cleanupError)}`,
      "raw captures and JSON retained",
    ].join("; "));
  }
  return publication;
}

function assertSafeDestination(legendRoot, destination) {
  const root = resolve(legendRoot);
  const candidate = resolve(destination);
  if (!root || !candidate || candidate !== join(root, "sailfish", "dev")) throw new Error("Destination must be exactly <legend-root>/sailfish/dev");
  for (const path of [root, join(root, "sailfish"), candidate]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe legend destination component: ${path}`);
  }
  if (realpathSync(candidate) !== candidate || realpathSync(root) !== root) throw new Error("Legend destination must not traverse symlinks");
  return candidate;
}

function cloneTree(source, destination) {
  mkdirSync(destination, { mode: statSync(source).mode & 0o777 });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const src = join(source, entry.name), dst = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in candidate tree: ${entry.name}`);
    if (entry.isDirectory()) cloneTree(src, dst);
    else if (entry.isFile()) {
      copyFileSync(src, dst);
      chmodSync(dst, statSync(src).mode & 0o777);
    } else throw new Error(`Unsupported candidate entry: ${entry.name}`);
  }
}

function removePngs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) rmSync(path);
    else if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in capture directory: ${entry.name}`);
  }
}

export function publishRun({ runDir, legendRoot, destination, source, guestBefore, guestAfter, pr = null, capturedAt = isoNow() }) {
  const dest = assertSafeDestination(legendRoot, destination);
  if (guestBefore.qmlManifestSha256 !== guestAfter.qmlManifestSha256 || guestBefore.executableSha256 !== guestAfter.executableSha256) {
    throw new Error("Installed guest QML or executable changed during capture");
  }
  if (!source?.manifestSha256 || !source?.sha || !source?.branch) throw new Error("Capture source attestation is incomplete");
  const captures = validateRun(runDir);
  const layouts = validateLayouts(runDir);
  const sourceRun = resolve(runDir);
  const parent = dirname(dest), staged = mkdtempSync(join(parent, ".sailfish-dev-stage-"));
  let backup = null;
  try {
    rmSync(staged, { recursive: true });
    cloneTree(dest, staged);
    const light = join(staged, "light");
    if (!existsSync(light)) mkdirSync(light);
    if (!lstatSync(light).isDirectory() || lstatSync(light).isSymbolicLink()) throw new Error("Candidate light path must be a real directory");
    removePngs(staged);
    removePngs(light);
    rmSync(join(staged, "layout"), { recursive: true, force: true });
    const imageHashes = {};
    for (const theme of THEMES) for (const screen of SCREENS) {
      const capture = captures[`${theme}/${screen}`];
      const target = join(theme === "dark" ? staged : light, `${screen}.png`);
      writeFileSync(target, capture.bytes);
      imageHashes[`${theme}/${screen}`] = capture.sha256;
    }
    const layoutHashes = {};
    for (const theme of THEMES) {
      mkdirSync(join(staged, "layout", theme), { recursive: true });
      for (const screen of SCREENS) {
        writeFileSync(join(staged, "layout", theme, `${screen}.json`), layouts[`${theme}/${screen}`].bytes);
        layoutHashes[`${theme}/${screen}`] = layouts[`${theme}/${screen}`].sha256;
      }
    }
    const build = {
      branch: source.branch, sha: source.sha, pr, captured_at: capturedAt, server: "static server",
      capture_source: { qml_manifest_sha256: guestBefore.qmlManifestSha256, source_manifest_sha256: source.manifestSha256 },
      guest_native_executable_sha256: guestBefore.executableSha256,
      capture_scope: { screens: SCREENS, themes: THEMES, png_count: 32, dimensions: "768x1344" },
      capture_sha256: imageHashes,
      layouts_published: true,
      layout_sha256: layoutHashes,
      layout_status: "EXPORTER_AUDIT_PENDING",
    };
    writeFileSync(join(staged, "build.json"), `${JSON.stringify(build, null, 2)}\n`);
    writeFileSync(join(light, "build.json"), `${JSON.stringify({ ...build, theme: "light" }, null, 2)}\n`);

    // Directory replacement has rollback on failure; all validation and staging finish before mutation.
    backup = `${dest}.sailfish-backup-${process.pid}`;
    if (existsSync(backup)) throw new Error("Stale publication backup path exists");
    renameSync(dest, backup);
    try { renameSync(staged, dest); }
    catch (error) { renameSync(backup, dest); backup = null; throw error; }
    rmSync(backup, { recursive: true });
    backup = null;
    return { destination: dest, sha: source.sha, branch: source.branch, screenshots: Object.keys(imageHashes).length, layoutsPublished: true, captureSourceSha256: source.manifestSha256, guestQmlSha256: guestBefore.qmlManifestSha256, guestExecutableSha256: guestBefore.executableSha256, run: sourceRun };
  } finally {
    if (backup && existsSync(backup) && !existsSync(dest)) renameSync(backup, dest);
    if (existsSync(staged)) rmSync(staged, { recursive: true });
  }
}

function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), { stdio: "ignore", ...options });
}

async function captureLegend() {
  const env = process.env;
  if (process.argv.length !== 2) throw new Error("capture-legend.sh takes no arguments; it always captures all 16 screens in both themes");
  if (env.PLAYARR_SF_SKIP_SIGNIN && env.PLAYARR_SF_SKIP_SIGNIN !== "1") throw new Error("This publisher requires an already signed-in static fixture session and refuses to run sign-in");
  if (!env.PLAYARR_SF_SSH_KEY || !env.PLAYARR_SF_SCRATCH || !env.PLAYARR_SF_OUT || !env.PARITY_LEGEND_ROOT || !env.PARITY_LOCK_DIR || !env.PLAYARR_PARITY_ARCHIVE_SCRIPT || !env.PLAYARR_PARITY_CLEANUP_SCRIPT) throw new Error("Set SSH, scratch, legend, lock, archive, and cleanup paths before capture");
  if (env.PARITY_CLIENT !== "sailfish") throw new Error("PARITY_CLIENT must be sailfish");
  const root = resolve(env.PARITY_LEGEND_ROOT), destination = resolve(env.PLAYARR_SF_OUT);
  const scratch = assertSafeScratch(env.PLAYARR_SF_SCRATCH, root);
  const archiveScript = realpathSync(env.PLAYARR_PARITY_ARCHIVE_SCRIPT), cleanupScript = realpathSync(env.PLAYARR_PARITY_CLEANUP_SCRIPT);
  if (!lstatSync(archiveScript).isFile() || !lstatSync(cleanupScript).isFile()) throw new Error("Archive and cleanup script paths must name regular files");
  assertSafeDestination(root, destination);
  env.PLAYARR_SF_SKIP_SIGNIN = "1";
  const runDir = mkdtempSync(join(scratch, "capture-legend-"));
  chmodSync(runDir, 0o700);
  const logPath = join(runDir, "capture.log");
  let captureAttempted = false;
  const maintain = () => {
    const childEnv = { ...env, PLAYARR_SF_OUT: runDir };
    run(["python3", "-I", archiveScript], { env: childEnv });
  };
  try {
    const sourceBefore = sourceSnapshot();
    run([join(HERE, "vm-coldboot.sh")], { env, stdio: "ignore" });
    const guestBefore = guestSnapshot(sourceBefore, env);
    const result = await runCaptureLifecycle({
      captureAndPublish: async () => {
        captureAttempted = true;
        try {
          execFileSync(join(HERE, "run.sh"), [], { env: { ...env, PLAYARR_SF_OUT: runDir, PLAYARR_SF_SKIP_SIGNIN: "1" }, encoding: "utf8", timeout: 4 * 60 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
          writeFileSync(logPath, `${error.stdout ?? ""}${error.stderr ?? ""}`, { mode: 0o600 });
          throw new Error(`Sailfish capture failed (exit code: ${error.status ?? "unknown"}, signal: ${error.signal ?? "none"}); private log: ${relative(scratch, logPath)}`);
        }
        const sourceAfter = sourceSnapshot();
        const guestAfter = guestSnapshot(sourceAfter, env);
        if (sourceBefore.manifestSha256 !== sourceAfter.manifestSha256 || sourceBefore.sha !== sourceAfter.sha) throw new Error("Capture source changed during run");
        const images = validateRun(runDir);
        const prText = env.PARITY_PR ?? "null";
        const pr = prText === "null" || prText === "" ? null : Number(prText);
        if (pr !== null && (!Number.isInteger(pr) || pr < 1)) throw new Error("PARITY_PR must be a positive integer or null");
        const capturedAt = isoNow();
        const imageHashes = Object.fromEntries(Object.entries(images).map(([name, image]) => [name, image.sha256]));
        writeFileSync(join(runDir, "build.json"), `${JSON.stringify({ branch: sourceAfter.branch, sha: sourceAfter.sha, pr, captured_at: capturedAt, run: relative(scratch, runDir), server: "static server", capture_source: { qml_manifest_sha256: guestBefore.qmlManifestSha256, source_manifest_sha256: sourceAfter.manifestSha256 }, guest_native_executable_sha256: guestBefore.executableSha256, capture_sha256: imageHashes, layouts_published: true, layout_status: "EXPORTER_AUDIT_PENDING" }, null, 2)}\n`);
        const publication = publishRun({ runDir, legendRoot: root, destination, source: sourceAfter, guestBefore, guestAfter, pr, capturedAt });
        return { publication, captures: images };
      },
      archive: maintain,
      cleanup: () => run(["python3", "-I", cleanupScript, "--apply"], { env: { ...env, PLAYARR_SF_OUT: runDir } }),
      remove: removeValidatedPngs,
    });
    console.log(JSON.stringify({ ...result, run: "archived", status: "published captures and layout documents" }, null, 2));
  } catch (error) {
    if (captureAttempted) {
      throw new Error(`${error.message}; raw run retained in scratch: ${relative(scratch, runDir)}`);
    }
    throw error;
  } finally {
    if (!captureAttempted) rmSync(runDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  captureLegend().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
