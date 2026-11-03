import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_IDS, loadDesignScreens, validateDesignScreens } from "./suite-design.mjs";

test("design-screens.json covers every SCREENS-ALL id exactly once", () => {
  assert.deepEqual(validateDesignScreens(loadDesignScreens()), []);
});

test("the 15 original ids keep the suite.json order", async () => {
  const suite = (await import("node:fs")).readFileSync(new URL("./suite.json", import.meta.url), "utf8");
  const original = JSON.parse(suite).screens.map((s) => s.id);
  assert.deepEqual(DESIGN_IDS.slice(0, original.length), original);
});

test("a missing id is reported", () => {
  const spec = loadDesignScreens();
  spec.screens = spec.screens.filter((s) => s.id !== "login");
  assert.deepEqual(validateDesignScreens(spec), ["missing screen login"]);
});
