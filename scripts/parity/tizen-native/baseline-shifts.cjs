// node dytable.cjs <cand dir> <ref dir> <dom dir> screens... : per-element best vertical/horizontal shift of native text vs web, grouped by font size
const { createRequire } = require("module"); const r = createRequire(require("path").resolve(__dirname, "../package.json")); // pngjs comes from scripts/parity
const { PNG } = r("pngjs"); const fs = require("fs");
const [cand, ref, dom, ...screens] = process.argv.slice(2); const bySize = {};
for (const s of screens) {
  const A = PNG.sync.read(fs.readFileSync(`${ref}/${s}.png`)), B = PNG.sync.read(fs.readFileSync(`${cand}/dark/${s}.png`));
  const L = (im, x, y) => { const k = (y * im.width + x) * 4; return 0.3 * im.data[k] + 0.59 * im.data[k+1] + 0.11 * im.data[k+2]; };
  for (const e of JSON.parse(fs.readFileSync(`${dom}/dark-${s}.json`, "utf8"))) {
    if (!e.text || !e.font || e.w < 20 || e.h < 6 || e.x < 0 || e.y < 0 || e.x + e.w > 1919 || e.y + e.h > 1079) continue;
    const size = +e.font.split(" ")[1].split("/")[0].replace("px", ""); const x0 = Math.floor(e.x), y0 = Math.floor(e.y), w = Math.min(Math.ceil(e.w), 400), h = Math.ceil(Math.min(e.h, size * 1.6));
    let best = null, zero = 0;
    for (let dy = -3; dy <= 3.001; dy += 0.25) { let err = 0; const fl = Math.floor(dy), fr = dy - fl; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (y + fl < 0 || y + fl + 1 > 1079) continue; const b = L(B, x, y + fl) * (1 - fr) + L(B, x, y + fl + 1) * fr; err += Math.abs(L(A, x, y) - b); } err /= w * h; if (dy === 0) zero = err; if (!best || err < best[1]) best = [dy, err]; }
    (bySize[size] ??= []).push({ s, t: e.text.slice(0, 18), dy: best[0], gain: zero - best[1], zero });
  }
}
for (const size of Object.keys(bySize).map(Number).sort((a, b) => a - b)) { const v = bySize[size]; const dys = v.map((x) => x.dy).sort((a, b) => a - b); const med = dys[dys.length >> 1]; const hist = { med, n: dys.length }; console.log(String(size).padStart(7), JSON.stringify(hist), v.slice(0, 2).map((x) => x.t).join(" | ")); }
