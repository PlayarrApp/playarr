import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { layoutPageFn, volatileFor } from "./layout-dump.mjs";

const exe = [process.env.PARITY_CHROME, "/usr/bin/chromium", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const skip = exe ? false : "no Chromium on this host";

// One page per rule; every visible element is a labelled button or a text span, so the names tell what survived.
const dump = async (body) => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#fff;font:16px sans-serif}.abs{position:absolute}</style>${body}`);
    return await page.evaluate(layoutPageFn, []);
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

test("inert hosts and aria-hidden hosts with focusable content are dropped; decorative aria-hidden stays", { skip }, async () => {
  const d = await dump(`<main inert><button>behind</button></main><main aria-hidden="true"><p>hidden page</p><a href="#">link</a></main>
    <button><span aria-hidden="true">+</span> Add</button>`);
  assert.deepEqual(texts(d), ["Add", "+"]);
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
