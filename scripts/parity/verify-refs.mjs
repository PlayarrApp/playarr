// Verifies one captured group directory (<dir>/<dark|light>/<id>.png plus facts.json from capture-refs.mjs).
// Returns a list of problems; empty = good. Checks: size, theme by mean luminance, not blank, no loading placeholder, no
// unexpected dialog, signed in, fonts ready, no broken image, the pinned title on detail pages and in the actions drawer.
//   node verify-refs.mjs <group dir> <group name>
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

export function stats(file) {
  const p = PNG.sync.read(readFileSync(file));
  let sum = 0, min = 255, max = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const y = 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
    sum += y; if (y < min) min = y; if (y > max) max = y;
  }
  return { width: p.width, height: p.height, mean: sum / (p.data.length / 4), range: max - min };
}

export function verifyDir(dir, group, manifest, screens = manifest.screens) {
  const bad = [];
  const { facts } = JSON.parse(readFileSync(join(dir, "facts.json"), "utf8"));
  const means = {};
  for (const theme of ["dark", "light"]) for (const id of screens) {
    const k = `${theme}/${id}`, f = facts[k];
    let st;
    try { st = stats(join(dir, theme, `${id}.png`)); } catch { bad.push(`${k}: missing or unreadable PNG`); continue; }
    if (!f) { bad.push(`${k}: no page facts`); continue; }
    if (st.width !== group.pixels[0] || st.height !== group.pixels[1]) bad.push(`${k}: ${st.width}x${st.height}, expected ${group.pixels.join("x")}`);
    if (st.range < 40) bad.push(`${k}: blank (luminance range ${st.range.toFixed(0)})`);
    // Dark theme backgrounds are near black, light ones near white; dialogs and art shift the mean, so the bounds are loose.
    if (theme === "dark" && st.mean > 110) bad.push(`${k}: not dark (mean luminance ${st.mean.toFixed(0)})`);
    if (theme === "light" && st.mean < 130) bad.push(`${k}: not light (mean luminance ${st.mean.toFixed(0)})`);
    means[k] = st.mean;
    if (f.theme && f.theme !== theme) bad.push(`${k}: page theme is ${f.theme}`);
    if (id.endsWith("-detail") && f.resumeState) bad.push(`${k}: shows a Resume or Ask-again state (reset watch progress)`);
    if (f.signedOut) bad.push(`${k}: signed out`);
    if (f.skeletons) bad.push(`${k}: ${f.skeletons} loading placeholders`);
    if (f.brokenSrc?.length) bad.push(`${k}: ${f.brokenSrc.length} visible images not loaded`);
    if (f.placeholderCards) bad.push(`${k}: ${f.placeholderCards} cards without a loaded poster`);
    if (!f.fontsReady) bad.push(`${k}: fonts not loaded`);
    const wantDialog = manifest.dialogScreens.includes(id);
    if (wantDialog && !f.dialogs) bad.push(`${k}: expected an open panel`);
    if (!wantDialog && f.dialogs) bad.push(`${k}: unexpected dialog or drawer`);
    const title = id === "actions" ? group.actionsTitle ?? manifest.titles.actions : manifest.titles[id];
    if (title && id !== "actions" && f.detailTitle !== title) bad.push(`${k}: title "${f.detailTitle}", expected "${title}"`);
    if (id === "actions" && !(f.drawerTitle ?? "").includes(title)) bad.push(`${k}: drawer title "${f.drawerTitle}", expected "${title}"`);
  }
  for (const id of screens) if (means[`light/${id}`] <= means[`dark/${id}`] + 20) bad.push(`${id}: light is not lighter than dark`);
  return bad;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(join(here, "web-refs.json"), "utf8"));
  const bad = verifyDir(resolve(process.argv[2]), manifest.groups[process.argv[3]], manifest);
  bad.forEach((b) => console.log(`BAD ${b}`));
  console.log(bad.length ? `${bad.length} problems` : "all good");
  process.exit(bad.length ? 1 : 0);
}
