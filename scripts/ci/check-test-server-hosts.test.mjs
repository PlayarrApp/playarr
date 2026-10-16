import assert from "node:assert/strict";
import { findForbiddenHosts } from "./check-test-server-hosts.mjs";

const syntheticRelayHost = ["node-27", "relay", "test", "invalid"].join(".");
const syntheticPerNodeHost = ["tv-27-relay", "sample", "invalid"].join(".");
const syntheticPrivateHost = ["playarr", "lan"].join(".");

assert.deepEqual(findForbiddenHosts(`const host = "${syntheticRelayHost}";`, "scripts/harness.mjs"), [{ line: 1 }]);
assert.deepEqual(findForbiddenHosts(`const host = "${syntheticPerNodeHost}";`, "clients/tv/scripts/run.mjs"), [{ line: 1 }]);
assert.deepEqual(findForbiddenHosts(`const host = "${syntheticPrivateHost}";`, "scripts/harness.mjs"), [{ line: 1 }]);
assert.deepEqual(findForbiddenHosts('const host = "server.example.invalid";', "scripts/harness.mjs"), []);

const relayLabelExpression = "$" + "{RELAY_OCTETS.join(" + '"-"' + ")}";
const relayFixtureTemplate = ["v4-" + relayLabelExpression, "relay", "playarr", "app"].join(".");
const fixture = "const RELAY_HOST = `" + relayFixtureTemplate + "`;";
assert.deepEqual(findForbiddenHosts(fixture, "clients/tv-web/web/scripts/relay-port-e2e.mjs"), []);
assert.deepEqual(findForbiddenHosts(`const RELAY_HOST = "${syntheticRelayHost}";`, "clients/tv-web/web/scripts/relay-port-e2e.mjs"), [{ line: 1 }]);
assert.deepEqual(findForbiddenHosts(fixture, "clients/tv-web/web/scripts/another-harness.mjs"), [{ line: 1 }]);

console.log("test-server host guard tests passed");
