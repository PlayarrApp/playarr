import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveTestServerUrl, testServerEnvironment } from "./test-server-env.mjs";
import { resolveFixtureServerUrl } from "./fixture-server-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("requires the canonical parity server environment variable", () => {
  assert.throws(() => resolveTestServerUrl({}), /PLAYARR_TEST_SERVER_URL is required/);
  assert.throws(() => resolveTestServerUrl({ PLAYARR_TEST_SERVER_URL: "   " }), /PLAYARR_TEST_SERVER_URL is required/);
  assert.throws(() => resolveTestServerUrl({ PLAYARR_DEVICE_TEST_SERVER_URL: "http://example.test" }), /PLAYARR_TEST_SERVER_URL is required/);
});

test("derives every legacy server alias from the canonical value", () => {
  const env = testServerEnvironment({
    PLAYARR_TEST_SERVER_URL: "http://example.test/",
    PLAYARR_SERVER_URL: "http://ignored.example",
    PLAYARR_DEVICE_TEST_SERVER_URL: "http://ignored.example",
    PLAYARR_NURA_APP_SERVER_URL: "http://another-ignored.example",
    PLAYARR_SAILFISH_PARITY_SERVER_URL: "http://yet-another-ignored.example",
  });

  assert.equal(env.PLAYARR_TEST_SERVER_URL, "http://example.test");
  assert.equal(env.PLAYARR_SERVER_URL, "http://example.test");
  assert.equal(env.PLAYARR_DEVICE_TEST_SERVER_URL, "http://example.test");
  assert.equal(env.PLAYARR_NURA_APP_SERVER_URL, "http://example.test");
  assert.equal(env.PLAYARR_SAILFISH_PARITY_SERVER_URL, "http://example.test");
});

test("rejects invalid or unsafe canonical URLs without echoing their value", () => {
  for (const value of ["file:///tmp/test", "http://user:pass@example.test", "http://example.test?token=value", "http://example.test#section", "http://example.test/a b", "not a URL"]) {
    assert.throws(() => resolveTestServerUrl({ PLAYARR_TEST_SERVER_URL: value }), /PLAYARR_TEST_SERVER_URL/);
  }
});

test("fixture resolver accepts only the canonical loopback URL and matching base", () => {
  const env = { PLAYARR_TEST_SERVER_URL: "http://127.0.0.1:18484" };
  assert.equal(resolveFixtureServerUrl(env), env.PLAYARR_TEST_SERVER_URL);
  assert.throws(() => resolveFixtureServerUrl({ PLAYARR_TEST_SERVER_URL: "https://example.test" }), /loopback/);
  assert.throws(() => resolveFixtureServerUrl(env, "http://example.test"), /must match/);
});

test("live web e2e entrypoints take the backend URL from the caller environment", () => {
  for (const file of [
    "clients/tv-web/web/scripts/checkbox-focus-live.mjs",
    "clients/tv-web/web/scripts/settings-menu-e2e.mjs",
    "clients/tv-web/web/scripts/subtitle-style-e2e.mjs",
  ]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.match(source, /resolveTestServerUrl\(process\.env\)/, `${file} must use the caller environment`);
    assert.doesNotMatch(source, /PLAYARR_TEST_SERVER_URL\|PLAYARR_DEVICE_TEST_/, `${file} must not read the server URL from a secret file`);
  }
});
