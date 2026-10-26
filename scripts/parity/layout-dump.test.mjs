import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { layoutPageFn, volatileFor } from "./layout-dump.mjs";

const exe = [process.env.PARITY_CHROME, "/usr/bin/chromium", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const skip = exe ? false : "no Chromium on this host";

// One page per rule; every visible element is a labelled button or a text span, so the names tell what survived.
const dump = async (body, volatile = []) => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#fff;font:16px sans-serif}.abs{position:absolute}</style>${body}`);
    return await page.evaluate(layoutPageFn, volatile);
  } finally { await browser.close(); }
};
const texts = (d) => d.elements.map((e) => e.text || `<${e.role}>`);

test("a textless, unstyled, unfocusable wrapper is dropped; styled ones and focusable controls stay", { skip }, async () => {
  const d = await dump(`<div><div><span>plain</span></div></div>
    <div class="abs" style="top:50px;width:40px;height:20px;background:#123456"></div>
    <div class="abs" style="top:80px;width:40px;height:20px;border:2px solid #f00"></div>
    <div class="abs" style="top:110px;width:40px;height:20px;box-shadow:0 0 4px #000"></div>
    <div class="abs" style="top:140px;width:40px;height:20px;border:2px solid transparent;background:rgba(0,0,0,0)"></div>
    <a class="abs" href="#x" style="top:170px;width:40px;height:20px" aria-label="Open Film"></a>`);
  assert.deepEqual(d.elements.map((e) => e.role), ["text", "container", "container", "container", "link"]);
  assert.equal(d.elements[4].text, "Open Film");
});

test("display none, visibility hidden, opacity 0 and clipped elements are dropped", { skip }, async () => {
  const d = await dump(`<span>shown</span><span style="display:none">gone1</span><span style="visibility:hidden">gone2</span>
    <span style="opacity:0">gone3</span><div style="width:50px;height:10px;overflow:hidden"><span class="abs" style="top:100px">gone4</span></div>
    <span class="abs" style="top:400px">gone5</span>`);
  assert.deepEqual(texts(d), ["shown"]);
});

test("screen-reader-only elements (1x1 clipped, clip rect 0, clip-path inset) are dropped; a normal heading stays", { skip }, async () => {
  const d = await dump(`<h1>October 2026</h1>
    <span class="abs" style="top:50px;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">sr1</span>
    <div class="abs" role="status" style="top:70px;width:1px;height:1px;overflow:hidden"><span>sr2 status text</span></div>
    <span class="abs" style="top:90px;clip-path:inset(50%)">sr3</span>`);
  assert.deepEqual(texts(d), ["October 2026"]);
});

test("inert hosts and aria-hidden hosts with focusable content are dropped; decorative aria-hidden stays", { skip }, async () => {
  const d = await dump(`<main inert><button>behind</button></main><main aria-hidden="true"><p>hidden page</p><a href="#">link</a></main>
    <button><span aria-hidden="true">+</span> Add</button>`);
  assert.deepEqual(texts(d), ["Add", "Add", "+"]);
});

test("elements fully covered by a drawer are dropped and counted; partly covered ones stay", { skip }, async () => {
  const d = await dump(`<span class="abs" style="left:10px;top:10px">behind</span><span class="abs" style="left:150px;top:10px">edge</span>
    <button class="abs" style="left:20px;top:50px;width:80px;height:20px">Open</button>
    <aside class="abs" style="left:0;top:0;width:160px;height:300px;background:#222"><span>Filters</span></aside>`);
  assert.deepEqual(texts(d).sort(), ["<container>", "Filters", "edge"]);
  assert.equal(d.occluded, 2);
});

test("a transparent click layer does not occlude", { skip }, async () => {
  const d = await dump(`<span class="abs" style="top:10px">title</span><a class="abs" href="#" style="top:0;left:0;width:200px;height:60px" aria-label="Open title"></a>`);
  assert.deepEqual(texts(d), ["title", "Open title"]);
  assert.equal(d.occluded, 0);
});

test("two dumps of the same page are identical", { skip }, async () => {
  const body = `<span>a</span><aside class="abs" style="top:0;left:0;width:100px;height:100px;background:#000"><b>x</b></aside><span class="abs" style="top:5px">hid</span>`;
  assert.deepEqual(await dump(body), await dump(body));
});

test("transparent text is not text; gradient-clipped text reports the first stop with colorGradient", { skip }, async () => {
  const d = await dump(`<p class="abs" style="top:0;color:transparent;background:#123456">skeleton</p>
    <p class="abs" style="top:40px;-webkit-text-fill-color:#ff0000;color:#00ff00">fill</p>
    <p class="abs" style="top:80px;color:transparent;background:linear-gradient(90deg,rgb(255,0,0),rgb(0,0,255));-webkit-background-clip:text;background-clip:text">grad</p>`);
  assert.deepEqual(d.elements.map((e) => [e.text, e.color]), [["", null], ["fill", "#ff0000"], ["grad", "#ff0000"]]);
  assert.equal(d.elements[2].colorGradient, true);
  assert.equal(d.elements[1].colorGradient, undefined);
});

test("the nav-rail app version is a volatile element with its box exported", { skip }, async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<span class="app-user-version" aria-hidden="true" style="position:absolute;top:10px;font-size:11px">v 0.1.0</span>`);
    const d = await page.evaluate(layoutPageFn, volatileFor("home"));
    assert.equal(d.elements.length, 1);
    assert.equal(d.elements[0].volatile, "app-version");
    assert.equal(d.elements[0].fontSize, 11);
  } finally { await browser.close(); }
});

test("a background identical to what is already behind it is not a visible fill", { skip }, async () => {
  const d = await dump(`<div class="abs" style="top:0;width:50px;height:20px;background:#fff"></div>
    <div class="abs" style="top:30px;width:50px;height:20px;background:#fefefe"></div>`);
  assert.deepEqual(d.elements.map((e) => e.background), ["#fefefe"]);
});

test("an aria-label on a painted container is not visible text; on a control it is the name", { skip }, async () => {
  const d = await dump(`<section aria-label="Movies titles" class="abs" style="top:0;width:80px;height:20px;background:#123456"></section>
    <a class="abs" href="#" aria-label="Open Film" style="top:30px;width:80px;height:20px"></a>`);
  assert.deepEqual(d.elements.map((e) => e.text), ["", "Open Film"]);
});

test("color-mix() (computed as color(srgb ...)) keeps its colour and alpha", { skip }, async () => {
  const d = await dump(`<div class="abs" style="top:0;width:50px;height:20px;background:color-mix(in srgb, #ff0000 50%, transparent)"></div>
    <p class="abs" style="top:40px;color:color-mix(in srgb, #0000ff 100%, #0000ff)">mix</p>`);
  assert.equal(d.elements[0].background, "#ff8080");
  assert.equal(d.elements[1].color, "#0000ff");
});

test("an omit entry is left out of the export", { skip }, async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<div class="player-seek-buffered" style="position:absolute;width:80px;height:6px;background:#575757"></div><span>keep</span>`);
    const d = await page.evaluate(layoutPageFn, volatileFor("player-controls"));
    assert.deepEqual(d.elements.map((e) => e.text), ["keep"]);
  } finally { await browser.close(); }
});

test("text-transform: the exported text is the displayed text", { skip }, async () => {
  const d = await dump(`<div style="text-transform:uppercase">up Case</div><div style="text-transform:lowercase">Low CASE</div>
    <div style="text-transform:capitalize">cap the 3rd word-x o'neil</div><div style="text-transform:none">No Change</div>
    <button style="text-transform:capitalize" aria-label="List View">list view</button>`);
  assert.deepEqual(texts(d), ["UP CASE", "low case", "Cap The 3rd Word-X O'neil", "No Change", "List View", "List View"]);
});

test("border-radius: a percentage resolves against the box and radii are capped at half the short side", { skip }, async () => {
  const d = await dump(`<button class="abs" aria-label="round" style="top:0;width:44px;height:44px;background:#123;border-radius:50%"></button>
    <button class="abs" aria-label="pill" style="top:60px;width:80px;height:20px;background:#123;border-radius:50%"></button>
    <button class="abs" aria-label="big" style="top:100px;width:40px;height:20px;background:#123;border-radius:999px"></button>
    <button class="abs" aria-label="px" style="top:140px;width:40px;height:40px;background:#123;border-radius:6px"></button>`);
  assert.deepEqual(d.elements.map((e) => e.radius), [22, 10, 10, 6]);
});

test("a wrapped paragraph is one element per rendered line, with glyph-run bounds", { skip }, async () => {
  const d = await dump(`<p style="width:120px;font:16px/20px monospace">alpha beta gamma delta</p>`);
  assert.deepEqual(texts(d), ["alpha beta", "gamma delta"]);
  assert.equal(d.elements[0].rect.h, d.elements[1].rect.h);
  assert.ok(d.elements[1].rect.y > d.elements[0].rect.y);
  assert.ok(d.elements[0].rect.w <= 120);
});

test("a volatile element exports its glyph run, not its box", { skip }, async () => {
  const d = await dump(`<div class="app-clock-time" style="width:200px;height:50px">12:00</div>`, volatileFor("home"));
  assert.equal(d.elements[0].volatile, "header-clock");
  assert.ok(d.elements[0].rect.w < 100 && d.elements[0].rect.h < 30);
});

test("adjacent text nodes are joined as rendered, with no inserted separator", { skip }, async () => {
  const d = await dump(`<p id="c"></p><script>const c = document.getElementById("c"); for (const s of ["S", "01", " · E", "01"]) c.append(document.createTextNode(s));</script>`);
  assert.deepEqual(texts(d), ["S01 · E01"]);
});

test("a control with its own text keeps its border box; the text is a separate glyph-run element", { skip }, async () => {
  const d = await dump(`<button class="abs" style="top:10px;left:10px;width:100px;height:44px;border:0;background:#123456;color:#fff;border-radius:8px">Today</button>`);
  assert.deepEqual(d.elements.map((e) => [e.role, e.text]), [["button", "Today"], ["text", "Today"]]);
  assert.deepEqual([d.elements[0].rect.w, d.elements[0].rect.h], [100, 44]);
  assert.ok(d.elements[1].rect.w < 100 && d.elements[1].rect.h < 44);
  assert.equal(d.elements[0].radius, 8);
  assert.equal(d.elements[0].color, null);
  assert.equal(d.elements[1].radius, undefined);
});

test("a volatile opacity is flagged, not exported", { skip }, async () => {
  const d = await dump(`<button class="abs" style="opacity:.5;width:80px;height:30px" aria-label="Audio: X">Audio: X</button>`, [{ name: "player-audio", selector: "button[aria-label^=Audio]", opacityVolatile: true }]);
  assert.equal(d.elements[0].opacity, undefined);
  assert.equal(d.elements[0].opacityVolatile, true);
  assert.equal(d.elements[0].rect.w, 80);
});

test("a volatile host keeps the real text style of its content and a control's accessible name", { skip }, async () => {
  const d = await dump(`<div class="app-clock-time" style="font:700 20px sans-serif;color:#ff0000"><span>12:00</span></div>
    <button class="abs" style="top:100px;font:600 12px sans-serif;color:#00ff00" aria-label="Audio: English"><svg width="10" height="10"></svg><span>1:00</span></button>`,
  [{ name: "header-clock", selector: ".app-clock-time" }, { name: "player-audio", selector: "button[aria-label^=Audio]" }]);
  assert.deepEqual([d.elements[0].color, d.elements[0].fontSize, d.elements[0].fontWeight], ["#ff0000", 20, 700]);
  assert.deepEqual([d.elements[1].role, d.elements[1].text, d.elements[1].color, d.elements[1].fontSize], ["button", "Audio: English", "#00ff00", 12]);
});

test("color-mix fills resolve to the painted colour (opaque, translucent over the page, nested var)", { skip }, async () => {
  const d = await dump(`<style>:root{--brand:#cf3157;--surface:#dfdcdd}</style>
    <div class="abs" style="top:0;width:40px;height:20px;background:color-mix(in srgb, var(--brand) 12%, var(--surface))"></div>
    <div class="abs" style="top:30px;width:40px;height:20px;background:color-mix(in srgb, #000000 50%, transparent)"></div>
    <div class="abs" style="top:60px;width:40px;height:20px;background:color-mix(in srgb, #ff0000 25%, #0000ff)"></div>`);
  assert.deepEqual(d.elements.map((e) => e.background), ["#ddc7cd", "#808080", "#4000bf"]);
});

test("text cut by text-overflow: ellipsis is exported as drawn (visible characters, ellipsis, clipped rect)", { skip }, async () => {
  const d = await dump(`<div style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:16px monospace">abcdefghijklmnop</div>
    <div style="width:300px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:16px monospace;margin-top:30px">fits</div>`);
  const cut = d.elements[0];
  // monospace 16px is 9.6 px per character: five characters (48 px) plus the ellipsis (9.6 px) fit in 60 px
  assert.equal(cut.text, "abcde…");
  assert.ok(cut.rect.x + cut.rect.w <= 60.01 && cut.rect.w > 50);
  assert.equal(d.elements[1].text, "fits");
});

test("a computed colour in another space (color-mix in oklab) resolves to sRGB", { skip }, async () => {
  const d = await dump(`<div class="abs" style="top:0;width:40px;height:20px;background:color-mix(in oklab, #ff0000 40%, #0000ff)"></div>`);
  assert.match(d.elements[0].background, /^#[0-9a-f]{6}$/);
  assert.notEqual(d.elements[0].background, "#ffffff");
});
