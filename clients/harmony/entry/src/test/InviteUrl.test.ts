// entry/src/test/InviteUrl.test.ts: core/InviteUrl.ts against web's buildInviteUrl for one address.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildInviteUrl } from "../main/ets/core/InviteUrl";

describe("buildInviteUrl", () => {
  it("matches web's encoding of a one-address bundle", () => {
    const json = JSON.stringify([{ peer_node_id: "", url: "https://example.test:8484" }]);
    const servers = Buffer.from(json, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const web = new URL("/signup", "https://playarr.app");
    web.searchParams.set("servers", servers);
    web.searchParams.set("invite", "tok+en/1");
    assert.equal(buildInviteUrl("https://example.test:8484", "tok+en/1"), web.toString());
  });
});
