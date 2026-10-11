// entry/src/test/Downloads.test.ts: core/Downloads.ts against web pages/Downloads.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { downloadMetaParts, downloadSections, downloadStatusLabel, formatBytes } from "../main/ets/core/Downloads";

const rec = (id: string, status: string, over: object = {}) => ({ id, title: id, status, ...over });

test("three groups in web order; paused is in none", () => {
  const s = downloadSections([rec("a", "ready"), rec("b", "queued"), rec("c", "failed"), rec("d", "paused"), rec("e", "downloading"), rec("f", "expired")]);
  assert.deepEqual(s.active.map((r) => r.id), ["b", "e"]);
  assert.deepEqual(s.needsAttention.map((r) => r.id), ["c", "f"]);
  assert.deepEqual(s.downloaded.map((r) => r.id), ["a"]);
});

test("status labels, unknown shown as is", () => {
  assert.equal(downloadStatusLabel("processing"), "Preparing");
  assert.equal(downloadStatusLabel("ready"), "Downloaded");
  assert.equal(downloadStatusLabel("odd"), "odd");
});

test("decimal sizes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1500), "1.5 KB");
  assert.equal(formatBytes(1_500_000_000), "1.5 GB");
  assert.equal(formatBytes(250_000_000), "250 MB");
});

test("meta: status then size, progress while downloading", () => {
  assert.deepEqual(downloadMetaParts(rec("a", "ready", { sizeBytes: 2_000_000_000 })), ["Downloaded", "2 GB"]);
  assert.deepEqual(downloadMetaParts(rec("a", "downloading", { sizeBytes: 2_000_000_000, downloadedBytes: 500_000_000 })), ["Downloading", "500 MB of 2 GB"]);
  assert.deepEqual(downloadMetaParts(rec("a", "queued")), ["Queued"]);
});
