import test from "node:test";
import assert from "node:assert/strict";
import { createDriver } from "./drivers/web.mjs";

const serverUrl = "https://server.example.invalid";
const originalEnv = { ...process.env };

function config(username = "device-test") {
  for (const key of Object.keys(process.env)) if (key.startsWith("PLAYARR_") || key === "PARITY_CLIENT") delete process.env[key];
  Object.assign(process.env, {
    PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl,
    PLAYARR_WEB_URL: "https://playarr.example.invalid",
    PLAYARR_USERNAME: username,
    PLAYARR_PASSWORD: "mock-password",
  });
}

function browserMock({ initialSignedIn = false, ownerOnRequest = false } = {}) {
  const state = { operations: [], keyUps: 0, identityReads: 0, ownerOnRequest, ownerAfterIdentityRead: Infinity, switchAfterKeyDown: false, closed: false };
  const page = {
    on() {},
    async goto(url) { state.operations.push(["goto", url]); if (!initialSignedIn && url.endsWith("/")) throw new Error("mock signed out"); },
    async fill(selector) { state.operations.push(["fill", selector]); },
    async waitForFunction() {},
    async waitForSelector() {},
    url() { return "https://playarr.example.invalid/"; },
    async evaluate(fn) {
      if (fn.name === "fetchCurrentIdentity") {
        state.identityReads += 1;
        if (state.switchAfterKeyDown) return { username: "operator", isCurrentCount: 1, serverUrl };
        if (state.ownerOnRequest || state.identityReads >= state.ownerAfterIdentityRead) return { username: "operator", isCurrentCount: 1, serverUrl };
        return initialSignedIn ? { username: "device-test", isCurrentCount: 1, serverUrl } : (() => { throw new Error("mock signed out"); })();
      }
      state.operations.push(["evaluate", fn.name]);
      return undefined;
    },
    locator(selector) {
      return {
        async count() { return selector === ".app-nav-link" && initialSignedIn ? 1 : 0; },
        async fill() { state.operations.push(["fill", selector]); },
        async click() { state.operations.push(["click", selector]); },
        async first() { return this; },
        async waitFor() {},
      };
    },
    keyboard: {
      async down() { state.operations.push(["keyDown"]); state.switchAfterKeyDown = true; },
      async up() { state.keyUps += 1; state.operations.push(["keyUp"]); },
      async press() { state.operations.push(["keyPress"]); },
    },
    async waitForTimeout() {},
    async screenshot() { state.operations.push(["screenshot"]); },
  };
  const context = {
    async addInitScript() {},
    async storageState() { return {}; },
    async grantPermissions() {},
    async newPage() { return page; },
    async close() { state.closed = true; },
  };
  const browser = {
    async newContext() { return context; },
    async close() { state.closed = true; },
  };
  return { state, page, playwright: { async launch() { return browser; } } };
}

test("signed-out and owner sessions fail before exported live operations", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  const mocks = browserMock();
  const driver = await createDriver({ playwright: mocks.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await driver.setDeterministicCapture({ fixedNow: "2026-10-16T00:00:00Z", disableAnimations: true });
  assert.equal(mocks.state.identityReads, 0, "local capture configuration before start needs no identity");
  await assert.rejects(driver.start(), /signed out/);
  const before = mocks.state.operations.length;
  await assert.rejects(driver.key("down"));
  await assert.rejects(driver.screenshot("ignored.png"));
  await assert.rejects(driver.setTheme("light"));
  await assert.rejects(driver.route("/"));
  await assert.rejects(driver.play({ file: "sample" }, { startWithinSeconds: 1, advanceSeconds: 1 }));
  assert.equal(mocks.state.operations.length, before);
  assert.equal(mocks.state.operations.some(([kind]) => kind === "fill" || kind === "click"), false);
  await driver.stop();
  assert.equal(mocks.state.closed, true, "stop releases the owned browser even after guard rejection");

  const switchMocks = browserMock({ initialSignedIn: true, ownerOnRequest: true });
  const ownerDriver = await createDriver({ playwright: switchMocks.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await assert.rejects(ownerDriver.start(), /guard rejected/);
  await assert.rejects(ownerDriver.key("down"), /guard rejected/);
  assert.equal(switchMocks.state.operations.some(([kind]) => kind === "keyPress"), false);
});

test("a session switch while a key is held still sends key-up", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  const mocks = browserMock({ initialSignedIn: true });
  const driver = await createDriver({ playwright: mocks.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await driver.start();
  assert.equal(mocks.state.identityReads, 2, "bootstrap validates the accepted current account");
  await assert.rejects(driver.key("down", { long: true }), /guard rejected/);
  assert.equal(mocks.state.keyUps, 1);
  await driver.stop();
});

test("download error diagnostics do not capture after an account switch", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  process.env.PARITY_DEBUG = "mock-debug";
  const mocks = browserMock({ initialSignedIn: true });
  const driver = await createDriver({ playwright: mocks.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await driver.start();
  mocks.state.ownerAfterIdentityRead = mocks.state.identityReads + 2;
  await assert.rejects(driver.download({ id: "case", action: "unknown", media: { title: "Sample", file: "sample" } }, { withinSeconds: 1 }), /guard rejected/);
  assert.equal(mocks.state.operations.some(([kind]) => kind === "screenshot"), false);
  await driver.stop();
});
