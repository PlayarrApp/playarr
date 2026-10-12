// entry/src/test/ArtworkSize.test.ts: core/ArtworkSize.ts against web's --card-w at 1920 px.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { cardGeometry, normaliseArtworkSize } from "../main/ets/core/ArtworkSize";

test("the default landscape card is the Library's 327 px", () => {
  const card = cardGeometry(false, "medium");
  assert.equal(card.columns, 3);
  assert.ok(Math.abs(card.width - 327.2) < 0.5);
});

test("small adds a column and large drops one", () => {
  assert.equal(cardGeometry(false, "small").columns, 4);
  assert.equal(cardGeometry(false, "large").columns, 2);
  assert.equal(cardGeometry(true, "medium").columns, 5);
});

test("covers are 2:3 and anything unknown is medium", () => {
  const card = cardGeometry(true, "medium");
  assert.equal(card.height, card.width * 1.5);
  assert.equal(normaliseArtworkSize("huge"), "medium");
});
