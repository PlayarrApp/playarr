import assert from "node:assert/strict";
import { test } from "node:test";
import { MOVIES } from "../static/catalogue.mjs";
import { staticRoute } from "./static-route.mjs";

test("static server swaps the fixture film for the pinned static film", () => {
  const env = { PARITY_SERVER_URL: "http://static.invalid:1" };
  assert.equal(staticRoute("player:Test Movie A", env), `player:${MOVIES[0].title}`);
  assert.equal(staticRoute("player:Test Movie A:quality", env), `player:${MOVIES[0].title}:quality`);
  assert.equal(staticRoute("home", env), "home");
});

test("live runs and fixture servers keep the fixture title", () => {
  assert.equal(staticRoute("player:Test Movie A", {}), "player:Test Movie A");
  assert.equal(staticRoute("player:Test Movie A", { PARITY_SERVER_URL: "http://x.invalid", PARITY_LIVE: "1" }), "player:Test Movie A");
});
