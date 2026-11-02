import test from "node:test";
import assert from "node:assert/strict";
import { buildLayoutDocument, httpAssetOpacity, httpImageUris, imageIsOpaque } from "./layout-export.mjs";

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

test("loaded server artwork hides a surface and a label painted before it only when the asset is opaque", () => {
  const xml = (status) => `<app-ui><MainScene><Rectangle bounds="{0, 0, 100, 60}" color="#312a30ff" /><Label name="f400s10~w" text="01" color="#ffffffff" bounds="{0, 0, 10, 12}" /><Poster uri="http://host/art.jpg" loadStatus="${status}" bounds="{0, 0, 100, 60}" /></MainScene></app-ui>`;
  const run = (status, opaque) => buildLayoutDocument(xml(status), { screen: "t", theme: "dark", clockPinned: true, assetOpacity: new Map([["http://host/art.jpg", opaque]]) }).elements;
  assert.equal(run("3", true).some((e) => e.text === "01" || e.role === "container"), false);
  assert.equal(run("1", true).some((e) => e.text === "01"), true);
  assert.equal(run("3", false).some((e) => e.text === "01"), true);
});

test("asset opacity is read from the image bytes", async () => {
  const { PNG } = await import("pngjs");
  const png = (alpha) => { const p = new PNG({ width: 2, height: 2 }); p.data.fill(255); p.data[7] = alpha; return new Uint8Array(PNG.sync.write(p)); };
  assert.equal(imageIsOpaque(new Uint8Array([0xff, 0xd8, 0xff])), true);
  assert.equal(imageIsOpaque(png(255)), true);
  assert.equal(imageIsOpaque(png(200)), false);
  assert.equal(imageIsOpaque(new Uint8Array([1, 2, 3])), false);
  const xml = `<Poster uri="http://h/a?x=1&amp;y=2" /><Poster uri="pkg:/images/a.png" />`;
  assert.deepEqual(httpImageUris(xml), ["http://h/a?x=1&y=2"]);
  const got = await httpAssetOpacity(xml, async (u) => ({ ok: u === "http://h/a?x=1&y=2", arrayBuffer: async () => new Uint8Array([0xff, 0xd8]).buffer }));
  assert.equal(got.get("http://h/a?x=1&y=2"), true);
});

test("a tail Label continues its word without a space", () => {
  const els = doc(`<Label name="f400s10~w" text="hel" bounds="{0, 0, 20, 12}" /><Label name="f400s10~t" text="lo" bounds="{25, 0, 8, 12}" /><Label name="f400s10~w_" text="you" bounds="{40, 0, 20, 12}" />`);
  assert.equal(els[0].text, "hello you");
  assert.equal(els[0].rect.w, 60);
});

test("a gap between Labels is never read as a space; only the app's stamp is", () => {
  const els = doc(`<Label name="f400s10~c" text="a" bounds="{0, 0, 5, 12}" /><Label name="f400s10~c" text="b" bounds="{40, 0, 5, 12}" />`);
  assert.equal(els[0].text, "ab");
});

test("a transparent Rectangle that only carries an a11y stamp is not a row", () => {
  const els = doc(`<Rectangle name="a11y|link|0|Open X" bounds="{0, 0, 100, 60}" color="#00000000" /><Rectangle name="a11y|container|0|" bounds="{0, 0, 50, 50}" color="#00000000" />`);
  assert.equal(els.length, 0);
});

test("the hit rectangle of a control is a row, a hit rectangle of a non-control is not", () => {
  const els = doc(`<Rectangle name="hit|button|12|Filters" bounds="{0, 0, 62, 72}" color="#00000000" /><Rectangle name="hit|container|0|" bounds="{0, 0, 50, 50}" color="#00000000" />`);
  assert.deepEqual(els.map((e) => [e.role, e.text]), [["button", "Filters"]]);
});

test("a painted node or a group carries its semantics at its measured bounds", () => {
  const els = doc(`<Group name="a11y|link|0|Open Y" bounds="{10, 20, 300, 200}"><Rectangle bounds="{10, 20, 300, 180}" color="#312a30ff" /></Group>`);
  const link = els.find((e) => e.role === "link");
  assert.deepEqual(link.rect, { x: 10, y: 20, w: 300, h: 180 });
});

test("a link ignores hidden children that the device counts in its bounds", () => {
  const els = doc(`<Group name="a11y|link|0|Open Z" bounds="{7, 17, 306, 206}"><Rectangle bounds="{10, 20, 300, 180}" color="#312a30ff" /><Poster visible="false" uri="pkg:/images/ring.png" bounds="{7, 17, 306, 186}" /></Group>`);
  assert.deepEqual(els.find((e) => e.role === "link").rect, { x: 10, y: 20, w: 300, h: 180 });
});

test("a small video plane hides nothing, a full-screen one hides what came before", () => {
  const small = doc(`<Rectangle bounds="{0, 0, 10, 10}" color="#101010ff" /><Video bounds="{0, 0, 640, 360}" />`);
  assert.equal(small.some((e) => e.role === "container"), true);
  const full = buildLayoutDocument(`<app-ui><MainScene><Rectangle bounds="{0, 0, 10, 10}" color="#101010ff" /><Video bounds="{0, 0, 1920, 1080}" /></MainScene></app-ui>`, { screen: "t", theme: "dark", clockPinned: true });
  assert.equal(full.elements.some((e) => e.role === "container"), false);
  assert.equal(full.occluded, 1);
});

test("a childless Rectangle that paints the colour already behind it is not a fill, a different colour or a parent is", () => {
  const els = doc(`
    <Rectangle bounds="{0, 0, 100, 100}" color="#101010ff" />
    <Rectangle bounds="{0, 0, 100, 100}" color="#101010ff" />
    <Rectangle bounds="{10, 10, 20, 20}" color="#202020ff" />
    <Rectangle bounds="{40, 40, 20, 20}" color="#202020ff"><Rectangle bounds="{40, 40, 5, 5}" color="#303030ff" /></Rectangle>`);
  assert.deepEqual(els.filter((e) => e.role === "container").map((e) => [e.rect.x, e.background]), [[0, "#101010"], [10, "#202020"], [40, "#202020"], [40, "#303030"]]);
});

test("a same-colour Rectangle that is not exported still hides what lies beneath it", () => {
  const els = doc(`
    <Rectangle bounds="{0, 0, 100, 100}" color="#101010ff" />
    <Rectangle bounds="{10, 10, 5, 5}" color="#202020ff" />
    <Rectangle bounds="{0, 0, 100, 100}" color="#101010ff" />`);
  assert.deepEqual(els.filter((e) => e.role === "container").map((e) => e.rect.x), [0]);
});
