import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertDirectPlayback, captureStableFrame, directPlayCaptureFile, resetProgress } from "./capture-stability.mjs";

const suite = JSON.parse(readFileSync(new URL("../suite.json", import.meta.url), "utf8"));

test("capture waits for two consecutive identical frames", async () => {
  const frames = [Buffer.from("opening"), Buffer.from("settled"), Buffer.from("settled")];
  const result = await captureStableFrame(async () => frames.shift(), { attempts: 3, wait: async () => {} });
  assert.equal(result.toString(), "settled");
});

test("capture fails closed when no consecutive frames match", async () => {
  const frames = ["one", "two", "three"].map((frame) => Buffer.from(frame));
  await assert.rejects(
    captureStableFrame(async () => frames.shift(), { attempts: 3, wait: async () => {} }),
    /screenshot did not settle after 3 frames/,
  );
});

test("player capture selects the suite's linked movie fixture", () => {
  assert.equal(directPlayCaptureFile(suite), suite.downloadMedia.movie.file);
});

test("player capture refuses a suite without its designated direct-play case", () => {
  assert.throws(() => directPlayCaptureFile({ downloadMedia: {} }), /no designated direct-play player capture file/);
});

test("player capture accepts only confirmed direct negotiation", () => {
  assert.doesNotThrow(() => assertDirectPlayback({ state: "playing", mode: "direct", position: 2 }));
  assert.doesNotThrow(() => assertDirectPlayback({ state: "paused", mode: "direct", position: 2 }));
  assert.throws(() => assertDirectPlayback({ state: "playing", mode: "hls", position: 2 }), /expected direct negotiation, received hls/);
  assert.throws(() => assertDirectPlayback({ state: "failed", mode: "direct", detail: "fixture unavailable" }), /failed: fixture unavailable/);
  assert.throws(() => assertDirectPlayback({ state: "loading", mode: "direct" }), /not ready: expected playing or paused state, received loading/);
  assert.throws(() => assertDirectPlayback({ state: "idle", mode: "direct", position: 0 }), /not ready: expected playing or paused state, received idle/);
  assert.throws(() => assertDirectPlayback({ state: "playing", mode: "direct", position: 0 }), /not ready: playback position has not advanced/);
});

test("progress reset fails closed on rejected login without logging credentials", async () => {
  let requests = 0;
  await assert.rejects(
    resetProgress(["fixture-file"], {
      serverURL: "https://example.com/",
      username: "fixture-user",
      password: "fixture-password",
      deviceID: "fixture-device",
      fetchImpl: async () => { requests += 1; return { ok: false, status: 401 }; },
    }),
    /progress reset login failed \(401\)/,
  );
  assert.equal(requests, 1);
});

test("progress reset fails closed when a progress write is rejected", async () => {
  let requests = 0;
  await assert.rejects(
    resetProgress(["fixture-file"], {
      serverURL: "https://example.com",
      username: "fixture-user",
      password: "fixture-password",
      deviceID: "fixture-device",
      fetchImpl: async () => {
        requests += 1;
        return requests === 1 ? { ok: true, json: async () => ({ access_token: "fixture-token" }) } : { ok: false, status: 503 };
      },
    }),
    /progress reset failed \(503\)/,
  );
  assert.equal(requests, 2);
});
