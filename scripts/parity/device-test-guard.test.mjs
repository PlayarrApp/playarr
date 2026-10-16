import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  assertDeviceTestIdentity,
  assertDeviceTestPage,
  fetchCurrentIdentity,
  loadAllowedDeviceTestUsernames,
  loadTrustedDeviceTestServerUrl,
  assertAllowedDeviceTestUsername,
  trustedLoginUsername,
} from "./device-test-guard.mjs";

const serverUrl = "https://server.example.invalid";

test("only exact configured test usernames enter the allowlist", () => {
  const allow = loadAllowedDeviceTestUsernames({
    secrets: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_PARITY_WEB_USERNAME: "parity-web" },
    env: { PARITY_CLIENT: "web", PLAYARR_USERNAME: "parity-web", PLAYARR_PARITY_OTHER_USERNAME: "not-enabled" },
    client: "web",
  });
  assert.deepEqual([...allow], ["device-test", "parity-web"]);
  assert.throws(() => loadAllowedDeviceTestUsernames({ secrets: {}, env: { PLAYARR_USERNAME: "operator" } }), /not in the device-test allowlist/);
  assert.throws(() => trustedLoginUsername({ PLAYARR_USERNAME: "operator" }, allow, serverUrl), /guard rejected/);
  assert.equal(trustedLoginUsername({ PLAYARR_USERNAME: "device-test" }, allow, serverUrl), "device-test");
  assert.equal(assertAllowedDeviceTestUsername("device-test", allow), true);
});

test("trusted server must come from the device-test server key and match any supplied server", () => {
  assert.equal(loadTrustedDeviceTestServerUrl({ secrets: { PLAYARR_DEVICE_TEST_SERVER_URL: `${serverUrl}/` }, env: {} }), serverUrl);
  assert.equal(loadTrustedDeviceTestServerUrl({ secrets: {}, env: { PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl } }), serverUrl);
  assert.throws(() => loadTrustedDeviceTestServerUrl({ secrets: { PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl }, env: { PLAYARR_SERVER_URL: "https://other.example.invalid" } }), /does not match/);
  assert.throws(() => loadTrustedDeviceTestServerUrl({ secrets: {}, env: { PLAYARR_SERVER_URL: serverUrl } }), /not configured/);
  assert.throws(() => loadTrustedDeviceTestServerUrl({ secrets: {}, env: {} }), /not configured/);
});

test("authenticated identity must be uniquely current, explicitly allowlisted, and on the trusted server", () => {
  const allowedUsernames = new Set(["device-test"]);
  const identity = { username: "device-test", isCurrentCount: 1, serverUrl };
  assert.equal(assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl: serverUrl }), true);
  for (const rejected of [
    { ...identity, username: "operator" },
    { ...identity, isCurrentCount: 0 },
    { ...identity, isCurrentCount: 2 },
    { ...identity, serverUrl: "https://other.example.invalid" },
  ]) {
    let sideEffects = 0;
    assert.throws(() => {
      assertDeviceTestIdentity({ identity: rejected, allowedUsernames, expectedServerUrl: serverUrl });
      sideEffects += 1;
    }, /guard rejected/);
    assert.equal(sideEffects, 0);
  }
});

test("page guard rejects before an operation can proceed", async () => {
  let sideEffects = 0;
  const page = { async evaluate(fn) { return fn.call({}); } };
  page.evaluate = async () => ({ username: "operator", isCurrentCount: 1, serverUrl });
  await assert.rejects(async () => {
    await assertDeviceTestPage({ page, allowedUsernames: new Set(["device-test"]), expectedServerUrl: serverUrl });
    sideEffects += 1;
  }, /guard rejected/);
  assert.equal(sideEffects, 0);
});

test("current identity fetch fails closed for missing session, request failure, malformed profiles, and account switches", async (t) => {
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null };
  t.after(() => {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  });
  await assert.rejects(fetchCurrentIdentity(), /identity unavailable/);
  storage.set("playarr:session", JSON.stringify({ accessToken: "mock-token" }));
  storage.set("playarr:apiBaseUrl", serverUrl);
  await assert.rejects(fetchCurrentIdentity({ expectedServerUrl: "https://other.example.invalid" }), /server is not trusted/);
  globalThis.fetch = async () => { throw new Error("private network detail"); };
  await assert.rejects(fetchCurrentIdentity(), /identity request failed/);
  globalThis.fetch = async () => ({ ok: true, async json() { return {}; } });
  await assert.rejects(fetchCurrentIdentity(), /response invalid/);
  globalThis.fetch = async () => ({ ok: true, async json() { return [{ username: "device-test", is_current: true }]; } });
  globalThis.fetch = async () => {
    storage.set("playarr:apiBaseUrl", "https://other.example.invalid");
    return { ok: true, async json() { return [{ username: "device-test", is_current: true }]; } };
  };
  await assert.rejects(fetchCurrentIdentity(), /session changed/);
  storage.set("playarr:apiBaseUrl", serverUrl);
  globalThis.fetch = async () => ({ ok: true, async json() { return [{ username: "device-test", is_current: true }]; } });
  assert.deepEqual(await fetchCurrentIdentity({ expectedServerUrl: serverUrl }), { username: "device-test", isCurrentCount: 1, serverUrl });
  globalThis.fetch = async () => ({ ok: true, async json() { return [{ username: "device-test", is_current: true }, { username: "second", is_current: true }]; } });
  await assert.rejects(fetchCurrentIdentity({ expectedServerUrl: serverUrl }), /missing or ambiguous/);
});

test("browser-evaluated identity helper is self-contained after serialisation", async () => {
  const context = vm.createContext({
    localStorage: { getItem: (key) => key === "playarr:session" ? JSON.stringify({ accessToken: "mock-token" }) : serverUrl },
    AbortController,
    URL,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, async json() { return [{ username: "device-test", is_current: true }]; } }),
  });
  const serialised = vm.runInContext(`(${fetchCurrentIdentity.toString()})`, context);
  assert.equal(JSON.stringify(await serialised({ expectedServerUrl: serverUrl })), JSON.stringify({ username: "device-test", isCurrentCount: 1, serverUrl }));
});

test("a session rotated mid-check is re-validated once, a repeated failure still throws", async () => {
  const identity = { username: "device-test", isCurrentCount: 1, serverUrl };
  const flaky = (failures) => { let n = 0; return { evaluate: async () => { if (n++ < failures) throw new Error("device-test account session changed during identity check"); return identity; } }; };
  const args = { allowedUsernames: new Set(["device-test"]), expectedServerUrl: serverUrl };
  await assertDeviceTestPage({ page: flaky(1), ...args });
  await assert.rejects(assertDeviceTestPage({ page: flaky(2), ...args }), /session changed/);
});
