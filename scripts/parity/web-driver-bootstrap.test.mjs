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

test("serveWebDist serves the built app with an SPA fallback and a synthetic build identity", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { serveWebDist } = await import("./drivers/web.mjs");
  const dir = mkdtempSync(`${tmpdir()}/web-dist-`);
  writeFileSync(`${dir}/index.html`, "<div id=root></div>");
  mkdirSync(`${dir}/assets`); writeFileSync(`${dir}/assets/a.js`, "1");
  const served = await serveWebDist(dir, { GITHUB_SHA: "abc" });
  try {
    assert.match(await (await fetch(`${served.url}/login`)).text(), /root/);
    assert.equal((await fetch(`${served.url}/assets/a.js`)).headers.get("content-type"), "text/javascript");
    assert.equal((await fetch(`${served.url}/assets/missing.js`)).status, 404);
    assert.equal((await (await fetch(`${served.url}/build-info.json`)).json()).sha, "abc");
  } finally { await served.close(); rmSync(dir, { recursive: true }); }
});
