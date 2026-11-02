// Aggregates perf-ab.sh output. Usage: node perf-agg.mjs <label=dir[:variant]>... ; writes JSON to stdout.
// Per iteration: janky % (frame time > 16.667 ms) and p50/p90/p99 of FrameCompleted - IntendedVsync from the framestats
// rows (flags 0 only, valid completion), then median, min and max across iterations for every metric.
import { readFileSync } from "node:fs";
const COL_FLAGS = 0, COL_INTENDED = 2, COL_COMPLETED = 17, VSYNC_MS = 1000 / 60;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const med = (a) => pct(a.filter((x) => x != null), 50);
const stat = (a) => { const v = a.filter((x) => x != null); return { median: med(v), p90: pct(v, 90), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, n: v.length }; };
export function summarise(dir, variant) {
  const rows = readFileSync(`${dir}/${variant}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const its = rows.map((r) => {
    let ft = [];
    try {
      ft = readFileSync(`${dir}/${r.frames}`, "utf8").split("\n").filter(Boolean).map((l) => l.split(",").map(Number))
        .filter((c) => c[COL_FLAGS] === 0 && c[COL_COMPLETED] > 0 && c[COL_COMPLETED] < 9e18)
        .map((c) => (c[COL_COMPLETED] - c[COL_INTENDED]) / 1e6);
    } catch {}
    // PERF_MEM_DUMP output (mem-<web|native>-<n>-app.playarr.mobile.txt): PSS of the ".apk mmap" row, which holds the Chromium WebView library
    // for the web arm; "other" is the summed PSS without it.
    let apk = null;
    try { apk = Number(readFileSync(`${dir}/mem-${r.variant.replace(/[AB]$/, "")}-${r.n}-app.playarr.mobile.txt`, "utf8").split("\n").find((l) => /^\s*\.apk mmap/.test(l)).trim().split(/\s+/)[2]); } catch {}
    return { ...r, apk_mmap_kb: apk, pss_other_kb: apk != null && r.pss_kb != null ? r.pss_kb - apk : null,
       frame_count: ft.length, janky_pct: ft.length ? (100 * ft.filter((x) => x > VSYNC_MS).length) / ft.length : null,
      p50_ms: pct(ft, 50), p90_ms: pct(ft, 90), p99_ms: pct(ft, 99) };
  });
  const m = {};
  for (const k of ["start_total_ms", "ready_ms", "pss_kb", "apk_mmap_kb", "pss_other_kb", "select_to_first_frame_ms", "janky_pct", "p50_ms", "p90_ms", "p99_ms", "frame_count"]) m[k] = stat(its.map((i) => i[k]));
  return { iterations: its, metrics: m };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = {};
  for (const a of process.argv.slice(2)) { const [label, rest] = a.split("="); const [dir, variant] = rest.split(":"); out[label] = summarise(dir, variant); }
  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
}
