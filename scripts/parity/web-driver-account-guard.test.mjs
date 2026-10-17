import test from "node:test";
import assert from "node:assert/strict";
import { createDriver, searchResultsReadyPredicate } from "./drivers/web.mjs";

const serverUrl = "https://server.example.invalid";
const originalEnv = { ...process.env };

function config(username = "device-test") {
  for (const key of Object.keys(process.env)) if (key.startsWith("PLAYARR_") || key === "PARITY_CLIENT" || key === "PARITY_FIXED_NOW") delete process.env[key];
  Object.assign(process.env, {
    PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl,
    PLAYARR_DEVICE_TEST_USERNAME: username,
    PLAYARR_WEB_URL: "https://playarr.example.invalid",
    PLAYARR_USERNAME: username,
    PLAYARR_PASSWORD: "mock-password",
  });
}

function browserMock({ initialSignedIn = false, ownerOnRequest = false } = {}) {
  const state = { operations: [], initScripts: [], contextOptions: null, currentUrl: "https://playarr.example.invalid/", keyUps: 0, identityReads: 0, ownerOnRequest, ownerAfterIdentityRead: Infinity, switchAfterKeyDown: false, closed: false, searchBusy: "false", searchGrid: false, searchEmptyTone: "empty" };
  const page = {
    on() {},
    async goto(url) { state.operations.push(["goto", url]); if (!initialSignedIn && url.endsWith("/")) throw new Error("mock signed out"); state.currentUrl = url; },
    async fill(selector) { state.operations.push(["fill", selector]); },
    async waitForFunction(predicate) {
      state.operations.push(["waitForFunction", predicate.name]);
      if (predicate !== searchResultsReadyPredicate) return;
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          querySelector(selector) {
            assert.equal(selector, ".tv-search-results");
            return {
              getAttribute(name) { return name === "aria-busy" ? state.searchBusy : null; },
              querySelector(selector) {
                if (selector.includes(".tv-search-results-grid") && state.searchGrid) return {};
                if (selector.includes(".tone-error") && state.searchEmptyTone === "error") return {};
                if (selector.includes(".tone-empty") && state.searchEmptyTone === "empty") return {};
                return null;
              },
            };
          },
        },
      });
      try {
        if (!predicate()) throw new Error("Search readiness timed out while the results rail was busy or unresolved");
      } finally {
        if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
        else delete globalThis.document;
      }
    },
    async waitForSelector(selector) { state.operations.push(["waitForSelector", selector]); },
    url() { return state.currentUrl; },
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
        async count() {
          if (selector === ".app-nav-link") return initialSignedIn ? 1 : 0;
          if (selector === ".tv-search-results .tv-empty-state.tone-error") return state.searchEmptyTone === "error" ? 1 : 0;
          return 0;
        },
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
    async addInitScript(fn, ...args) { state.initScripts.push([fn, ...args]); },
    async storageState() { return {}; },
    async grantPermissions() {},
    async newPage() { return page; },
    async close() { state.closed = true; },
  };
  const browser = {
    async newContext(options) { state.contextOptions = options; return context; },
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

test("web driver applies the optional fixture clock and timezone when creating its context", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  process.env.PARITY_FIXED_NOW = "2026-10-07T12:00:00Z";
  process.env.PLAYARR_WEB_TIMEZONE = "UTC";
  const mocks = browserMock({ initialSignedIn: true });
  const driver = await createDriver({ playwright: mocks.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await driver.start();
  assert.equal(mocks.state.contextOptions.timezoneId, "UTC");
  assert.ok(mocks.state.initScripts.some(([fn, value]) => fn.name === "installVisualDate" && value === "2026-10-07T12:00:00Z"), "fixture clock is installed before page code");
  await driver.stop();
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

test("web readiness accepts standalone Profiles and only settled non-error Search states", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  const profiles = browserMock({ initialSignedIn: true });
  const profilesDriver = await createDriver({ playwright: profiles.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await profilesDriver.start();
  profiles.state.operations.length = 0;
  profiles.state.currentUrl = "https://playarr.example.invalid/profiles";
  await profilesDriver.waitReady({ screen: "profiles", phase: "route" });
  const profileWaits = profiles.state.operations.filter(([kind]) => kind === "waitForSelector").map(([, selector]) => selector);
  assert.ok(profileWaits.includes(".profiles-page"));
  assert.ok(!profileWaits.includes(".app-nav-link"), "Profiles renders outside AppShell");
  await profilesDriver.stop();

  const search = browserMock({ initialSignedIn: true });
  const searchDriver = await createDriver({ playwright: search.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await searchDriver.start();
  search.state.operations.length = 0;
  search.state.currentUrl = "https://playarr.example.invalid/search";
  await searchDriver.waitReady({ screen: "search", phase: "route" });
  assert.ok(search.state.operations.some(([kind, selector]) => kind === "waitForSelector" && selector === ".app-nav-link"));

  search.state.searchBusy = "true";
  search.state.searchGrid = true;
  await assert.rejects(searchDriver.waitReady({ screen: "search", phase: "route" }), /results rail was busy/);

  search.state.searchBusy = "false";
  search.state.searchGrid = false;
  search.state.searchEmptyTone = "error";
  await assert.rejects(searchDriver.waitReady({ screen: "search", phase: "route" }), /rendered an error empty state/);
  await searchDriver.stop();
});

test("web readiness still checks the isolated account before waiting for page content", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  const mocks = browserMock({ initialSignedIn: true });
  const driver = await createDriver({ playwright: mocks.playwright, secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } });
  await driver.start();
  mocks.state.currentUrl = "https://playarr.example.invalid/search";
  mocks.state.ownerAfterIdentityRead = mocks.state.identityReads + 1;
  const priorReadinessWaitCount = mocks.state.operations.filter(([kind]) => kind === "waitForSelector" || kind === "waitForFunction").length;
  await assert.rejects(driver.waitReady({ screen: "search", phase: "route" }), /guard rejected/);
  assert.equal(mocks.state.operations.filter(([kind]) => kind === "waitForSelector" || kind === "waitForFunction").length, priorReadinessWaitCount);
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

test("hosted device-test environment configures the web guard without a local secrets file", async (t) => {
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
  config();
  const mocks = browserMock();
  const driver = await createDriver({ playwright: mocks.playwright });
  await assert.rejects(driver.start(), /signed out/);
  assert.equal(mocks.state.operations.some(([kind]) => kind === "click" || kind === "keyPress"), false);
  await driver.stop();
});
