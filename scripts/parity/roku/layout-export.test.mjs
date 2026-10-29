import test from "node:test";
import assert from "node:assert/strict";
import { buildLayoutDocument } from "./layout-export.mjs";

const doc = (inner) => buildLayoutDocument(`<app-ui><MainScene>${inner}</MainScene></app-ui>`, { screen: "t", theme: "dark", clockPinned: true }).elements;

test("a later opaque fill hides what it covers, but not its own parent", () => {
  const els = doc(`
    <Rectangle bounds="{0, 0, 100, 100}" color="#101010ff" />
    <Rectangle bounds="{0, 0, 100, 100}" color="#202020ff" />
    <Group bounds="{0, 0, 50, 50}"><Rectangle bounds="{0, 0, 50, 50}" color="#303030ff" /></Group>`);
  assert.deepEqual(els.map((e) => e.background), ["#202020", "#303030"]);
});

test("a clipping rectangle cuts the box of what it holds", () => {
  const els = doc(`<Group clippingRect="{0, 0, 20, 20}"><Rectangle bounds="{0, 0, 50, 50}" color="#303030ff" /></Group>`);
  assert.deepEqual(els[0].rect, { x: 0, y: 0, w: 20, h: 20 });
});

test("text colour alpha is folded over the surface behind it", () => {
  const els = doc(`<Rectangle bounds="{0, 0, 100, 100}" color="#000000ff" /><Label name="f400s10~w" text="Hi" color="#ffffff80" bounds="{0, 0, 10, 12}" />`);
  assert.equal(els.find((e) => e.text === "Hi").color, "#808080");
});
