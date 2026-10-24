import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { parseCaptureLayout } from "../drivers/apple-ios.mjs";
import { loadExclusions, scoreLayout } from "../layout-score.mjs";

export const deviceDirectories = { iphone: "ios-phone", ipad: "ios-tablet" };
const themes = ["dark", "light"];
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Read and validate the downloaded run before replacing anything in the active candidate. */
export function inspectRun({ work, device, sha, screens, legendRoot }) {
  const client = deviceDirectories[device];
  if (!client) throw new Error(`Unsupported iOS device: ${device}`);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("The capture SHA must contain 40 hexadecimal characters");
  const manifest = { device, sha, themes: {} };
  const exclusions = loadExclusions();
  for (const theme of themes) {
    const artifact = join(work, theme);
    const buildPath = join(artifact, "build.json");
    const build = existsSync(buildPath) ? json(buildPath) : null;
    if (build && (build.sha !== sha || !Number.isFinite(Date.parse(build.captured_at)))) {
      throw new Error(`${device}/${theme}: artifact provenance does not match the requested capture`);
    }
    const rows = screens.map((screen) => {
      if (!/^[a-z0-9-]+$/.test(screen)) throw new Error(`Invalid screen: ${screen}`);
      const png = join(artifact, theme, `${screen}.png`);
      const layout = join(artifact, "layout", theme, `${screen}.json`);
      const row = { screen, png: existsSync(png), layout: existsSync(layout) };
      if ((row.png || row.layout) && !build) throw new Error(`${device}/${theme}: capture has no build provenance`);
      if (row.png) row.pngSha256 = hash(png);
      if (row.layout) {
        const measured = parseCaptureLayout(readFileSync(layout, "utf8"), { screen, theme, deterministic: true });
        const reference = json(join(legendRoot, client, "web", "layout", theme, `${screen}.json`));
        if (measured.viewport.w !== reference.viewport.w || measured.viewport.h !== reference.viewport.h) {
          throw new Error(`${device}/${theme}/${screen}: native viewport does not match the reference`);
        }
        row.layoutSha256 = hash(layout);
        row.score = scoreLayout(reference, measured, { client, exclusions });
      }
      return row;
    });
    manifest.themes[theme] = { captured_at: build?.captured_at ?? null, rows };
  }
  save(join(work, "publication.json"), manifest);
  return manifest;
}

/** Preserve the previous JSON, then remove its active pairs so missing captures stay visibly missing. */
export function publishRun({ work, legendRoot, device, sha, branch, pr, run, manifest }) {
  const client = deviceDirectories[device];
  if (!client || manifest.device !== device || manifest.sha !== sha) throw new Error("Publication manifest does not match this run");
  if (!Number.isSafeInteger(run) || run <= 0 || !Number.isSafeInteger(pr) || pr <= 0) throw new Error("A run and PR number are required");
  const candidate = join(legendRoot, client, "dev");
  // Verify all inputs before removing any active pair.
  for (const theme of themes) for (const row of manifest.themes[theme].rows) {
    for (const kind of ["png", "layout"]) {
      if (!row[kind]) continue;
      const source = kind === "png" ? join(work, theme, theme, `${row.screen}.png`) : join(work, theme, "layout", theme, `${row.screen}.json`);
      if (hash(source) !== row[kind === "png" ? "pngSha256" : "layoutSha256"]) throw new Error(`Capture changed after inspection: ${theme}/${row.screen}`);
    }
  }
  // Only the two active image folders and their layout folders belong to this publication.
  for (const relative of ["", "light", "layout/dark", "layout/light"]) {
    const folder = join(candidate, relative);
    mkdirSync(folder, { recursive: true });
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const source = join(folder, entry.name);
      if (entry.name.endsWith(".json")) {
        const retired = join(work, "previous-json", relative, entry.name);
        mkdirSync(dirname(retired), { recursive: true });
        if (existsSync(retired)) {
          // A resumed publication must not overwrite the evidence from the preceding run.
          save(join(work, "previous-json", hash(source), relative, entry.name), json(source));
        } else copyFileSync(source, retired);
        unlinkSync(source);
      } else if (/\.(png|jpe?g|mp4|gif)$/i.test(entry.name)) unlinkSync(source);
    }
  }
  for (const theme of themes) {
    const artifact = join(work, theme);
    for (const row of manifest.themes[theme].rows) {
      for (const kind of ["png", "layout"]) {
        if (!row[kind]) continue;
        const relative = kind === "png" ? join(theme === "dark" ? "" : theme, `${row.screen}.png`) : join("layout", theme, `${row.screen}.json`);
        const source = kind === "png" ? join(artifact, theme, `${row.screen}.png`) : join(artifact, "layout", theme, `${row.screen}.json`);
        copyFileSync(source, join(candidate, relative));
      }
    }
    save(join(candidate, theme === "dark" ? "" : theme, "build.json"), {
      branch, sha, pr, run, captured_at: manifest.themes[theme].captured_at,
      runner: "github-hosted", server: "static server", coverage: manifest.themes[theme].rows.map(({ score, ...row }) => row),
    });
  }
  return candidate;
}

/** The copied images remain in the legend; downloaded images are temporary. Keep all JSON evidence. */
export function removeDownloadedImages(folder) {
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) removeDownloadedImages(path);
    else if (entry.isFile() && /\.(png|jpe?g|mp4|gif)$/i.test(entry.name)) unlinkSync(path);
  }
}
