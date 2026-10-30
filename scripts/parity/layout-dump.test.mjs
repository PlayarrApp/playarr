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

test("a volatile host exports every visible descendant with its own style, the icon included, and a control's accessible name", { skip }, async () => {
  const d = await dump(`<div class="app-clock-time" style="font:700 20px sans-serif;color:#ff0000"><span>12:00</span><span style="font-size:10px;color:#00ff00">/</span></div>
    <button class="abs" style="top:100px;font:600 12px sans-serif;color:#00ff00" aria-label="Audio: English"><svg width="10" height="10"></svg><span>1:00</span></button>`,
  [{ name: "header-clock", selector: ".app-clock-time" }, { name: "player-audio", selector: "button[aria-label^=Audio]" }]);
  const by = (t) => d.elements.find((e) => e.text === t);
  assert.deepEqual([by("12:00").color, by("12:00").fontSize, by("12:00").fontWeight, by("12:00").volatile], ["#ff0000", 20, 700, "header-clock"]);
  assert.deepEqual([by("/").color, by("/").fontSize], ["#00ff00", 10]);
  assert.deepEqual([by("Audio: English").role, by("Audio: English").fontSize], ["button", null]);
  assert.ok(d.elements.some((e) => e.role === "image" && e.volatile === "player-audio"), "the icon is exported");
  assert.deepEqual([by("1:00").color, by("1:00").fontSize], ["#00ff00", 12]);
});

test("a pointer-events:none subject under an opaque layer is occluded; a transparent hit layer does not hide the opaque one below", { skip }, async () => {
  const d = await dump(`<span class="abs" style="left:10px;top:10px;pointer-events:none">under</span><span class="abs" style="left:10px;top:60px">below</span>
    <aside class="abs" style="left:0;top:0;width:200px;height:100px;background:#222"></aside>
    <a class="abs" href="#" style="left:0;top:0;width:200px;height:100px" aria-label="Layer"></a>`);
  assert.deepEqual(texts(d).sort(), ["<container>", "Layer"]);
  assert.equal(d.occluded, 2);
});

test("a line hidden by the element's own overflow is dropped", { skip }, async () => {
  const d = await dump(`<p style="width:60px;height:20px;overflow:hidden;font:16px monospace;line-height:40px">aaaa bbbb cccc</p>`);
  assert.deepEqual(texts(d), ["aaaa"]);
});

test("a hidden element between text nodes adds no separator", { skip }, async () => {
  const d = await dump(`<div><span id="k"></span></div><script>const k = document.getElementById("k").parentElement; const h = document.createElement("i"); h.style.display = "none"; k.replaceChildren(document.createTextNode("Released"), h, document.createTextNode("1 Jun 1998"));</script>`);
  assert.deepEqual(texts(d), ["Released1 Jun 1998"]);
});

test("color-mix fills resolve to the painted colour (opaque, translucent over the page, nested var)", { skip }, async () => {
  const d = await dump(`<style>:root{--brand:#cf3157;--surface:#dfdcdd}</style>
    <div class="abs" style="top:0;width:40px;height:20px;background:color-mix(in srgb, var(--brand) 12%, var(--surface))"></div>
    <div class="abs" style="top:30px;width:40px;height:20px;background:color-mix(in srgb, #000000 50%, transparent)"></div>
    <div class="abs" style="top:60px;width:40px;height:20px;background:color-mix(in srgb, #ff0000 25%, #0000ff)"></div>`);
  assert.deepEqual(d.elements.map((e) => e.background), ["#ddc7cd", "#808080", "#4000bf"]);
});

test("text nodes split by an element keep a separator; adjacent ones do not", { skip }, async () => {
  const d = await dump(`<div style="display:flex;gap:12px"><span id="k"></span></div><script>const k = document.getElementById("k").parentElement; k.replaceChildren(document.createTextNode("Released"), document.createElement("i"), document.createTextNode("1 Jun 1998"));</script>`);
  assert.deepEqual(texts(d), ["Released 1 Jun 1998"]);
});

test("text still cut by text-overflow: ellipsis is refused, never reconstructed; text that fits and real-text ellipsis export as is", { skip }, async () => {
  await assert.rejects(dump(`<div style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:16px monospace">abcdefghijklmnop</div>`), /not measurable/);
  const d = await dump(`<div style="width:300px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:16px monospace">fits</div><div style="width:300px;font:16px monospace;margin-top:30px">abcde\u2026</div>`);
  assert.deepEqual(texts(d), ["fits", "abcde\u2026"]);
});

test("cells measured as covered by a native video plane drop the controls inside them and count them, uncovered ones stay", { skip }, async () => {
  const body = `<button class="abs" style="left:10px;top:10px;width:80px;height:20px">Play</button><button class="abs" style="left:10px;top:150px;width:80px;height:20px">Below</button>`;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#fff;font:16px sans-serif}.abs{position:absolute}</style>${body}`);
    // 4 x 3 cells of 100 px: the plane (measured by the driver from a shown/hidden pair of grabs) changed the pixels of the two top-left cells only
    const covered = { cols: 4, rows: 3, covered: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const withPlane = await page.evaluate(`(${layoutPageFn.toString()})([], ${JSON.stringify({ coveredCells: covered })})`);
    assert.deepEqual(texts(withPlane), ["Below", "Below"]);
    assert.equal(withPlane.occluded, 1);
    assert.deepEqual(texts(await page.evaluate(layoutPageFn, [])).filter((t) => t === "Play").length, 2);
  } finally { await browser.close(); }
});

test("accessible names resolve aria-labelledby, wrapping and associated labels; checkbox and radio keep their own roles", { skip }, async () => {
  const d = await dump(`<span id="n" class="abs" style="top:200px">Named</span>
    <input type="checkbox" class="abs" style="top:0;width:20px;height:20px" aria-labelledby="n">
    <label class="abs" style="top:30px"><input type="radio" name="r" style="width:20px;height:20px"> Wrap</label>
    <input id="c" type="checkbox" class="abs" style="top:60px;width:20px;height:20px"><label for="c" class="abs" style="top:90px">Assoc</label>`);
  const ctl = d.elements.filter((e) => e.role === "checkbox" || e.role === "radio");
  assert.deepEqual(ctl.map((e) => [e.role, e.text]), [["checkbox", "Named"], ["radio", "Wrap"], ["checkbox", "Assoc"]]);
});

test("volatile multi-line text is one element per line", { skip }, async () => {
  const d = await dump(`<div class="calendar-subscription-url" style="width:60px;word-break:break-all">abcdefghijklmnopqrstuvwxyz</div>`, volatileFor("home"));
  assert.ok(d.elements.length > 1 && d.elements.every((e) => e.volatile === "calendar-link-url"));
});

test("an element with no width between text nodes adds no separator", { skip }, async () => {
  const d = await dump(`<div><span id="k"></span></div><script>const k = document.getElementById("k").parentElement; k.replaceChildren(document.createTextNode("S01"), document.createElement("i"), document.createTextNode("E01"));</script>`);
  assert.deepEqual(texts(d), ["S01E01"]);
});

test("a computed colour in another space (color-mix in oklab) resolves to sRGB", { skip }, async () => {
  const d = await dump(`<div class="abs" style="top:0;width:40px;height:20px;background:color-mix(in oklab, #ff0000 40%, #0000ff)"></div>`);
  assert.match(d.elements[0].background, /^#[0-9a-f]{6}$/);
  assert.notEqual(d.elements[0].background, "#ffffff");
});

test("a control's name skips aria-hidden, display:none and visibility:hidden descendants; the glyphs stay their own text rows", { skip }, async () => {
  const d = await dump(`<button class="abs" style="top:0;width:200px;height:30px"><span aria-hidden="true">▶</span><span>Play</span></button>
    <button class="abs" style="top:40px;width:200px;height:30px"><span>Any language</span><span aria-hidden="true">⌄</span></button>
    <a href="#" class="abs" style="top:80px;width:200px;height:30px;display:flex;gap:8px"><b>01</b><b>Appearance</b><span aria-hidden="true">→</span><i style="display:none">x</i><i style="visibility:hidden">y</i></a>
    <button class="abs" style="top:120px;width:200px;height:30px"><span aria-hidden="true">＋</span><span>Add to Playlist</span></button>
    <button class="abs" style="top:160px;width:200px;height:30px"><span aria-hidden="true">✓</span><span>Done</span></button>
    <button class="abs" style="top:200px;width:300px;height:30px;display:flex;gap:8px"><span aria-hidden="true">+</span><span>Sign in</span><span>ADD ANOTHER PROFILE</span></button>`);
  const names = d.elements.filter((e) => e.role === "button" || e.role === "link").map((e) => e.text);
  assert.deepEqual(names, ["Play", "Any language", "01 Appearance", "Add to Playlist", "Done", "Sign in ADD ANOTHER PROFILE"]);
  for (const g of ["▶", "⌄", "→", "＋", "✓", "+"]) assert.ok(d.elements.some((e) => e.role === "text" && e.text === g), `glyph ${g} is a text row`);
});

test("labels and aria-labelledby skip aria-hidden glyphs too", { skip }, async () => {
  const d = await dump(`<label for="c">Opt <span aria-hidden="true">*</span></label><input id="c" type="checkbox" class="abs" style="top:50px;width:20px;height:20px">
    <span id="n" class="abs" style="top:90px">Named <i aria-hidden="true">!</i></span><button class="abs" style="top:120px;width:60px;height:20px" aria-labelledby="n"></button>`);
  assert.deepEqual(d.elements.filter((e) => e.role === "checkbox" || e.role === "button").map((e) => e.text), ["Opt", "Named"]);
});

test("a volatile element cut by ellipsis, a vertical line clamp and an input value are refused, not dropped", { skip }, async () => {
  await assert.rejects(dump(`<div class="app-clock-time" style="width:30px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">12:00:00 PM extra</div>`, volatileFor("home")), /not measurable/);
  await assert.rejects(dump(`<p style="width:60px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden">one two three four five six seven eight nine ten</p>`), /not measurable/);
  await assert.rejects(dump(`<input class="abs" value="typed" style="width:100px">`), /value of an input/);
  assert.ok((await dump(`<input class="abs" value="" style="width:100px" aria-label="Empty">`)).elements.length === 1);
});

test("an input exports its implicit ARIA role by type: searchbox, slider, spinbutton, textbox", { skip }, async () => {
  const d = await dump(`<input type="search" class="abs" style="top:0;width:80px;height:20px" aria-label="s"><input type="range" class="abs" style="top:30px;width:80px;height:20px" aria-label="r">
    <input type="number" class="abs" style="top:60px;width:80px;height:20px" aria-label="n"><input type="email" class="abs" style="top:90px;width:80px;height:20px" aria-label="e">
    <input type="tel" class="abs" style="top:120px;width:80px;height:20px" aria-label="t"><input type="url" class="abs" style="top:150px;width:80px;height:20px" aria-label="u"><input type="text" class="abs" style="top:180px;width:80px;height:20px" aria-label="x">`);
  const roles = Object.fromEntries(d.elements.filter((e) => e.text.length === 1).map((e) => [e.text, e.role]));
  assert.deepEqual(roles, { s: "searchbox", r: "slider", n: "spinbutton", e: "textbox", t: "textbox", u: "textbox", x: "textbox" });
});

test("a control with direct text and a styled child is named by its whole content", { skip }, async () => {
  const d = await dump(`<button class="abs" style="top:0">Go <span style="font-weight:700">back</span></button>`);
  assert.equal(d.elements.find((e) => e.role === "button").text, "Go back");
});
