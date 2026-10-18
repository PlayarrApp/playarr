import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { decodeFocus, hasKeyAckPair, hasKeyCompletion, hasNextKeyAckPair, hasNextKeyAckPress, keyCommand, nextCompletedKeySequence, nextKeyAckPress, parseParityEvents } from "./navigation.mjs";

test("maps suite navigation actions to VNC keysyms", () => {
  assert.deepEqual(["left", "right", "up", "down", "select", "back"].map(keyCommand), ["LEFT", "RIGHT", "UP", "DOWN", "ENTER", "ESC"]);
  assert.throws(() => keyCommand("unknown"), /unsupported Sailfish navigation key/);
});

test("reads the newest route and focus event from app logs", () => {
  const events = parseParityEvents([
    "QML debug: PARITY|screen|/",
    "QML debug: PARITY|focus|Sample%20Card|0|0",
    "QML debug: PARITY|screen|/movies",
    "QML debug: PARITY|focus|Sample%20Card%20B|1|2",
  ].join("\n"));
  assert.equal(events.screen, "/movies");
  assert.deepEqual(decodeFocus(events.focus), { label: "Sample Card B", position: { rail: 1, index: 2 } });
});

test("reads actual player state without exposing a media identifier", () => {
  assert.deepEqual(parseParityEvents("PARITY|player|1|4|0|1").player, {
    state: 1, positionSeconds: 4, menuOpen: false, controls: true,
  });
});

test("retains Qt key press and release acknowledgements in order", () => {
  const events = parseParityEvents("PARITY|key|1|press\nPARITY|key|1|release\nPARITY|keydone|1\nPARITY|key|bad|repeat");
  assert.deepEqual(events.keyAcks, [{ sequence: 1, edge: "press" }, { sequence: 1, edge: "release" }]);
  assert.deepEqual(events.keyCompletions, [1]);
});

test("requires both edges from the same newly injected key sequence", () => {
  const events = parseParityEvents("PARITY|key|4|press\nPARITY|key|5|press\nPARITY|key|4|release").keyAcks;
  assert.equal(hasKeyAckPair(events, 4), true);
  assert.equal(hasKeyAckPair(events, 5), false);
  assert.equal(hasKeyAckPair(events, 3), false);
  assert.equal(hasKeyAckPair(events, 4, 1), false);
  assert.equal(hasNextKeyAckPress(events, 1), true);
  assert.equal(hasNextKeyAckPair(events, 1), false);
  assert.equal(hasNextKeyAckPair(events, 0), true);
  assert.equal(nextKeyAckPress(events), 4);
  assert.equal(nextCompletedKeySequence(events), 4);
  assert.equal(nextCompletedKeySequence(events, 1), null);
  const complete = parseParityEvents("PARITY|key|1|press\nPARITY|key|1|release").keyAcks;
  assert.equal(hasNextKeyAckPair(complete), true);
});

test("navigation completion must match the acknowledged key sequence", () => {
  const events = parseParityEvents("PARITY|key|7|press\nPARITY|key|7|release\nPARITY|keydone|6\nPARITY|keydone|7");
  assert.equal(hasKeyAckPair(events.keyAcks, 7), true);
  assert.equal(hasKeyCompletion(events.keyCompletions, 7), true);
  assert.equal(hasKeyCompletion(events.keyCompletions, 6), true);
  assert.equal(hasKeyCompletion(events.keyCompletions, 8), false);
  assert.equal(hasKeyCompletion([], 7), false);
});

test("returns no focus when telemetry is absent and preserves nonnumeric rails", () => {
  assert.equal(decodeFocus(null), null);
  assert.deepEqual(decodeFocus({ label: "Play", rail: "nav", index: "1" }), { label: "Play", position: { rail: "nav", index: 1 } });
  assert.deepEqual(decodeFocus({ label: "Play", rail: "nav" }), { label: "Play" });
  assert.deepEqual(decodeFocus({ label: "Play", rail: "nav", index: "" }), { label: "Play" });
  assert.deepEqual(decodeFocus({ label: "Play", rail: "nav", index: "-1" }), { label: "Play" });
  assert.deepEqual(decodeFocus({ label: "Play", rail: "bad rail", index: "2" }), { label: "Play" });
});

test("uses content coordinates and the true top or bottom row for grid edge checks", () => {
  const source = readFileSync(new URL("../../../clients/sailfish/qml/components/DpadGeometry.js", import.meta.url), "utf8");
  const context = {};
  vm.runInNewContext(source.replace(/^\.pragma library\s*/, "") + "\nthis.geometry = { edgePoint, shouldScrollGrid, gridNeighbourIndex, shouldScrollGridIntoView, clampedScrollOffset, isHomeInitialContentTarget, beginNavigationKey, pendingKeySequence, consumeKeyCompletion, markNavigationKeyReleased, markNavigationSettled };", context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.geometry.edgePoint(0, 300, 400, 240, 0, -1))), { x: 200, y: 301 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.geometry.edgePoint(400, 0, 240, 400, 1, 0))), { x: 639, y: 200 });
  assert.equal(context.geometry.shouldScrollGrid(16, 24, 4, 19, 1), true);
  assert.equal(context.geometry.shouldScrollGrid(4, 24, 4, 4, -1), true);
  assert.equal(context.geometry.shouldScrollGrid(0, 24, 4, 3, -1), false);
  assert.equal(context.geometry.shouldScrollGrid(23, 24, 4, 20, 1), false);
  assert.equal(context.geometry.gridNeighbourIndex(5, 24, 4, 0, -1), 1);
  assert.equal(context.geometry.gridNeighbourIndex(5, 24, 4, 0, 1), 9);
  assert.equal(context.geometry.gridNeighbourIndex(4, 24, 4, -1, 0), -1);
  assert.equal(context.geometry.gridNeighbourIndex(7, 24, 4, 1, 0), -1);
  assert.equal(context.geometry.gridNeighbourIndex(7, 10, 4, 0, 1), 9);
  assert.equal(context.geometry.gridNeighbourIndex(9, 10, 4, 0, 1), -1);
  // Use the focused card's mapped viewport position and real item height.
  // Scroll when any part of the next card would be clipped, including a
  // partially visible card near the viewport edge.
  assert.equal(context.geometry.shouldScrollGridIntoView(6, 24, 2, 1, 600, 250, 200, 800), true);
  assert.equal(context.geometry.shouldScrollGridIntoView(6, 24, 2, 1, 604.3846, 189, 155.6154, 881.8462), true);
  assert.equal(context.geometry.shouldScrollGridIntoView(4, 24, 2, 1, 350, 250, 200, 800), false);
  assert.equal(context.geometry.shouldScrollGridIntoView(8, 24, 2, -1, 350, 250, 200, 800), false);
  assert.equal(context.geometry.shouldScrollGridIntoView(2, 24, 2, -1, 100, 300, 180, 800), true);
  assert.equal(context.geometry.shouldScrollGridIntoView(22, 24, 2, 1, 600, 250, 200, 800), false);
  assert.equal(context.geometry.clampedScrollOffset(151.6154, -189, 1800, 881.8462, 0, 37.3846, 0), -37.3846);
  assert.equal(context.geometry.clampedScrollOffset(-37.3846, -189, 1800, 881.8462, 0, 37.3846, 0), -37.3846);
  assert.equal(context.geometry.isHomeInitialContentTarget({ work: {}, parityRail: 0, parityIndex: 0 }), true);
  assert.equal(context.geometry.isHomeInitialContentTarget({ objectName: "parity-nav-profile", parityRail: 0, parityIndex: 0 }), false);
  const first = context.geometry.beginNavigationKey();
  const second = context.geometry.beginNavigationKey();
  assert.equal(second, first + 1);
  assert.equal(context.geometry.pendingKeySequence(), second);
  assert.equal(context.geometry.markNavigationSettled(second), true);
  assert.equal(context.geometry.consumeKeyCompletion(first), false);
  assert.equal(context.geometry.pendingKeySequence(), second);
  assert.equal(context.geometry.consumeKeyCompletion(second), false);
  assert.equal(context.geometry.markNavigationKeyReleased(second), true);
  assert.equal(context.geometry.consumeKeyCompletion(second), true);
  assert.equal(context.geometry.pendingKeySequence(), 0);
  assert.equal(context.geometry.consumeKeyCompletion(second), false);
  const third = context.geometry.beginNavigationKey();
  assert.equal(context.geometry.markNavigationKeyReleased(third), true);
  assert.equal(context.geometry.consumeKeyCompletion(third), false);
  assert.equal(context.geometry.markNavigationSettled(third), true);
  assert.equal(context.geometry.consumeKeyCompletion(third), true);
});
