#!/usr/bin/env node
// Writes clients.json maskRegions["player-controls"] from a capture-refs work dir: everything on the player page except the controls'
// boxes (video frame, differs per device) becomes a mask rect, same mechanism as calendar-link (legend update.mjs ignoreFor).
//   node player-mask.mjs <work dir> <clients.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const manifest = JSON.parse(readFileSync(new URL("./web-refs.json", import.meta.url), "utf8"));

// Complement of the union of `keep` rects inside [0,0,w,h], as rects.
export function complement(keep, w, h) {
  const ys = [...new Set([0, h, ...keep.flatMap(([, y, , rh]) => [y, y + rh]).map((v) => Math.min(Math.max(v, 0), h))])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const [y0, y1] = [ys[i], ys[i + 1]];
    const spans = keep.filter(([, y, , rh]) => y < y1 && y + rh > y0).map(([x, , rw]) => [Math.max(x, 0), Math.min(x + rw, w)]).sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [a, b] of spans) { if (a > x) out.push([x, y0, a - x, y1 - y0]); x = Math.max(x, b); }
    if (x < w) out.push([x, y0, w - x, y1 - y0]);
  }
  return out.map((r) => r.map((v) => Math.round(v * 10) / 10));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [work, clientsFile] = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(clientsFile, "utf8"));
  cfg.maskRegions ??= {};
  const masks = (cfg.maskRegions["player-controls"] = {});
  for (const [name, g] of Object.entries(manifest.groups)) {
    const keep = JSON.parse(readFileSync(join(work, name, "facts.json"), "utf8")).facts["dark/player-controls"].controlRects;
    if (!keep?.length) throw new Error(`${name}: no control rects`);
    for (const d of g.dirs) masks[d] = { vw: g.viewport[0], rects: complement(keep, g.viewport[0], g.viewport[1]) };
  }
  writeFileSync(clientsFile, JSON.stringify(cfg, null, 2));
}
