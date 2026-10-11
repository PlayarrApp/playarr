// entry/src/test/DownloadEngine.test.ts: core/DownloadEngine.ts against web lib/downloadEngine.ts and downloadsDb.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  chunkFailureStatus, chunkReplyOk, chunkRetryable, downloadFileName, keepUntilLabel, keepUntilLapsed, lapsedDownloadIds,
  downloadOptionLabel, keepPresets, keepUntilFromPreset, validQuality, nextChunkRange, nextStep, normaliseKeepUntil, parseIndex, rangeHeader, serializeIndex, statusFromTicket, withSavedBytes,
} from "../main/ets/core/DownloadEngine";
import type { DownloadTicket } from "../main/ets/core/DownloadEngine";
import type { DownloadRecord } from "../main/ets/core/Downloads";

const rec = (over: Partial<DownloadRecord> = {}): DownloadRecord => ({ id: "r", title: "T", status: "queued", ...over });
const ticket = (over: Partial<DownloadTicket> = {}): DownloadTicket => ({ id: "t", media_file_id: "m", quality_id: "original",
  status: "ready", container: "mp4", size_bytes: 100, requested_at: "2026-10-11T00:00:00Z", ready_at: null, expires_at: null, error_message: null, ...over });

test("next step: create, poll, fetch, done, stop", () => {
  assert.equal(nextStep(rec(), null), "createTicket");
  assert.equal(nextStep(rec({ ticketId: "t" }), null), "pollTicket");
  assert.equal(nextStep(rec({ ticketId: "t" }), ticket({ status: "queued" })), "pollTicket");
  assert.equal(nextStep(rec({ ticketId: "t", downloadedBytes: 10 }), ticket()), "fetchChunk");
  assert.equal(nextStep(rec({ ticketId: "t", downloadedBytes: 100 }), ticket()), "done");
  assert.equal(nextStep(rec({ ticketId: "t" }), ticket({ status: "failed" })), "stop");
  assert.equal(nextStep(rec({ status: "paused", ticketId: "t" }), ticket()), "stop");
  assert.equal(nextStep(rec({ status: "canceled" }), null), "stop");
});

test("local status follows the ticket; ready with bytes missing is downloading", () => {
  assert.equal(statusFromTicket("queued", 0, null), "queued");
  assert.equal(statusFromTicket("processing", 0, null), "processing");
  assert.equal(statusFromTicket("ready", 10, 100), "downloading");
  assert.equal(statusFromTicket("ready", 100, 100), "ready");
  assert.equal(statusFromTicket("expired", 0, null), "expired");
});

test("ranges: chunked, clamped to the size, null when complete", () => {
  assert.deepEqual(nextChunkRange(0, 25, 10), { from: 0, to: 9 });
  assert.deepEqual(nextChunkRange(20, 25, 10), { from: 20, to: 24 });
  assert.equal(nextChunkRange(25, 25, 10), null);
  assert.deepEqual(nextChunkRange(5, null, 10), { from: 5, to: 14 });
  assert.equal(rangeHeader({ from: 20, to: 24 }), "bytes=20-24");
});

test("chunk replies: 206 always, 200 only from the start; retry rules", () => {
  assert.equal(chunkReplyOk(206, 10), true);
  assert.equal(chunkReplyOk(200, 0), true);
  assert.equal(chunkReplyOk(200, 10), false);
  assert.equal(chunkRetryable(0), true);
  assert.equal(chunkRetryable(503), true);
  assert.equal(chunkRetryable(403), false);
  assert.equal(chunkFailureStatus(410), "expired");
  assert.equal(chunkFailureStatus(403), "failed");
});

test("saving bytes advances the record and completes it", () => {
  const a = withSavedBytes(rec({ sizeBytes: 100, downloadedBytes: 40, status: "downloading" }), 30);
  assert.equal(a.downloadedBytes, 70);
  assert.equal(a.status, "downloading");
  assert.equal(withSavedBytes(a, 30).status, "ready");
});

test("keep-until: normalising, lapsing and labels", () => {
  assert.deepEqual(normaliseKeepUntil(undefined), { kind: "forever" });
  assert.deepEqual(normaliseKeepUntil({ kind: "date", date: "2026-10-12" }), { kind: "date", date: "2026-10-12" });
  assert.deepEqual(normaliseKeepUntil({ kind: "date", date: "soon" }), { kind: "forever" });
  assert.deepEqual(normaliseKeepUntil({ kind: "afterWatched", amount: 0, unit: "days" }), { kind: "forever" });
  const day = (iso: string) => Date.parse(iso);
  assert.equal(keepUntilLapsed(rec({ keepUntil: { kind: "date", date: "2026-10-12" } }), day("2026-10-12T23:00:00Z")), false);
  assert.equal(keepUntilLapsed(rec({ keepUntil: { kind: "date", date: "2026-10-12" } }), day("2026-10-13T00:00:00Z")), true);
  const watched = rec({ keepUntil: { kind: "afterWatched", amount: 1, unit: "weeks" }, watchedAt: "2026-10-01T00:00:00Z" });
  assert.equal(keepUntilLapsed(watched, day("2026-10-07T00:00:00Z")), false);
  assert.equal(keepUntilLapsed(watched, day("2026-10-08T00:00:00Z")), true);
  assert.equal(keepUntilLapsed(rec({ keepUntil: { kind: "afterWatched", amount: 1, unit: "days" } }), day("2030-01-01T00:00:00Z")), false);
  assert.equal(keepUntilLabel({ kind: "date", date: "2026-10-12" }), "Keep until 12/10/2026");
  assert.equal(keepUntilLabel({ kind: "afterWatched", amount: 3, unit: "days" }), "Keep 3 days after watched");
  assert.equal(keepUntilLabel(undefined), "Keep forever");
});

test("only ready downloads can lapse", () => {
  const past = { kind: "date", date: "2020-01-01" };
  assert.deepEqual(lapsedDownloadIds([rec({ id: "a", status: "ready", keepUntil: past }), rec({ id: "b", status: "queued", keepUntil: past })], Date.now()), ["a"]);
});

test("the saved index round-trips; unreadable text is empty; in-flight records resume queued", () => {
  const records = [rec({ id: "a", status: "ready" }), rec({ id: "b", status: "downloading" }), rec({ id: "c", status: "processing" })];
  const back = parseIndex(serializeIndex(records));
  assert.deepEqual(back.map((r) => [r.id, r.status]), [["a", "ready"], ["b", "queued"], ["c", "queued"]]);
  assert.deepEqual(parseIndex("not json"), []);
  assert.deepEqual(parseIndex('{"a":1}'), []);
  assert.deepEqual(parseIndex('[{"id":1},{"id":"x","title":"t","status":"ready"}]').map((r) => r.id), ["x"]);
});

test("file names are safe", () => {
  assert.equal(downloadFileName("a1-b2", "mp4"), "a1-b2.mp4");
  assert.equal(downloadFileName("../x/y", "m p4"), "xy.mp4");
  assert.equal(downloadFileName("abc", ""), "abc");
});

test("quality labels: size with ~ for an estimate, per item for many files", () => {
  const original = { id: "original", label: "Original", estimated_size_bytes: 2_000_000_000, size_is_estimate: false };
  const profile = { id: "p", label: "1080p 8 Mbps", estimated_size_bytes: 900_000_000, size_is_estimate: true };
  assert.equal(downloadOptionLabel(original, 1), "Original · 2 GB");
  assert.equal(downloadOptionLabel(profile, 1), "1080p 8 Mbps · ~900 MB");
  assert.equal(downloadOptionLabel(profile, 8), "1080p 8 Mbps · ~900 MB per item");
  assert.equal(downloadOptionLabel({ ...original, estimated_size_bytes: null }, 1), "Original");
  assert.equal(validQuality([original, profile], "p"), "p");
  assert.equal(validQuality([original], "gone"), "original");
});

test("keep-until presets and their policies", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  assert.deepEqual(keepPresets(now).map((p) => p.value), ["forever", "watched7", "watched30", "date30"]);
  assert.equal(keepPresets(now)[3].label, "Keep until 2026-11-10");
  assert.deepEqual(keepUntilFromPreset("forever", now), { kind: "forever" });
  assert.deepEqual(keepUntilFromPreset("watched7", now), { kind: "afterWatched", amount: 7, unit: "days" });
  assert.deepEqual(keepUntilFromPreset("date30", now), { kind: "date", date: "2026-11-10" });
  assert.deepEqual(keepUntilFromPreset("nonsense", now), { kind: "forever" });
});
