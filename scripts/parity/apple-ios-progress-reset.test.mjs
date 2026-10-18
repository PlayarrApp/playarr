import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resetProgressOnce } from "./drivers/apple-ios.mjs";

const env = { SERVER_URL: "https://server.example.invalid", TEST_USERNAME: "device-test", TEST_PASSWORD: "mock-password", DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_USERNAME: "device-test" };

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

test("progress reset stops before progress reads when the current profile does not match", async () => {
  const paths = [];
  await assert.rejects(
    resetProgressOnce(["sample-file"], {
      env,
      fetchImpl: async (url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path.endsWith("/auth/login")) return response({ body: { access_token: "mock-token", user_id: "user-a" } });
        return response({ body: [{ id: "user-b", username: "device-test", is_current: true }] });
      },
    }),
    /expected current Device Test profile/,
  );
  assert.deepEqual(paths, ["/api/v1/auth/login", "/api/v1/users/profiles"]);
});

test("progress reset sanitises malformed profile responses", async () => {
  let calls = 0;
  await assert.rejects(
    resetProgressOnce(["sample-file"], {
      env,
      fetchImpl: async () => (++calls === 1
        ? response({ body: { access_token: "mock-token", user_id: "user-a" } })
        : { ok: true, status: 200, async json() { throw new Error("secret response body"); } }),
    }),
    (error) => error.message === "iOS progress reset profile verification returned an invalid response" && !error.message.includes("secret"),
  );
  assert.equal(calls, 2);
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
    resetProgressOnce(["sample-file"], { env, fetchImpl: async () => (++calls === 1 ? response({ body: { access_token: "mock-token", user_id: "user-a" } }) : calls === 2 ? response({ body: [{ id: "user-a", username: "device-test", is_current: true }] }) : response({ ok: false, status: 503 })) }),
    (error) => error.message === "iOS progress reset failed with status 503" && !error.message.includes("sample-file"),
  );
});

test("progress reset completes only after every file update succeeds", async () => {
  const requests = [];
  await resetProgressOnce(["sample-file", "sample-file-2"], {
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return response({ body: { access_token: "mock-token", user_id: "user-a" } });
      if (requests.length === 2) return response({ body: [{ id: "user-a", username: "device-test", is_current: true }] });
      return response();
    },
  });
  assert.equal(requests.length, 4);
  assert.equal(requests[1].url.endsWith("/api/v1/users/profiles"), true);
  assert.equal(requests[2].options.headers.authorization, "Bearer mock-token");
  assert.equal(requests[3].options.method, "PUT");
});

const workflow = readFileSync(new URL("../../.github/workflows/parity-apple-ios.yml", import.meta.url), "utf8");

// The restored dispatch-only workflow runs suite-run inline (no run_suite function), so assert on its suite-run lines.
const suiteRuns = workflow.split("\n").filter((line) => /node suite-run\.mjs/.test(line));
const mainRun = suiteRuns.find((line) => /--only "\$only"/.test(line));

test("Apple wall workflow stops on a suite-run failure and never preflights Home", () => {
  assert.match(workflow, /set -euo pipefail/);
  assert.equal(suiteRuns.length, 4, "main, motion, poster and focus runs");
  assert.doesNotMatch(workflow, /--preflight-home-fixture/); // stable runs seed the canonical deck themselves
});

test("wall suite resets progress on the main run only; auxiliary runs do not", () => {
  assert.match(mainRun, /--reset-progress/);
  for (const line of suiteRuns.filter((l) => l !== mainRun)) assert.doesNotMatch(line, /--reset-progress/);
});
