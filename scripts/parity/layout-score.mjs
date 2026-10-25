#!/usr/bin/env node
// Deterministic layout score (docs/parity/LAYOUT.md).
//   node layout-score.mjs --ref <web layout json> --device <device layout json> [--client <legend dir>] [--exclusions <json>] [--json] [--max 40]
// score = web elements that matched a device element with every field inside tolerance / scored web elements.
// Self-contained on purpose: the legend service keeps a copy of this single file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOL = Object.freeze({ edge: 1, deltaE: 2, fontSize: 0.5, fontWeight: 50, radius: 1, opacity: 0.05 });
const FIXTURE_CLOCK = "2026-10-07T12:00:00Z";

const normText = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const round = (n) => Math.round(n * 100) / 100;

function parseHex(h) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(h ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
}
function lab([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIE76 distance between two hex colours; a translucent colour is composited over `under` first. */
export function deltaE(a, b, under = "#ffffff") {
  const pa = parseHex(a), pb = parseHex(b), bg = parseHex(under) ?? [255, 255, 255, 1];
  if (!pa || !pb) return a === b ? 0 : Infinity;
  const flat = (c) => [0, 1, 2].map((i) => c[i] * c[3] + bg[i] * (1 - c[3]));
  const [l1, l2] = [lab(flat(pa)), lab(flat(pb))];
  return Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2]);
}

/** Per-client exclusions (layout-exclusions.json, docs/parity/LAYOUT.md): documented capability gaps only. Every entry needs reason and doc. */
export function loadExclusions(path = join(dirname(fileURLToPath(import.meta.url)), "layout-exclusions.json")) {
  const table = JSON.parse(readFileSync(path, "utf8"));
  for (const [client, list] of Object.entries(table)) {
    if (client.startsWith("$")) continue;
    for (const x of list) {
      const m = x.match ?? {};
      if (!x.screen || !x.reason || !/^\S+#\S+$/.test(x.doc ?? "") || !(m.text || m.textPrefix || m.textRegex)) throw new Error(`layout-exclusions: bad entry for ${client}: ${JSON.stringify(x)}`);
    }
  }
  return table;
}
const matchesExclusion = (x, e) => {
  const m = x.match, t = normText(e.text);
  return (m.role === undefined || m.role === e.role) && (m.text === undefined || t === normText(m.text)) &&
    (m.textPrefix === undefined || t.startsWith(m.textPrefix)) && (m.textRegex === undefined || new RegExp(m.textRegex).test(t));
};

const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const iou = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
};
const dist = (a, b) => { const [p, q] = [center(a), center(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1]); };

/** Field-by-field comparison of one matched pair; returns the list of differences. */
function compare(w, d, { scoreText, edge = TOL.edge }) {
  const out = [];
  const diff = (field, ref, dev, delta) => out.push({ field, ref, device: dev, delta: round(delta) });
  if (scoreText && normText(w.text) !== normText(d.text)) diff("text", w.text, d.text, 0);
  if (w.role !== d.role) diff("role", w.role, d.role, 0);
  for (const [name, a, b] of [["left", w.rect.x, d.rect.x], ["top", w.rect.y, d.rect.y], ["right", w.rect.x + w.rect.w, d.rect.x + d.rect.w], ["bottom", w.rect.y + w.rect.h, d.rect.y + d.rect.h]]) {
    if (Math.abs(a - b) > edge) diff(`rect.${name}`, round(a), round(b), b - a);
  }
  if (w.background != null) {
    const e = deltaE(w.background, d.background ?? "");
    if (e > TOL.deltaE) diff("background", w.background, d.background ?? null, e);
  }
  if (w.color != null) {
    const e = deltaE(w.color, d.color ?? "", w.background ?? "#ffffff");
    if (e > TOL.deltaE) diff("color", w.color, d.color ?? null, e);
  }
  if (w.fontSize != null && !(Math.abs(w.fontSize - (d.fontSize ?? NaN)) <= TOL.fontSize)) diff("fontSize", w.fontSize, d.fontSize ?? null, (d.fontSize ?? 0) - w.fontSize);
  if (w.fontWeight != null && !(Math.abs(w.fontWeight - (d.fontWeight ?? NaN)) <= TOL.fontWeight)) diff("fontWeight", w.fontWeight, d.fontWeight ?? null, (d.fontWeight ?? 0) - w.fontWeight);
  // a radius on an element that draws nothing (no fill, border, shadow) cannot be seen, so a native control cannot report it
  if (w.painted !== false && ((w.radius ?? 0) > 0 || (d.radius ?? 0) > 0)) {
    if (Math.abs((w.radius ?? 0) - (d.radius ?? 0)) > TOL.radius) diff("radius", w.radius ?? 0, d.radius ?? 0, (d.radius ?? 0) - (w.radius ?? 0));
  }
  if (Math.abs((w.opacity ?? 1) - (d.opacity ?? 1)) > TOL.opacity) diff("opacity", w.opacity ?? 1, d.opacity ?? 1, (d.opacity ?? 1) - (w.opacity ?? 1));
  return out;
}

/** Score `device` against the web layout `ref`. Pure and deterministic: same inputs, same output. */
export function scoreLayout(ref, device, { edge = TOL.edge, client, exclusions } = {}) {
  const clockPinned = device.clockPinned === true;
  // "system" elements are OS chrome (status bar, home indicator): never matched, never reported.
  const dev = device.elements.map((e, i) => ({ ...e, i })).filter((e) => e.role !== "system");
  const taken = new Set();
  const web = ref.elements.map((e, i) => ({ ...e, i }));
  // Excluded web elements leave the denominator; every other element keeps its web position and is scored as before.
  const rules = client && exclusions ? (exclusions[client] ?? []).filter((x) => x.screen === "*" || x.screen === ref.screen) : [];
  const excluded = [];
  const scored = web.filter((e) => {
    if (e.maskOnly) return false;
    const x = rules.find((r) => matchesExclusion(r, e));
    if (x) excluded.push({ text: e.text, role: e.role, rect: e.rect, reason: x.reason, doc: x.doc });
    return !x;
  });
  const pairs = new Map();
  const pick = (w, ok, rank) => {
    let best = null;
    for (const d of dev) {
      if (taken.has(d.i) || !ok(d)) continue;
      const r = rank(d);
      if (best === null || r < best.r) best = { d, r };
    }
    if (best) { taken.add(best.d.i); pairs.set(w.i, best.d); }
  };
  const isVolatileText = (w) => w.volatile && !(w.clock && clockPinned);
  // 1. normalised text + role, nearest rect.
  for (const w of scored) {
    const t = normText(w.text);
    if (t && !isVolatileText(w)) pick(w, (d) => d.role === w.role && normText(d.text) === t, (d) => dist(w.rect, d.rect));
  }
  // 2. same text, another role (reported as a role difference).
  for (const w of scored) {
    const t = normText(w.text);
    if (t && !pairs.has(w.i) && !isVolatileText(w)) pick(w, (d) => normText(d.text) === t, (d) => dist(w.rect, d.rect));
  }
  // 3. textless and volatile elements: same role, best overlap. 4. text elements whose text differs: same role, best overlap (text reported).
  const overlap = (w) => (d) => d.role === w.role && iou(w.rect, d.rect) > 0;
  const byOverlap = (w) => (d) => 1 - iou(w.rect, d.rect);
  for (const w of scored) if (!pairs.has(w.i) && (!normText(w.text) || isVolatileText(w))) pick(w, overlap(w), byOverlap(w));
  for (const w of scored) if (!pairs.has(w.i)) pick(w, overlap(w), byOverlap(w));

  const failures = [];
  let equal = 0;
  const clockSeen = [];
  for (const w of scored) {
    const d = pairs.get(w.i);
    const brief = { text: w.text, role: w.role, rect: w.rect, ...(w.volatile ? { volatile: w.volatile } : {}) };
    if (!d) { failures.push({ ref: brief, device: null, problems: [{ field: "missing", ref: null, device: null, delta: 0 }] }); continue; }
    const scoreText = !isVolatileText(w);
    if (w.clock) clockSeen.push(normText(w.text) === normText(d.text));
    const problems = compare(w, d, { scoreText, edge });
    if (problems.length) failures.push({ ref: brief, device: { text: d.text, role: d.role, rect: d.rect }, problems });
    else equal += 1;
  }
  const total = scored.length;
  return {
    screen: ref.screen, theme: ref.theme,
    score: total ? round((100 * equal) / total) : 0,
    total, matched: pairs.size, equal,
    clock: { pinned: clockPinned, equalsFixture: clockSeen.length ? clockSeen.every(Boolean) : null, fixture: FIXTURE_CLOCK },
    extras: dev.length - pairs.size,
    occluded: ref.occluded ?? 0,
    excluded,
    failures,
  };
}

export const formatReport = (r, max = 40) => {
  const lines = [`${r.screen}/${r.theme}: layout ${r.score}% (${r.equal}/${r.total} equal, ${r.matched} matched, ${r.extras} extra device elements, ${r.occluded} occluded web elements dropped, ${(r.excluded ?? []).length} excluded); clock pinned ${r.clock.pinned}, equals fixture ${r.clock.equalsFixture}`];
  for (const x of r.excluded ?? []) lines.push(`  excluded ${x.role} "${String(x.text).slice(0, 40)}": ${x.reason} (${x.doc})`);
  for (const f of r.failures.slice(0, max)) {
    const rc = f.ref.rect;
    lines.push(`  ${f.ref.role} "${String(f.ref.text).slice(0, 40)}" @${rc.x},${rc.y} ${rc.w}x${rc.h}${f.device ? "" : "  NOT FOUND ON DEVICE"}`);
    for (const p of f.problems.filter((q) => q.field !== "missing")) lines.push(`    ${p.field}: web ${JSON.stringify(p.ref)} device ${JSON.stringify(p.device)}${p.delta ? ` (delta ${p.delta})` : ""}`);
  }
  if (r.failures.length > max) lines.push(`  ... ${r.failures.length - max} more (use --max)`);
  return lines.join("\n");
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  if (!opt("ref") || !opt("device")) { console.error("usage: layout-score.mjs --ref <web json> --device <device json> [--client <dir>] [--exclusions <json>] [--json] [--max N]"); process.exit(2); }
  const client = opt("client");
  const result = scoreLayout(JSON.parse(readFileSync(opt("ref"), "utf8")), JSON.parse(readFileSync(opt("device"), "utf8")), client ? { client, exclusions: loadExclusions(opt("exclusions")) } : {});
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatReport(result, Number(opt("max") ?? 40)));
}
