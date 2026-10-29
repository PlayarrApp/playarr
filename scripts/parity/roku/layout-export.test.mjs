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

test("loaded server artwork hides a surface and a label painted before it", () => {
  const body = (status) => doc(`<Rectangle bounds="{0, 0, 100, 60}" color="#312a30ff" /><Label name="f400s10~w" text="01" color="#ffffffff" bounds="{0, 0, 10, 12}" /><Poster uri="http://host/art.jpg" loadStatus="${status}" bounds="{0, 0, 100, 60}" />`);
  assert.equal(body("3").some((e) => e.text === "01" || e.role === "container"), false);
  assert.equal(body("1").some((e) => e.text === "01"), true);
});

test("a tail Label continues its word without a space", () => {
  const els = doc(`<Label name="f400s10~w" text="hel" bounds="{0, 0, 20, 12}" /><Label name="f400s10~t" text="lo" bounds="{25, 0, 8, 12}" /><Label name="f400s10~w" text="you" bounds="{40, 0, 20, 12}" />`);
  assert.equal(els[0].text, "hello you");
  assert.equal(els[0].rect.w, 60);
});
