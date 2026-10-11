// Regenerates res/icons/*.svg from the web nav icons (clients/tv-web/web/src/components/NavIcons.tsx), the design source.
// Strokes are white: the NUI ImageView tints them with its Color (multiply), so one file serves every colour and theme.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../../tv-web/web/src/components/NavIcons.tsx"), "utf8");
const out = join(here, "../src/Playarr.Tizen/res/icons");
mkdirSync(out, { recursive: true });
const re = /export function (\w+)Icon\([^)]*\) \{\s*return \(\s*<svg \{\.\.\.ICON_PROPS\} className=\{className\}>([\s\S]*?)<\/svg>/g;
let m, n = 0;
while ((m = re.exec(src))) {
  const body = m[2].replace(/fill="currentColor"/g, 'fill="#fff"').replace(/stroke="none"/g, 'stroke="none"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body.replace(/\s*\n\s*/g, "")}</svg>\n`;
  writeFileSync(join(out, m[1].toLowerCase() + ".svg"), svg);
  n++;
}
console.log(`wrote ${n} icons`);
