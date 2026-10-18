import test from "node:test";
import assert from "node:assert/strict";
import { captureStableFrame } from "./capture-stability.mjs";

test("captureStableFrame returns a frame only after two consecutive captures match", async () => {
  const frames = [Buffer.from("loading"), Buffer.from("ready"), Buffer.from("ready")];
  const waits = [];
  const result = await captureStableFrame(async () => frames.shift(), {
    attempts: 3,
    intervalMs: 7,
    wait: async (duration) => waits.push(duration),
  });
  assert.equal(result.toString(), "ready");
  assert.deepEqual(waits, [7, 7]);
});

test("captureStableFrame fails closed when captures keep changing", async () => {
  let captures = 0;
  await assert.rejects(captureStableFrame(async () => Buffer.from(`frame-${captures++}`), {
    attempts: 4,
    intervalMs: 1,
    wait: async () => {},
  }), /screenshot did not settle after 4 frames/);
  assert.equal(captures, 4);
});
