// entry/src/test/HostedLink.test.ts: core/HostedLink.ts and the broker URLs, as web lib/hostedDeviceLink.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { hostedLinkPlatformFor, parseHostedClaim, parseHostedCode } from "../main/ets/core/HostedLink";
import { hostedLinkClaimUrl, hostedLinkCodeUrl } from "../main/ets/core/Endpoints";

test("broker urls", () => {
  assert.equal(hostedLinkCodeUrl(), "https://playarr.app/api/link/code");
  assert.equal(hostedLinkClaimUrl("a b/c"), "https://playarr.app/api/link/code/a%20b%2Fc");
});

test("code parses, bad shape is null", () => {
  const wire = { device_code: "d", user_code: "ABCD", verification_uri: "https://x/y", verification_uri_complete: "https://x/y?c=1",
    expires_in: 600, interval: 5 };
  assert.deepEqual(parseHostedCode(JSON.stringify(wire)), wire);
  assert.equal(parseHostedCode(JSON.stringify({ ...wire, interval: "5" })), null);
  assert.equal(parseHostedCode("null"), null);
  assert.equal(parseHostedCode("<html>"), null);
});

test("claim parses, drops non-string urls, bad shape is null", () => {
  assert.deepEqual(parseHostedClaim('{"server_url":"https://s","server_device_code":"k","server_urls":["https://s",3]}'),
    { serverUrl: "https://s", serverDeviceCode: "k", serverUrls: ["https://s"] });
  assert.equal(parseHostedClaim('{"server_url":"https://s","server_device_code":"k"}'), null);
});

test("broker platform stays web until enabled, then follows the form factor", () => {
  assert.equal(hostedLinkPlatformFor(false, true, "tv-wire"), "web");
  assert.equal(hostedLinkPlatformFor(false, false, "tv-wire"), "web");
  assert.equal(hostedLinkPlatformFor(true, true, "tv-wire"), "tv-wire");
  assert.equal(hostedLinkPlatformFor(true, false, "tv-wire"), "harmony-phone");
});
