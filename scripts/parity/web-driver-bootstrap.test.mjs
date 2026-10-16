import test from "node:test";
import assert from "node:assert/strict";
import { installServerApiBaseUrl } from "./drivers/web.mjs";

test("configured API base URL is stored raw before the app initializes", async () => {
  let initScript;
  let argument;
  await installServerApiBaseUrl({
    async addInitScript(script, value) { initScript = script; argument = value; },
  }, "https://server.example.invalid/");

  const storage = new Map();
  globalThis.localStorage = { setItem(key, value) { storage.set(key, value); } };
  try {
    initScript(argument);
    assert.equal(storage.get("playarr:apiBaseUrl"), "https://server.example.invalid");
  } finally {
    delete globalThis.localStorage;
  }
});

test("an absent API base URL leaves the app's normal discovery path intact", async () => {
  let added = false;
  await installServerApiBaseUrl({ async addInitScript() { added = true; } }, undefined);
  assert.equal(added, false);
});
