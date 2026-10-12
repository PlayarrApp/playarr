import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandKeys, routeMatches, validateSuite } from "./suite-lib.mjs";

const suite = JSON.parse(readFileSync(new URL("./suite.json", import.meta.url), "utf8"));
const legend = ["home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "player-controls", "actions"];

test("suite.json is valid and matches the legend screens", () => assert.deepEqual(validateSuite(suite, legend), []));
test("validator rejects a bad suite", () => {
  const s = structuredClone(suite);
  s.screens[1].keys = ["sideways"];
  s.dpad[0].from = "nowhere";
  s.performance.pop();
  assert.equal(validateSuite(s, legend).length, 3);
});
test("expandKeys repeats and long presses", () => {
  assert.deepEqual(expandKeys(["down*2", "select:long"]), [{ key: "down", long: false }, { key: "down", long: false }, { key: "select", long: true }]);
});
test("routeMatches", () => {
  assert.ok(routeMatches("/movies/:id", "/movies/abc"));
  assert.ok(!routeMatches("/movies/:id", "/movies"));
  assert.ok(routeMatches("/calendar?view=week", "/calendar?view=week&x=1"));
  assert.ok(!routeMatches("/calendar?view=week", "/calendar?view=month"));
});

test("committed web expected.json covers every D-pad check, never null", () => {
  const exp = JSON.parse(readFileSync(new URL("./expected.web.json", import.meta.url), "utf8"));
  for (const d of suite.dpad) assert.ok(exp.dpad[d.id], `${d.id} has an expected value`);
  for (const d of suite.dpad.filter((x) => x.compare === "position")) assert.ok(exp.dpad[d.id].position, `${d.id} has a position`);
});
