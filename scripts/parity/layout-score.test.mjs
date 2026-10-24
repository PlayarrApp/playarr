import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deltaE, formatReport, scoreLayout } from "./layout-score.mjs";
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
