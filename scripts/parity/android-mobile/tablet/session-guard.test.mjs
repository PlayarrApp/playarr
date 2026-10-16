import test from "node:test";
import assert from "node:assert/strict";
import { assertConnectedAndroidSession, decodeStringPreferences, deviceTestUsernameAllowlist, validateActiveSession } from "./session-guard.mjs";

function varint(value) {
  const out = [];
  while (value > 127) { out.push((value & 127) | 128); value = Math.floor(value / 128); }
  out.push(value); return Buffer.from(out);
}
function bytesField(number, value) {
  const payload = Buffer.from(value);
  return Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload]);
}
function stringPreference(key, value) {
  const entry = Buffer.concat([bytesField(1, key), bytesField(2, bytesField(5, value))]);
  return bytesField(1, entry);
}

test("decodes AndroidX string preferences without exposing other value types", () => {
  const parsed = decodeStringPreferences(Buffer.concat([
    stringPreference("playarr_user_id", "uid-test"),
    stringPreference("playarr_access_token", "opaque-token"),
  ]));
  assert.equal(parsed.get("playarr_user_id"), "uid-test");
  assert.equal(parsed.get("playarr_access_token"), "opaque-token");
});
test("rejects malformed Android preferences instead of accepting a partial session", () => {
  assert.throws(() => decodeStringPreferences(Buffer.from([0x0a, 0x05, 0x01])), /invalid DataStore/);
});
test("allowlist accepts only the explicitly named device-test accounts", () => {
  assert.deepEqual([...deviceTestUsernameAllowlist({
    PLAYARR_DEVICE_TEST_USERNAME: "device-test",
    PLAYARR_DEVICE_TEST_DPAD_USERNAME: "device-test-dpad",
    PLAYARR_PARITY_ANDROID_TABLET_USERNAME: "parity-only",
  })], ["device-test", "device-test-dpad"]);
});

const preferences = new Map([
  ["playarr_access_token", "opaque-token"],
  ["playarr_base_url", "https://server.example"],
  ["playarr_current_server_url", "https://server.example"],
  ["playarr_user_id", "uid-test"],
]);
const allowlist = new Set(["PLAYARR_DEVICE_TEST_TABLET_USERNAME"]);
const profiles = [{ id: "uid-test", username: "PLAYARR_DEVICE_TEST_TABLET_USERNAME", is_current: true }];
const input = { preferences, allowedUsernames: allowlist, trustedServerUrl: "https://server.example", profiles };

test("accepts only one current allowlisted profile matching the stored user id and server", () => {
  assert.equal(validateActiveSession(input), true);
});
test("accepts the explicitly supplied app alias while identity is checked against the trusted relay", () => {
  const aliasInput = {
    ...input,
    preferences: new Map([...preferences].map(([key, value]) => [key, value.replace("https://server.example", "http://app-alias.example:8484")])),
    sessionServerUrl: "http://app-alias.example:8484",
  };
  assert.equal(validateActiveSession(aliasInput), true);
  assert.throws(() => validateActiveSession({ ...aliasInput, sessionServerUrl: "http://unexpected.example" }), /server is not trusted/);
});
test("rejects an unallowlisted current profile", () => {
  assert.throws(() => validateActiveSession({ ...input, profiles: [{ ...profiles[0], username: "operator" }] }), /guard rejected/);
});
test("rejects a profile whose id differs from the app's current user id", () => {
  assert.throws(() => validateActiveSession({ ...input, profiles: [{ ...profiles[0], id: "other" }] }), /missing or mismatched/);
});
test("rejects ambiguous current profiles and a server mismatch", () => {
  assert.throws(() => validateActiveSession({ ...input, profiles: [...profiles, profiles[0]] }), /missing or mismatched/);
  assert.throws(() => validateActiveSession({ ...input, preferences: new Map([...preferences, ["playarr_base_url", "https://other.example"]]) }), /server is not trusted/);
});

const trustedSecrets = {
  PLAYARR_DEVICE_TEST_USERNAME: "PLAYARR_DEVICE_TEST_TABLET_USERNAME",
  PLAYARR_DEVICE_TEST_SERVER_URL: "https://server.example",
};
const encodedSession = Buffer.concat([
  stringPreference("playarr_access_token", "opaque-token"),
  stringPreference("playarr_base_url", "http://app-alias.example:8484"),
  stringPreference("playarr_current_server_url", "http://app-alias.example:8484"),
  stringPreference("playarr_user_id", "uid-test"),
]);
const profileResponse = { ok: true, json: async () => profiles };

test("checks profiles only at the trusted relay and rejects a session changed during the request", async () => {
  let readCount = 0;
  let requestUrl;
  await assert.rejects(assertConnectedAndroidSession({
    serial: "emulator-test",
    secrets: trustedSecrets,
    serverAlias: "http://app-alias.example:8484",
    readSession: () => ++readCount === 1 ? encodedSession : Buffer.concat([encodedSession, stringPreference("playarr_current_server_url", "http://other.example")] ),
    fetchImpl: async (url, options) => {
      requestUrl = url;
      assert.equal(options.headers.Authorization, "Bearer opaque-token");
      return profileResponse;
    },
  }), /session changed during identity check/);
  assert.equal(requestUrl, "https://server.example/api/v1/users/profiles");
});

test("rejects a mismatched current server before contacting the relay", async () => {
  let requested = false;
  const badSession = Buffer.concat([
    stringPreference("playarr_access_token", "opaque-token"),
    stringPreference("playarr_base_url", "http://app-alias.example:8484"),
    stringPreference("playarr_current_server_url", "http://other.example"),
    stringPreference("playarr_user_id", "uid-test"),
  ]);
  await assert.rejects(assertConnectedAndroidSession({
    serial: "emulator-test", secrets: trustedSecrets, serverAlias: "http://app-alias.example:8484",
    readSession: () => badSession,
    fetchImpl: async () => { requested = true; return profileResponse; },
  }), /untrusted server/);
  assert.equal(requested, false);
});
