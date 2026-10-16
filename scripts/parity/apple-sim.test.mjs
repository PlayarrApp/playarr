import assert from "node:assert/strict";
import test from "node:test";
import { appleDeterministicLaunchArgs, assertAppleReadinessScreen, MacFocusKeyCollector, MacFocusLogCursor, serializeMacFocusKeyMarker } from "./drivers/apple-sim.mjs";

test("Apple stable capture pins the app clock and disables SwiftUI animations", () => {
  assert.deepEqual(appleDeterministicLaunchArgs("2026-10-07T12:00:00Z", true), [
    "-PlayarrParityNow", "2026-10-07T12:00:00Z", "-PlayarrDisableAnimations",
  ]);
  assert.throws(() => appleDeterministicLaunchArgs("not-a-date", true), /valid fixedNow/);
  assert.throws(() => appleDeterministicLaunchArgs("2026-10-07T12:00:00Z", false), /disableAnimations/);
});

test("Apple stable readiness throws when a screen is unsupported", () => {
  assertAppleReadinessScreen("home");
  assert.throws(() => assertAppleReadinessScreen("detail-movie", "Apple tvOS"), /readiness unsupported for screen: detail-movie/);
});

const entry = "PlayarrMacFocusKeyEntry seq=12 direction=right text_responder=false window_key=true";
const result = "PlayarrMacFocusKey seq=12 direction=right responder=other text_edit_excluded=false before_focused=false before_fallback_focused_present=false before_fallback_equals_before=true after_focused=true after_equals_before=false fallback_ran=true registered_target_candidates=3 chosen_frame=10.0,20.0,30.0,40.0 focused_binding=true focused_binding_count=1";

test("Mac focus collector emits safe entry-only markers and serialises marker lines", () => {
  const collector = new MacFocusKeyCollector();
  const [record] = collector.feed(`private preface ${entry}\n`);
  assert.equal(record.marker, entry);
  assert.equal(record.kind, "entry");
  assert.equal(record.sequence, 12);
  const artifactLine = serializeMacFocusKeyMarker(record);
  assert.deepEqual(JSON.parse(artifactLine), { sequence: 12, direction: "right", kind: "entry", marker: entry });
  assert.doesNotMatch(artifactLine, /private preface|UUID|title|label/);
  assert.deepEqual(collector.feed(`${entry}\n`), []);
});

test("Mac focus collector retains partial lines and late results without duplicate entries", () => {
  const collector = new MacFocusKeyCollector();
  assert.deepEqual(collector.feed(`${entry.slice(0, 29)}`), []);
  const firstPart = collector.feed(`${entry.slice(29)}\n`);
  assert.equal(firstPart.length, 1);
  assert.equal(firstPart[0].marker, entry);
  assert.deepEqual(collector.feed(`${entry}\n`), []);
  const lateResult = collector.feed(`private text ${result}\n`, { final: true });
  assert.equal(lateResult.length, 1);
  assert.equal(lateResult[0].kind, "result");
  assert.equal(lateResult[0].sequence, firstPart[0].sequence);
  const artifactLine = serializeMacFocusKeyMarker(lateResult[0]);
  assert.deepEqual(JSON.parse(artifactLine), { sequence: 12, direction: "right", kind: "result", marker: result });
  assert.doesNotMatch(artifactLine, /private text|UUID|title|label/);
});

test("Mac focus cursor excludes stale launch bytes and resets after truncation or replacement", () => {
  const cursor = new MacFocusLogCursor();
  const stale = Buffer.from(`private stale ${entry}\n`);
  cursor.reset("dev:old-inode", stale.length);
  const appended = Buffer.from(`${result}\n`);
  const combined = Buffer.concat([stale, appended]);
  const start = cursor.start("dev:old-inode", combined.length);
  assert.equal(combined.subarray(start).toString("utf8"), `${result}\n`);
  const collector = new MacFocusKeyCollector();
  const [freshRecord] = collector.feed(combined.subarray(start).toString("utf8"));
  assert.equal(freshRecord.kind, "result");
  assert.equal(freshRecord.marker, result);
  collector.feed("partial old process line");
  collector.reset();
  assert.deepEqual(collector.feed(`${entry}\n`), [{ sequence: 12, direction: "right", kind: "entry", marker: entry }]);
  cursor.advance("dev:old-inode", combined.length);
  assert.equal(cursor.start("dev:old-inode", 10), 0);
  cursor.advance("dev:old-inode", 280);
  assert.equal(cursor.start("dev:new-inode", 300), 0);
});

test("Mac focus collector rejects malformed and unrelated log lines", () => {
  const collector = new MacFocusKeyCollector();
  assert.deepEqual(collector.feed([
    "private arbitrary log line",
    "PlayarrMacFocusKeyEntry seq=12 direction=right text_responder=maybe window_key=true",
    "PlayarrMacFocusKey seq=12 direction=right arbitrary=private",
  ].join("\n") + "\n"), []);
});
