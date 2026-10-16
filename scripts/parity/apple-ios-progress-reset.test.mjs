import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resetProgressOnce } from "./drivers/apple-ios.mjs";

const env = { SERVER_URL: "https://server.example.invalid", TEST_USERNAME: "device-test", TEST_PASSWORD: "mock-password" };

function response({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, async json() { return body; } };
}

test("progress reset rejects failed authentication without exposing response details", async () => {
  await assert.rejects(
    resetProgressOnce(["sample-file"], { env, fetchImpl: async () => response({ ok: false, status: 401, body: { error: "sensitive" } }) }),
    (error) => error.message === "iOS progress reset login failed with status 401" && !error.message.includes("sensitive"),
  );
});

test("progress reset rejects a successful login without an access token", async () => {
  await assert.rejects(
    resetProgressOnce(["sample-file"], { env, fetchImpl: async () => response() }),
    /iOS progress reset login returned no access token/,
  );
});

test("progress reset sanitises network errors", async () => {
  await assert.rejects(
    resetProgressOnce(["sample-file"], { env, fetchImpl: async () => { throw new Error("secret token and server details"); } }),
    (error) => error.message === "iOS progress reset request failed due to a network error" && !error.message.includes("secret"),
  );
});

test("progress reset rejects any unsuccessful file update without logging file identity", async () => {
  let calls = 0;
  await assert.rejects(
    resetProgressOnce(["sample-file"], { env, fetchImpl: async () => (++calls === 1 ? response({ body: { access_token: "mock-token" } }) : response({ ok: false, status: 503 })) }),
    (error) => error.message === "iOS progress reset failed with status 503" && !error.message.includes("sample-file"),
  );
});

test("progress reset completes only after every file update succeeds", async () => {
  const requests = [];
  await resetProgressOnce(["sample-file", "sample-file-2"], {
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? response({ body: { access_token: "mock-token" } }) : response();
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.headers.authorization, "Bearer mock-token");
  assert.equal(requests[2].options.method, "PUT");
});

test("Apple wall workflow fails the job when its primary suite command fails", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/apple-ios-wall.yml", import.meta.url), "utf8");
  assert.match(workflow, /set -euo pipefail/);
  assert.match(workflow, /node suite-run\.mjs --driver \.\/drivers\/apple-ios\.mjs[^\n]*--reset-progress/);
});
