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
