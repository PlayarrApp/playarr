// Exact pixel compare (owner 2026-10-31, zero tolerance): a pixel matches only when all four RGBA bytes are identical.
// No pixelmatch: its threshold and anti-alias skip, and its alpha blend against white, can call differing bytes equal.
export function countDiff(a, b, width, height) {
  const n = width * height;
  if (a.length < n * 4 || b.length < n * 4) throw new Error("exact-pixels: buffer shorter than width*height*4");
  const u = (x) => (x.byteOffset % 4 === 0 ? new Uint32Array(x.buffer, x.byteOffset, n) : new Uint32Array(Uint8Array.from(x.subarray(0, n * 4)).buffer));
  const p = u(a), q = u(b);
  let bad = 0;
  for (let i = 0; i < n; i++) if (p[i] !== q[i]) bad++;
  return bad;
}

// Same exact compare, also painting a diff image: mismatched pixels pure red, matching ones a faded copy of the first image. Returns the mismatch count.
export function diffInto(a, b, out, width, height) {
  const n = width * height;
  const bad = countDiff(a, b, width, height);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const same = a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3];
    out[o] = same ? Math.round(a[o] * 0.2 + 204) : 255;
    out[o + 1] = same ? Math.round(a[o + 1] * 0.2 + 204) : 0;
    out[o + 2] = same ? Math.round(a[o + 2] * 0.2 + 204) : 0;
    out[o + 3] = 255;
  }
  return bad;
}
