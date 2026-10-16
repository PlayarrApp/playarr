import test from "node:test";
import assert from "node:assert/strict";
import { createDriver } from "./harmony.mjs";

const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const originalUsername = process.env.TEST_USERNAME;

test("Harmony routes, focus controls and capture stop before input for another account", async () => {
  process.env.TEST_USERNAME = "device-test";
  const requests = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    requests.push(path);
    if (path === "/state") {
      return new Response(JSON.stringify({ preview_current_username: "other-user" }), { status: 200 });
    }
    return new Response("ok", { status: 200 });
  };

  try {
    const driver = await createDriver();
    await assert.rejects(driver.route("/"), /capture blocked/);
    await assert.rejects(driver.home(), /capture blocked/);
    await assert.rejects(driver.screenshot("unused.png"), /capture blocked/);
    await assert.rejects(driver.play({ file: "sample" }), /capture blocked/);
    assert.deepEqual(requests, ["/state", "/state", "/state", "/state"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUsername === undefined) delete process.env.TEST_USERNAME;
    else process.env.TEST_USERNAME = originalUsername;
  }
});

test("Harmony home verifies again before its direct focus route", async () => {
  process.env.TEST_USERNAME = "device-test";
  const requests = [];
  let focused = false;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed.pathname + parsed.search);
    if (parsed.pathname === "/state") {
      return new Response(JSON.stringify({ preview_current_username: "device-test", focused }), { status: 200 });
    }
    if (parsed.pathname === "/setroute" && parsed.searchParams.get("name") === "focus:pcard") focused = true;
    return new Response("ok", { status: 200 });
  };
  globalThis.setTimeout = (callback) => originalTimeout(callback, 0);

  try {
    const driver = await createDriver();
    await driver.home();
    const focusIndex = requests.findIndex((path) => path.startsWith("/setroute?") && path.includes("focus"));
    assert.ok(focusIndex > 0, `home sent the focus route: ${JSON.stringify(requests)}`);
    assert.equal(requests[focusIndex - 1], "/state", "account state is refreshed immediately before focus input");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    if (originalUsername === undefined) delete process.env.TEST_USERNAME;
    else process.env.TEST_USERNAME = originalUsername;
  }
});
