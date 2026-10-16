import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

const workflow = readFileSync(new URL("../../.github/workflows/apple-ios-wall.yml", import.meta.url), "utf8");

function wallRunSuiteFunction() {
  const start = workflow.indexOf("          run_suite() {");
  const end = workflow.indexOf('\n          run_suite "$out"', start);
  assert.notEqual(start, -1, "workflow run_suite function exists");
  assert.notEqual(end, -1, "workflow run_suite function has a call site");
  return workflow.slice(start, end).split("\n").map((line) => line.slice(10)).join("\n");
}

function invokeWallRunSuite({ device, only = "screens", screens = "", reset = "true", status = 0, auxiliary = "" }) {
  const script = `
set -euo pipefail
DEVICE="$1"
RUNNER_TEMP=/runner-temp
themes=dark
MOCK_NODE_STATUS="$5"
node() {
  printf 'ARG\\t%s\\n' "$@"
  printf 'MOTION\\t%s\\n' "\${PARITY_MOTION:-}"
  printf 'COVERS\\t%s\\n' "\${PARITY_COVERS:-}"
  printf 'SIZE\\t%s\\n' "\${PARITY_SIZE:-}"
  printf 'FOCUS\\t%s\\n' "\${PARITY_FOCUS:-}"
  return "$MOCK_NODE_STATUS"
}
${wallRunSuiteFunction()}
suite_status=0
if [[ "$6" == motion ]]; then
  PARITY_MOTION=1 run_suite /captures "$2" "$3" "$4" || suite_status=$?
else
  run_suite /captures "$2" "$3" "$4" || suite_status=$?
fi
printf 'STATUS\\t%s\\n' "$suite_status"
`;
  const result = spawnSync("bash", ["-c", script, "wall-suite-test", device, only, screens, reset, String(status), auxiliary], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trimEnd().split("\n");
  const fields = Object.fromEntries(lines.filter((line) => line.includes("\t")).map((line) => {
    const [key, ...values] = line.split("\t");
    return [key, values.join("\t")];
  }).filter(([key]) => key !== "ARG"));
  fields.args = lines.filter((line) => line.startsWith("ARG\t")).map((line) => line.slice(4));
  return fields;
}

test("Apple wall workflow builds suite arguments without empty-array nounset expansions", () => {
  assert.match(workflow, /set -euo pipefail/);
  assert.match(workflow, /local -a suite_args=\(--driver \.\/drivers\/apple-ios\.mjs/);
  assert.match(workflow, /node suite-run\.mjs "\$\{suite_args\[@\]\}"/);
  assert.doesNotMatch(workflow, /\$\{(?:#)?(?:preflight|home_preflight|reset)\[@\]\}/);
  assert.match(workflow, /if \[\[ "\$reset_progress" == true && "\$DEVICE" != ipad \]\]; then suite_args\+=\(--reset-progress\); fi/);
  assert.match(workflow, /suite_args\+=\(--preflight-home-fixture\)/);
  assert.match(workflow, /run_suite "\$out" "\$only" "\$SCREENS" true/);
  assert.match(workflow, /run_suite "\$out\/motion" screens home false/);
});

test("wall suite preflights default iPad screens without resetting shared progress", () => {
  const result = invokeWallRunSuite({ device: "ipad" });
  assert.ok(result.args.includes("--preflight-home-fixture"));
  assert.ok(!result.args.includes("--reset-progress"));
  assert.ok(!result.args.includes("--screens"));
});

test("wall suite omits the Home preflight for iPad screens that exclude Home", () => {
  const result = invokeWallRunSuite({ device: "ipad", screens: "movies,series" });
  assert.ok(!result.args.includes("--preflight-home-fixture"));
  assert.ok(!result.args.includes("--reset-progress"));
  assert.deepEqual(result.args.slice(-2), ["--screens", "movies,series"]);
});

test("wall downloads do not request Home preflight or progress reset", () => {
  const result = invokeWallRunSuite({ device: "ipad", only: "downloads" });
  assert.ok(!result.args.includes("--preflight-home-fixture"));
  assert.ok(!result.args.includes("--reset-progress"));
});

test("wall suite keeps progress reset on the iPhone main suite", () => {
  const result = invokeWallRunSuite({ device: "iphone", screens: "home,movies" });
  assert.ok(result.args.includes("--reset-progress"));
  assert.ok(!result.args.includes("--preflight-home-fixture"));
});

test("iPhone auxiliary suites do not reset progress", () => {
  const result = invokeWallRunSuite({ device: "iphone", screens: "home,movies", reset: "false", auxiliary: "motion" });
  assert.ok(!result.args.includes("--reset-progress"));
  assert.equal(result.MOTION, "1");
});

test("wall suite propagates a suite-run failure", () => {
  const result = invokeWallRunSuite({ device: "ipad", status: 23 });
  assert.equal(result.STATUS, "23");
});
