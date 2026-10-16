import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// capture-refs.mjs runs on import (login, browser), so its call order is checked from the source.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "capture-refs.mjs"), "utf8");
const at = (needle) => { const i = src.indexOf(needle); assert.ok(i >= 0, `missing: ${needle}`); return i; };

test("the driver starts before its build identity is read (the account guard needs a signed-in page)", () => {
  assert.ok(at("await driver.start();") < at("await driver.captureBuildIdentity();"));
});

test("the canonical deck is re-seeded immediately before each Home capture", () => {
  const seed = at('if (s.id === "home") await prepareState();');
  assert.ok(seed < at("await driver.home();"));
  assert.ok(at("const prepareState = async () =>") < seed);
  assert.match(src.slice(at("const prepareState"), at("await prepareState();")), /seedCanonicalDeck/);
});

test("the run publishes only a complete set and records skipped screens", () => {
  assert.ok(at("missingCaptures(") < at("cpSync(join(work, name"));
  assert.match(src, /failed\.json/);
});
