import test from "node:test";
import assert from "node:assert/strict";
import { verifyFixtureServerIdentity } from "./fixture-server-preflight.mjs";

const config = {
  serverUrl: "https://fixture.example.invalid",
  username: "device-test",
  password: "mock-password",
};

test("rejects an empty or malformed server before making a credential request", async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; throw new Error("must not be called"); };
  for (const serverUrl of ["", "not a URL", "https://user:pass@fixture.example.invalid", "https://fixture.example.invalid/path", "https://fixture.example.invalid/?token=x"]) {
    await assert.rejects(verifyFixtureServerIdentity({ ...config, serverUrl, fetchImpl }), /fixture server/);
  }
  assert.equal(requests, 0);
});

test("authenticates and requires exactly one current profile matching the configured username", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/auth/login")) return { ok: true, async json() { return { access_token: "mock-token" }; } };
    return { ok: true, async json() { return [{ username: "device-test", is_current: true }]; } };
  };

  assert.equal(await verifyFixtureServerIdentity({ ...config, fetchImpl }), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `${config.serverUrl}/api/v1/auth/login`);
  const loginBody = JSON.parse(requests[0].options.body);
  assert.equal(loginBody.username, config.username);
  assert.match(loginBody.device_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(requests[1].url, `${config.serverUrl}/api/v1/users/profiles`);
  assert.equal(requests[1].options.headers.authorization, "Bearer mock-token");
  assert.ok(requests.every(({ options }) => options.signal instanceof AbortSignal));
});

test("sanitises network failures without exposing the underlying error", async () => {
  const fetchImpl = async () => { throw new Error("private response details and mock-token"); };
  await assert.rejects(
    verifyFixtureServerIdentity({ ...config, fetchImpl }),
    (error) => error.message === "fixture server identity request failed" &&
      !error.message.includes("private response details") && !error.message.includes("mock-token"),
  );
});

test("rejects a mismatched or ambiguous current profile before capture can proceed", async () => {
  for (const profiles of [
    [{ username: "other-user", is_current: true }],
    [{ username: "device-test", is_current: true }, { username: "other-user", is_current: true }],
    [{ username: "device-test", is_current: false }],
  ]) {
    const fetchImpl = async (url) => url.endsWith("/auth/login")
      ? { ok: true, async json() { return { access_token: "mock-token" }; } }
      : { ok: true, async json() { return profiles; } };
    await assert.rejects(verifyFixtureServerIdentity({ ...config, fetchImpl }), /does not match/);
  }
});
