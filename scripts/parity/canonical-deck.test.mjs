import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCanonicalDeck, deckFromEnv, seedCanonicalDeck } from "./canonical-deck.mjs";

const DECK = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const context = (files) => {
  const writes = [];
  return { writes, snapshot: { files }, writeProgress: async (f, v) => { writes.push([f, v]); }, clearResumeChoices: async () => 3, snapshotNow: async () => ({ files: "after" }) };
};

test("every other file is reset and the deck item gets the canonical position", async () => {
  const c = context({ [DECK]: { duration_ms: 9000 }, [OTHER]: { duration_ms: 500, position_ms: 40 } });
  const r = await seedCanonicalDeck(c, { deckFile: DECK, positionMs: 100, durationMs: 9000 });
  assert.deepEqual(c.writes, [[OTHER, { position_ms: 0, duration_ms: 500, completed: false }], [DECK, { position_ms: 100, duration_ms: 9000, completed: false }]]);
  assert.deepEqual(r, { snapshot: { files: "after" }, clearedResumeChoiceWorks: 3 });
});

test("rejects a bad id, an out-of-scope deck item and a position past the end", async () => {
  await assert.rejects(seedCanonicalDeck(context({}), { deckFile: "nope" }), /media ID/);
  await assert.rejects(seedCanonicalDeck(context({ [OTHER]: {} }), { deckFile: DECK }), /absent/);
  await assert.rejects(seedCanonicalDeck(context({ [DECK]: {} }), { deckFile: DECK, positionMs: 5, durationMs: 5 }), /invalid/);
});

test("no deck id means no seeding, but PARITY_SEED_CANONICAL=1 without one is an error", async () => {
  assert.equal(deckFromEnv({}), null);
  assert.equal(await applyCanonicalDeck(context({}), {}), null);
  assert.throws(() => deckFromEnv({ PARITY_SEED_CANONICAL: "1" }), /required/);
  assert.deepEqual(deckFromEnv({ PARITY_DECK_MEDIA_FILE_ID: DECK }), { deckFile: DECK, positionMs: 15098, durationMs: 6742000 });
});

test("deck ID falls back to the device-test secret, env wins, and a stable run without either is an error", () => {
  const secrets = { PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID: DECK };
  assert.equal(deckFromEnv({}, secrets).deckFile, DECK);
  assert.equal(deckFromEnv({ PARITY_DECK_MEDIA_FILE_ID: OTHER }, secrets).deckFile, OTHER);
  assert.throws(() => deckFromEnv({ PARITY_SEED_CANONICAL: "1" }, {}), /required/);
  assert.equal(deckFromEnv({ PARITY_SEED_CANONICAL: "1" }, secrets).positionMs, 15098);
});
