import test from "node:test";
import assert from "node:assert/strict";
import { insideAncestorClips } from "./drivers/tizen-webos.mjs";

const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const node = (rect, overflow, parentElement = null) => ({ rect, overflow, parentElement, getBoundingClientRect: () => rect });
const win = (root) => ({ document: { documentElement: root }, getComputedStyle: (n) => ({ overflowX: n.overflow, overflowY: n.overflow }) });

test("an image below a scrolling column's edge is clipped", () => {
  const root = node(box(0, 0, 1920, 1080), "visible");
  const column = node(box(1090, 180, 1500, 920), "auto", root);
  const img = { getBoundingClientRect: () => box(1090, 955, 1130, 1015), parentElement: column };
  assert.equal(insideAncestorClips(img, win(root)), false);
});

test("an image inside the column is kept, and partly clipped counts as visible", () => {
  const root = node(box(0, 0, 1920, 1080), "visible");
  const column = node(box(1090, 180, 1500, 920), "hidden", root);
  const inside = { getBoundingClientRect: () => box(1090, 834, 1130, 894), parentElement: column };
  const edge = { getBoundingClientRect: () => box(1090, 900, 1130, 960), parentElement: column };
  assert.equal(insideAncestorClips(inside, win(root)), true);
  assert.equal(insideAncestorClips(edge, win(root)), true);
});
