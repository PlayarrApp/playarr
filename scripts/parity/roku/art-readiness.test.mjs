import test from "node:test";
import assert from "node:assert/strict";
import { artReadiness, createArtReadinessState, intersectingSlots, parseArtEvent, reduceArtEvent, resetArtReadinessState } from "./art-readiness.mjs";

const event = (text, seq) => parseArtEvent(text, seq);

test("viewport slot derivation includes partial overlap and excludes edge-only/offscreen cards", () => {
  const visible = intersectingSlots([
    { id: "partial", x: 1910, y: 10, width: 20, height: 20 },
    { id: "edge", x: 1920, y: 10, width: 20, height: 20 },
    { id: "below", x: 1, y: 1080, width: 20, height: 20 },
    { id: "inside", x: 0, y: 0, width: 1, height: 1 },
  ]);
  assert.deepEqual(visible.map(({ id }) => id), ["partial", "inside"]);
});

test("readiness distinguishes explicit empty art from missing telemetry and buffers cached-ready events", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("slot|7|home|home-r0-c0|1|10|20|30|40|0", 1));
  reduceArtEvent(state, event("status|7|home|home-r0-c0|ready|0", 2));
  reduceArtEvent(state, event("begin|7|home|1|2", 3));
  reduceArtEvent(state, event("slot|7|home|home-r0-c1|0|50|20|30|40|0", 5));
  reduceArtEvent(state, event("status|7|home|home-r0-c1|empty|0", 5));
  reduceArtEvent(state, event("finish|7|home", 6));
  const generation = state.generations.get("home:7");
  assert.deepEqual(artReadiness(generation, { scope: "home", afterSeq: 1 }), { ready: true, reason: "ready" });

  const missing = createArtReadinessState();
  reduceArtEvent(missing, event("begin|8|home|1|1", 10));
  reduceArtEvent(missing, event("slot|8|home|home-r0-c0|0|0|0|10|10|0", 11));
  reduceArtEvent(missing, event("finish|8|home", 12));
  assert.equal(artReadiness(missing.generations.get("home:8"), { scope: "home", afterSeq: 9 }).reason, "art-pending");
});

test("a cached status arriving before begin and its slot declaration is retained by version", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("status|11|movies|movies-preview|ready|3", 20));
  reduceArtEvent(state, event("begin|11|movies|1|1", 21));
  reduceArtEvent(state, event("slot|11|movies|movies-preview|1|-20|-22.9|1038|1191|3", 22));
  reduceArtEvent(state, event("finish|11|movies", 23));
  assert.deepEqual(artReadiness(state.generations.get("movies:11"), { scope: "movies", afterSeq: 19 }), { ready: true, reason: "ready" });
});

test("readiness rejects stale generations, failed/pending slots and content with no required slots", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("begin|9|movies|1|1", 4));
  reduceArtEvent(state, event("slot|9|movies|movies-r0-c0|1|0|0|10|10|0", 5));
  reduceArtEvent(state, event("status|9|movies|movies-r0-c0|failed|0", 6));
  reduceArtEvent(state, event("finish|9|movies", 7));
  const generation = state.generations.get("movies:9");
  assert.equal(artReadiness(generation, { scope: "movies", afterSeq: 4 }).reason, "no-fresh-generation");
  assert.equal(artReadiness(generation, { scope: "movies", afterSeq: 3 }).reason, "art-failed");

  reduceArtEvent(state, event("begin|10|movies|1|0", 8));
  reduceArtEvent(state, event("finish|10|movies", 9));
  assert.equal(artReadiness(state.generations.get("movies:10"), { scope: "movies" }).reason, "no-required-art-slots");
});

test("the manifest count exposes a missing slot declaration instead of accepting a partial set", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("begin|12|home|1|2", 30));
  reduceArtEvent(state, event("slot|12|home|home-r0-c0|1|0|0|20|20|0", 31));
  reduceArtEvent(state, event("status|12|home|home-r0-c0|ready|0", 32));
  reduceArtEvent(state, event("finish|12|home", 33));
  assert.equal(artReadiness(state.generations.get("home:12"), { scope: "home" }).reason, "telemetry-incomplete");
});

test("Movies preview art can join and leave the current generation without stale status", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("begin|13|movies|1|1", 40));
  reduceArtEvent(state, event("slot|13|movies|movies-r0-c0|1|0|0|20|20|0", 41));
  reduceArtEvent(state, event("status|13|movies|movies-r0-c0|ready|0", 42));
  reduceArtEvent(state, event("finish|13|movies", 43));
  reduceArtEvent(state, event("slot|13|movies|movies-preview|1|-20|-22.9|1038|1191|4", 44));
  assert.equal(artReadiness(state.generations.get("movies:13"), { scope: "movies" }).reason, "art-pending");
  reduceArtEvent(state, event("status|13|movies|movies-preview|ready|4", 45));
  reduceArtEvent(state, event("optional-empty|13|movies|movies-preview|5", 46));
  assert.deepEqual(artReadiness(state.generations.get("movies:13"), { scope: "movies" }), { ready: true, reason: "ready" });
});

test("Series readiness gates visible grid art and the sourced browse hero", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("begin|14|series|1|3", 50));
  reduceArtEvent(state, event("slot|14|series|series-r0-c0|1|780|150|327|184|0", 51));
  reduceArtEvent(state, event("slot|14|series|series-r0-c1|0|1107|150|327|184|0", 52));
  reduceArtEvent(state, event("status|14|series|series-r0-c0|ready|0", 53));
  reduceArtEvent(state, event("status|14|series|series-r0-c1|empty|0", 54));
  reduceArtEvent(state, event("slot|14|series|series-preview|1|-20|-22.9|1038|1191|2", 55));
  reduceArtEvent(state, event("finish|14|series", 56));
  assert.equal(artReadiness(state.generations.get("series:14"), { scope: "series" }).reason, "art-pending");
  reduceArtEvent(state, event("status|14|series|series-preview|ready|2", 57));
  assert.deepEqual(artReadiness(state.generations.get("series:14"), { scope: "series" }), { ready: true, reason: "ready" });

  const missingVisibleSet = createArtReadinessState();
  reduceArtEvent(missingVisibleSet, event("begin|15|series|1|0", 58));
  reduceArtEvent(missingVisibleSet, event("finish|15|series", 59));
  assert.equal(artReadiness(missingVisibleSet.generations.get("series:15"), { scope: "series" }).reason, "no-required-art-slots");
});

test("invalid and non-whitelisted telemetry is ignored", () => {
  assert.equal(parseArtEvent("status|1|home|home-r0-c0|ready|0|a title", 1), null);
  assert.equal(parseArtEvent("status|1|home|home-r0-c0|loading|0", 1), null);
  assert.equal(parseArtEvent("slot|1|home|media-123|1|0|0|10|10|0", 1), null);
  assert.equal(parseArtEvent("status|1|home|movies-r0-c0|ready|0", 1), null);
});

test("reset removes generations from a previous channel launch", () => {
  const state = createArtReadinessState();
  reduceArtEvent(state, event("begin|1|home|1|1", 1));
  resetArtReadinessState(state);
  assert.equal(state.generations.size, 0);
});
