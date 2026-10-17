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

test("trusted server comes from PLAYARR_TEST_SERVER_URL and must match any supplied alias", () => {
  assert.equal(loadTrustedDeviceTestServerUrl({ env: { PLAYARR_TEST_SERVER_URL: `${serverUrl}/` } }), serverUrl);
  assert.throws(() => loadTrustedDeviceTestServerUrl({ env: { PLAYARR_TEST_SERVER_URL: serverUrl, PLAYARR_SERVER_URL: "https://other.example.invalid" } }), /does not match/);
  assert.throws(() => loadTrustedDeviceTestServerUrl({ env: { PLAYARR_SERVER_URL: serverUrl } }), /PLAYARR_TEST_SERVER_URL is required/);
  assert.throws(() => loadTrustedDeviceTestServerUrl({ env: {} }), /PLAYARR_TEST_SERVER_URL is required/);
});

test("explicit test server override is trusted only when the authenticated identity matches it", () => {
  const target = loadTrustedDeviceTestServerUrl({ env: { PLAYARR_TEST_SERVER_URL: "https://eu3.example.invalid" } });
  assert.equal(target, "https://eu3.example.invalid");
  assert.throws(() => loadTrustedDeviceTestServerUrl({ env: { PLAYARR_TEST_SERVER_URL: "https://eu3.example.invalid", PLAYARR_SERVER_URL: "https://eu4.example.invalid" } }), /does not match/);
  assert.equal(assertDeviceTestIdentity({ identity: { username: "device-test", isCurrentCount: 1, serverUrl: target }, allowedUsernames: new Set(["device-test"]), expectedServerUrl: target }), true);
  assert.throws(() => assertDeviceTestIdentity({ identity: { username: "device-test", isCurrentCount: 1, serverUrl: "https://eu4.example.invalid" }, allowedUsernames: new Set(["device-test"]), expectedServerUrl: target }), /guard rejected/);
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

test("page guard retries transport failures but never account rejections", async () => {
  const ok = { username: "device-test", isCurrentCount: 1, serverUrl: "https://relay.example" };
  const args = { allowedUsernames: new Set(["device-test"]), expectedServerUrl: "https://relay.example" };
  let calls = 0;
  const flaky = { evaluate: async () => { if (++calls < 3) throw new Error("device-test account identity request failed (TypeError: Failed to fetch)"); return ok; } };
  await assertDeviceTestPage({ page: flaky, ...args });
  assert.equal(calls, 3);
  calls = 0;
  const denied = { evaluate: async () => { calls++; throw new Error("device-test account identity request failed (HTTP 401)"); } };
  await assert.rejects(assertDeviceTestPage({ page: denied, ...args }), /HTTP 401/);
  assert.equal(calls, 1);
});

test("identity helper accepts the relay's fallback port but not another host", async () => {
  const trustedUrl = "https://relay.example";
  const run = async (base) => {
    const storage = new Map([["playarr:session", JSON.stringify({ accessToken: "t" })], ["playarr:apiBaseUrl", base]]);
    globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null };
    globalThis.fetch = async () => ({ ok: true, async json() { return [{ username: "device-test", is_current: true }]; } });
    return fetchCurrentIdentity({ expectedServerUrl: trustedUrl });
  };
  assert.equal((await run("https://relay.example:8484")).serverUrl, trustedUrl);
  await assert.rejects(run("https://other.example"), /not trusted/);
  await assert.rejects(run("http://relay.example"), /not trusted/);
});
