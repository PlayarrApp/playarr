import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { deriveConfig, loadParityConfig, parseEnvFile } from "../parity-config.mjs";

const screens = JSON.parse(readFileSync(new URL("../screens.json", import.meta.url), "utf8"));

test("the clock comes from screens.json and the config never carries a secret", () => {
  const cfg = loadParityConfig({});
  assert.equal(cfg.PARITY_CLOCK, screens.determinism.clock);
  assert.equal(cfg.PARITY_FIXED_NOW, screens.determinism.clock);
  assert.match(cfg.PARITY_SERVER_URL, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  assert.ok(!Object.keys(cfg).some((k) => /PASSWORD|SECRET|TOKEN/.test(k)));
});

test("variables already set win, and PARITY_LIVE=1 applies nothing", () => {
  const env = { PARITY_SERVER_URL: "http://example.invalid:1" };
  loadParityConfig(env);
  assert.equal(env.PARITY_SERVER_URL, "http://example.invalid:1");
  const live = { PARITY_LIVE: "1" };
  loadParityConfig(live);
  assert.deepEqual(live, { PARITY_LIVE: "1" });
});

test("parseEnvFile skips comments and strips quotes", () => {
  assert.deepEqual(parseEnvFile("# c\nA=1\nB='x y'\n"), { A: "1", B: "x y" });
  assert.equal(deriveConfig({ PARITY_SERVER_URL: "http://h:1" }).PLAYARR_WEB_URL, "http://h:1/tv");
});
