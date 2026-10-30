// Visibility of layout candidates decided on the real rendered screen (owner rule: never geometry alone).
// The app lists its candidates (x, y, w, h, paintOnly, view) and can hide the own pixels of a set of them (/hide, /unhide). A batch of candidates whose
// boxes do not touch is hidden, the emulator screen is grabbed again, and a candidate is kept only when pixels inside its own box changed. Pixels that
// also differ between two grabs of the unchanged screen are ignored.
import { PNG } from "pngjs";

const PAD = 3; // px of clear space between two candidates hidden together, so a shadow or antialiased edge of one never lands in another's box

/** Greedy batches of candidate indices whose padded boxes do not overlap (candidates of the same view never conflict: they hide together). */
export function planBatches(cands) {
  const batches = [];
  cands.forEach((c, index) => {
    const [x, y, w, h, , view] = c;
    for (const batch of batches) {
      const clash = batch.some((j) => {
        const [x2, y2, w2, h2, , view2] = cands[j];
        if (view2 === view) return false;
        return x - PAD < x2 + w2 && x2 - PAD < x + w && y - PAD < y2 + h2 && y2 - PAD < y + h;
      });
      if (!clash) { batch.push(index); return; }
    }
    batches.push([index]);
  });
  return batches;
}

export function decode(buffer) { return PNG.sync.read(buffer); }

/** Mask of pixels that differ between two decoded PNGs of the same size (any channel). */
export function diffMask(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error("occlusion grabs differ in size");
  const mask = new Uint8Array(a.width * a.height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (a.data[o] !== b.data[o] || a.data[o + 1] !== b.data[o + 1] || a.data[o + 2] !== b.data[o + 2]) mask[i] = 1;
  }
  return mask;
}

// A candidate counts as visible when hiding it moves some pixel of its box by at least this much on a channel (6 % of the range): a layer drawn
// under a 94 % opaque panel moves pixels by about 5 %, which nobody sees, so it is covered; real text, images and loud fills move them by far more.
export const VISIBLE_DELTA = 16;

/** True when the grab with the candidate hidden differs from the baseline inside its box, on pixels that are not unstable, by at least VISIBLE_DELTA. */
export function changedInside(rect, base, hidden, noise) {
  const x0 = Math.max(0, Math.floor(rect[0])), y0 = Math.max(0, Math.floor(rect[1]));
  const x1 = Math.min(base.width, Math.ceil(rect[0] + rect[2])), y1 = Math.min(base.height, Math.ceil(rect[1] + rect[3]));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * base.width + x;
      if (noise[i]) continue;
      const o = i * 4;
      if (Math.abs(base.data[o] - hidden.data[o]) >= VISIBLE_DELTA || Math.abs(base.data[o + 1] - hidden.data[o + 1]) >= VISIBLE_DELTA || Math.abs(base.data[o + 2] - hidden.data[o + 2]) >= VISIBLE_DELTA) return true;
    }
  }
  return false;
}

/** Count of pixels (outside the unstable mask) whose colour moved by more than 8 on any channel between two grabs of what should be the same screen. */
export function restoredDrift(base, after, noise) {
  let n = 0;
  for (let i = 0; i < noise.length; i++) {
    if (noise[i]) continue;
    const o = i * 4;
    if (Math.abs(base.data[o] - after.data[o]) > 8 || Math.abs(base.data[o + 1] - after.data[o + 1]) > 8 || Math.abs(base.data[o + 2] - after.data[o + 2]) > 8) n++;
  }
  return n;
}
