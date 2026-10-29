import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deltaE, formatReport, loadExclusions, scoreLayout } from "./layout-score.mjs";
import { layoutPageFn, volatileFor } from "./layout-dump.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(readFileSync(join(here, "fixtures/layout", n), "utf8"));

test("a device inside every tolerance scores 100 and the volatile clock text is skipped", () => {
  const r = scoreLayout(load("web.json"), load("device-ok.json"));
  assert.equal(r.total, 4); // the maskOnly video is not scored
  assert.equal(r.score, 100);
  assert.deepEqual(r.clock, { pinned: false, equalsFixture: false, fixture: "2026-10-07T12:00:00Z" });
  assert.equal(r.extras, 0); // the system element is ignored
});

test("a pinned clock is scored on its text", () => {
  const d = load("device-ok.json");
  d.clockPinned = true;
  const r = scoreLayout(load("web.json"), d);
  assert.equal(r.score, 75);
  assert.equal(r.failures[0].problems[0].field, "text");
  d.elements[4].text = "12:00";
  const ok = scoreLayout(load("web.json"), d);
  assert.equal(ok.score, 100);
  assert.equal(ok.clock.equalsFixture, true);
});

test("failures name the field and the size of the difference", () => {
  const r = scoreLayout(load("web.json"), load("device-bad.json"));
  assert.equal(r.score, 50);
  const play = r.failures.find((f) => f.ref.text === "Play");
  assert.deepEqual(play.problems.map((p) => p.field), ["rect.left", "rect.right", "background", "fontSize"]);
  assert.equal(play.problems[0].delta, 4);
  const home = r.failures.find((f) => f.ref.text === "Home");
  assert.deepEqual(home.problems.map((p) => p.field), ["text"]);
  assert.equal(home.problems[0].device, "Homes");
});

test("a missing element is a failure", () => {
  const d = load("device-ok.json");
  d.elements = d.elements.filter((e) => e.text !== "Play");
  const r = scoreLayout(load("web.json"), d);
  assert.equal(r.score, 75);
  assert.equal(r.failures[0].problems[0].field, "missing");
});

test("two runs give identical output", () => {
  const run = () => JSON.stringify(scoreLayout(load("web.json"), load("device-bad.json")));
  assert.equal(run(), run());
  const cli = () => execFileSync("node", [join(here, "layout-score.mjs"), "--ref", join(here, "fixtures/layout/web.json"), "--device", join(here, "fixtures/layout/device-bad.json")], { encoding: "utf8" });
  assert.equal(cli(), cli());
});

test("deltaE: identical is 0, near is under 2, far is over 2", () => {
  assert.equal(deltaE("#336699", "#336699"), 0);
  assert.ok(deltaE("#e50914", "#e60a14") < 2);
  assert.ok(deltaE("#e50914", "#c00000") > 2);
});

test("the in-page function is safe for the TV eval channels (no line comments, no modern syntax)", () => {
  const src = layoutPageFn.toString();
  assert.ok(!/(^|[^:"'\\\w])\/\/[^\n]*/.test(src.replace(/\/[^/\n]*\\\/[^/\n]*\//g, "")), "line comment found");
  assert.ok(!/\?\.|\?\?/.test(src));
  assert.ok(volatileFor("settings-server").some((v) => v.name === "server-address"));
});

test("the report carries the web occluded count", () => {
  const ref = { ...load("web.json"), occluded: 3 };
  const r = scoreLayout(ref, load("device-ok.json"));
  assert.equal(r.occluded, 3);
  assert.equal(scoreLayout(load("web.json"), load("device-ok.json")).occluded, 0);
  assert.match(formatReport(r), /3 occluded web elements dropped/);
});

test("the player audio button is volatile: a device 'Audio: English' at the same box passes, a moved one fails", () => {
  assert.ok(volatileFor("player-controls").some((v) => v.name === "player-audio"));
  const box = { x: 1500, y: 980, w: 48, h: 48 };
  const el = (text, rect, extra = {}) => ({ text, role: "button", rect, color: "#ffffff", background: "#202020", fontSize: null, fontWeight: null, ...extra });
  const web = { screen: "player-controls", theme: "dark", viewport: { w: 1920, h: 1080, dpr: 1 }, elements: [el("", box, { volatile: "player-audio" })] };
  const dev = (text, rect) => ({ ...web, elements: [el(text, rect)] });
  assert.equal(scoreLayout(web, dev("Audio: English", box)).score, 100);
  assert.ok(scoreLayout(web, dev("Audio: English", { ...box, x: 1560 })).score < 100);
});

const slug = (h) => h.toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
const box = (x) => ({ x, y: 10, w: 100, h: 20 });
const el = (text, role, x) => ({ text, role, rect: box(x), color: null, background: "#101010", fontSize: null, fontWeight: null });
const exRef = { screen: "film-detail", theme: "dark", viewport: { w: 1920, h: 1080, dpr: 1 }, elements: [el("Play", "button", 0), el("Download Film 1", "button", 120), el("Download", "text", 130), el("Info", "button", 240)] };
const exRules = { roku: [
  { screen: "film-detail", match: { role: "button", textPrefix: "Download " }, reason: "no downloads", doc: "docs/parity/DEVICES.md#x" },
  { screen: "film-detail", match: { text: "Download" }, reason: "no downloads", doc: "docs/parity/DEVICES.md#x" },
  { screen: "profiles", match: { text: "Info" }, reason: "other screen", doc: "docs/parity/DEVICES.md#x" },
] };
const exDev = (shift = 0) => ({ ...exRef, elements: [el("Play", "button", 0), el("Info", "button", 240 + shift)] });

test("excluded web elements leave the denominator and are listed with the reason", () => {
  const r = scoreLayout(exRef, exDev(), { client: "roku", exclusions: exRules });
  assert.equal(r.total, 2);
  assert.equal(r.score, 100);
  assert.deepEqual(r.excluded.map((x) => x.text), ["Download Film 1", "Download"]);
  assert.equal(r.excluded[0].reason, "no downloads");
  assert.match(formatReport(r), /excluded button "Download Film 1": no downloads/);
  // without the client, or for another client, nothing is excluded and the missing tile fails
  assert.equal(scoreLayout(exRef, exDev()).score, 50);
  assert.equal(scoreLayout(exRef, exDev(), { client: "firetv", exclusions: exRules }).excluded.length, 0);
});

test("an exclusion never shifts neighbours: a moved neighbour still fails at its web position", () => {
  const r = scoreLayout(exRef, exDev(30), { client: "roku", exclusions: exRules });
  assert.equal(r.score, 50);
  assert.equal(r.failures[0].ref.text, "Info");
  assert.equal(r.failures[0].problems[0].delta, 30);
  const run = () => JSON.stringify(scoreLayout(exRef, exDev(30), { client: "roku", exclusions: exRules }));
  assert.equal(run(), run());
});

test("layout-exclusions.json: every entry cites a doc heading that exists and the loader rejects uncited entries", () => {
  const table = loadExclusions();
  const root = join(here, "../..");
  let n = 0;
  for (const [client, list] of Object.entries(table)) {
    if (client.startsWith("$")) continue;
    for (const x of list) {
      n += 1;
      const [path, anchor] = x.doc.split("#");
      const heads = readFileSync(join(root, path), "utf8").split("\n").filter((l) => /^#+ /.test(l)).map((l) => slug(l.replace(/^#+ /, "")));
      assert.ok(heads.includes(anchor), `${client}: ${x.doc} has no such heading`);
    }
  }
  assert.ok(n > 0);
  const tmp = join(mkdtempSync(join(tmpdir(), "excl-")), "x.json");
  writeFileSync(tmp, JSON.stringify({ roku: [{ screen: "*", match: { text: "A" }, reason: "r" }] }));
  assert.throws(() => loadExclusions(tmp), /bad entry/);
});

test("CLI --client reports the exclusions", () => {
  const dir = mkdtempSync(join(tmpdir(), "excl-"));
  writeFileSync(join(dir, "ref.json"), JSON.stringify({ ...exRef, screen: "actions", elements: [el("Play", "button", 0), el("⇩ Download", "button", 120), el("Download", "text", 130)] }));
  writeFileSync(join(dir, "dev.json"), JSON.stringify(exDev()));
  const out = execFileSync("node", [join(here, "layout-score.mjs"), "--ref", join(dir, "ref.json"), "--device", join(dir, "dev.json"), "--client", "roku"], { encoding: "utf8" });
  assert.match(out, /2 excluded/);
  assert.match(out, /excluded text "Download"/);
});

test("a radius on a web element that draws nothing is not scored; a painted one is", () => {
  const el = (radius, painted) => ({ text: "", role: "container", rect: { x: 0, y: 0, w: 40, h: 40 }, color: null, background: "#ffffff", fontSize: null, fontWeight: null, radius, ...(painted === false ? { painted } : {}) });
  const doc = (e) => ({ viewport: { w: 100, h: 100, dpr: 1 }, elements: [e] });
  const radiusFails = (w, d) => scoreLayout(doc(w), doc(d)).failures.flatMap((f) => f.problems).filter((x) => x.field === "radius").length;
  assert.equal(radiusFails(el(14, false), el(0)), 0);
  assert.equal(radiusFails(el(14), el(0)), 1);
});

test("an opacity marked volatile on the web element is not scored", () => {
  const el = (op, vol) => ({ text: "", role: "button", rect: { x: 0, y: 0, w: 40, h: 40 }, color: null, background: "#ffffff", fontSize: null, fontWeight: null, ...(op ? { opacity: op } : {}), ...(vol ? { opacityVolatile: true } : {}) });
  const doc = (e) => ({ viewport: { w: 100, h: 100, dpr: 1 }, elements: [e] });
  const fails = (w, d) => scoreLayout(doc(w), doc(d)).failures.flatMap((f) => f.problems).filter((x) => x.field === "opacity").length;
  assert.equal(fails(el(0.5, true), el()), 0);
  assert.equal(fails(el(0.5), el()), 1);
});

test("a volatile element skips only its text: colour, font size and weight are still scored", () => {
  const el = (text, color, fontSize) => ({ text, role: "text", rect: { x: 0, y: 0, w: 40, h: 20 }, color, background: "#ffffff", fontSize, fontWeight: 400, volatile: "player-time" });
  const doc = (e) => ({ viewport: { w: 100, h: 100, dpr: 1 }, elements: [e] });
  const fields = (w, d) => scoreLayout(doc(w), doc(d)).failures.flatMap((f) => f.problems).map((x) => x.field);
  assert.deepEqual(fields(el("0:02", "#000000", 14), el("9:99", "#000000", 14)), []);
  assert.deepEqual(fields(el("0:02", "#000000", 14), el("9:99", "#ff0000", 20)).sort(), ["color", "fontSize"]);
});

test("a role alias lets a device button match a web link; off by default", () => {
  const el = (role) => ({ text: "Open Film", role, rect: { x: 0, y: 0, w: 40, h: 20 }, color: null, background: "#ffffff", fontSize: null, fontWeight: null });
  const doc = (e) => ({ viewport: { w: 100, h: 100, dpr: 1 }, elements: [e] });
  assert.equal(scoreLayout(doc(el("link")), doc(el("button"))).score, 0);
  assert.equal(scoreLayout(doc(el("link")), doc(el("button")), { roleAliases: { link: ["button"] } }).score, 100);
  assert.equal(scoreLayout(doc(el("button")), doc(el("link")), { roleAliases: { link: ["button"] } }).score, 0);
});

test("textCentreLine scores text on left, right and vertical centre only; other elements stay strict", () => {
  const el = (rect, extra = {}) => ({ text: "Hi", role: "text", rect, color: null, background: null, fontSize: 16, fontWeight: 400, ...extra });
  const ref = { screen: "s", theme: "dark", viewport: { w: 100, h: 100, dpr: 1 }, elements: [el({ x: 10, y: 10, w: 20, h: 24 }), { text: "", role: "container", rect: { x: 0, y: 0, w: 50, h: 50 }, color: null, background: null, fontSize: null, fontWeight: null }] };
  // text 20.7 tall centred on the same line as the 24 tall web one (top +1.65, bottom -1.65); container 3 px short
  const dev = { elements: [el({ x: 10, y: 11.65, w: 20, h: 20.7 }), { ...ref.elements[1], rect: { x: 0, y: 0, w: 50, h: 47 } }] };
  const strict = scoreLayout(ref, dev);
  assert.equal(strict.equal, 0);
  const lax = scoreLayout(ref, dev, { textCentreLine: true });
  assert.equal(lax.equal, 1); // the text passes
  assert.equal(lax.failures.length, 1);
  assert.equal(lax.failures[0].ref.role, "container"); // the container still fails on its bottom edge
  dev.elements[0].rect.y += 3; // centre off by 3: fails even with the exception
  assert.equal(scoreLayout(ref, dev, { textCentreLine: true }).equal, 0);
});

test("textCentreLine never relaxes a button that carries text: a shrunk height still fails", () => {
  const el = (h) => ({ text: "Quality", role: "button", rect: { x: 10, y: 10, w: 60, h }, color: "#000000", background: "#ffffff", fontSize: 12, fontWeight: 400 });
  const doc = (e) => ({ viewport: { w: 100, h: 100, dpr: 1 }, elements: [e] });
  assert.equal(scoreLayout(doc(el(44)), doc(el(40)), { textCentreLine: true }).equal, 0);
  assert.equal(scoreLayout(doc(el(44)), doc(el(44)), { textCentreLine: true }).equal, 1);
});

test("heading-to-text alias: a device text matches a web heading only when passed, box and style still scored", () => {
  const el = (role, size) => ({ text: "Movies", role, rect: { x: 0, y: 0, w: 40, h: 20 }, color: "#000000", background: "#ffffff", fontSize: size, fontWeight: 400 });
  const doc = (e) => ({ viewport: { w: 100, h: 100, dpr: 1 }, elements: [e] });
  const alias = { roleAliases: { heading: ["text"] } };
  assert.equal(scoreLayout(doc(el("heading", 20)), doc(el("text", 20))).score, 0);
  assert.equal(scoreLayout(doc(el("heading", 20)), doc(el("text", 20)), alias).score, 100);
  assert.equal(scoreLayout(doc(el("heading", 20)), doc(el("text", 30)), alias).score, 0);
});
