// usage: PARITY_ROOT=<parity scratch root> node score.mjs <dir> <dark|light>
// Per-screen % of matching pixels (pixelmatch 0.1) against the published web refs in <PARITY_ROOT>/postmarketos/web (player: compare regions only).
// <dir> holds <route>.png captures; 720x1440 captures are cropped to the 720x1346 ref window.
import { readFileSync, existsSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
const [dir, theme] = process.argv.slice(2);
if (!process.env.PARITY_ROOT || !dir || !["dark", "light"].includes(theme)) throw new Error("usage: PARITY_ROOT=<root> node score.mjs <dir> <dark|light>");
const R = `${process.env.PARITY_ROOT}/postmarketos/web/${theme === "light" ? "light/" : ""}`;
const map = { film: "film-detail", music: "music", series: "series", player: "player-controls", "series-detail": "series-detail", movies: "movies", home: "home", search: "search", filters: "filters", actions: "actions", "calendar-month": "calendar-month", "calendar-week": "calendar-week", "calendar-agenda": "calendar-agenda", settings: "settings", profiles: "profiles" };
const regions = [[0, 47, 390, 265], [0, 531, 390, 178], [0, 715, 390, 95]];
for (const [route, id] of Object.entries(map)) {
  const f = `${dir}/${route}.png`; if (!existsSync(f)) continue;
  const a = PNG.sync.read(readFileSync(R + id + ".png")); let b = PNG.sync.read(readFileSync(f));
  if (b.height !== a.height) { const c = new PNG({ width: a.width, height: a.height }); PNG.bitblt(b, c, 0, 64, a.width, a.height, 0, 0); b = c; }
  let area = a.width * a.height;
  if (id === "player-controls") {
    const keep = new Uint8Array(area);
    for (const [x, y, w, h] of regions) { const sx = a.width / 390, sy = a.height / 844;
      for (let j = Math.floor(y * sy); j < Math.min(a.height, Math.floor((y + h) * sy)); j++) keep.fill(1, j * a.width + Math.floor(x * sx), j * a.width + Math.min(a.width, Math.floor((x + w) * sx))); }
    area = keep.reduce((s, k) => s + k, 0);
    for (const p of [a, b]) for (let i = 0; i < keep.length; i++) if (!keep[i]) p.data.fill(0, i * 4, i * 4 + 4);
  }
  const bad = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  console.log(id.padEnd(16), theme, (100 - 100 * bad / area).toFixed(2));
}
