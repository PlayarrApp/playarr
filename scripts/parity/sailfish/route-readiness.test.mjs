import assert from "node:assert/strict";
import test from "node:test";
import { requireRouteReady, routeReadinessProbe, readOwnedRouteLog, routeLogCommand, serializeSteps } from "./route-readiness.mjs";

const marker = "--pc=a1b2c3d4";

test("detail route probes emit only a run-scoped ready marker after identity checks", () => {
  const probe = routeReadinessProbe(marker, "series", "fixture-series-123");
  assert.match(probe, /work\.kind==='series'/);
  assert.match(probe, /p\.work\.id==='fixture-series-123'/);
  assert.match(probe, /p\.detail\.work\.id===p\.work\.id/);
  assert.match(probe, new RegExp(`PLAYARR_CAPTURE_ROUTE_READY=${marker}`));
  assert.match(probe, new RegExp(`PLAYARR_CAPTURE_ROUTE_ERROR=${marker}`));
  assert.throws(() => routeReadinessProbe("--pc=bad", "movie"), /invalid Sailfish route marker/);
  assert.throws(() => routeReadinessProbe(marker, "music"), /invalid Sailfish detail kind/);
  assert.throws(() => routeReadinessProbe(marker, "series", "bad/id"), /invalid Sailfish detail id/);
});

test("detail readiness probe accepts only the requested current page and loaded detail", () => {
  const expression = routeReadinessProbe(marker, "series", "fixture-series-123").slice(3);
  const run = (page) => {
    const messages = [];
    Function("pageStack", "console", expression)({ currentPage: page }, { log: (message) => messages.push(message) });
    return messages;
  };
  const correct = { work: { kind: "series", id: "fixture-series-123" }, detail: { work: { kind: "series", id: "fixture-series-123" } } };
  assert.deepEqual(run(correct), [`PLAYARR_CAPTURE_ROUTE_READY=${marker}`]);
  assert.deepEqual(run({ ...correct, work: { ...correct.work, id: "fixture-other" } }), []);
  assert.deepEqual(run({ ...correct, work: { ...correct.work, kind: "movie" } }), []);
  assert.deepEqual(run({ ...correct, detail: null }), []);
  assert.deepEqual(run({ ...correct, failed: true }), [`PLAYARR_CAPTURE_ROUTE_ERROR=${marker}`]);
});

test("route preflight requires current-run readiness and rejects a reported failure", () => {
  assert.doesNotThrow(() => requireRouteReady(`PLAYARR_CAPTURE_ROUTE_READY=${marker}\n`, marker));
  assert.throws(() => requireRouteReady("", marker), /did not become ready/);
  assert.throws(() => requireRouteReady(`PLAYARR_CAPTURE_ROUTE_READY=${marker}\nPLAYARR_CAPTURE_ROUTE_ERROR=${marker}`, marker), /reported a load failure/);
  assert.throws(() => requireRouteReady("PLAYARR_CAPTURE_ROUTE_READY=--pc=00000000", marker), /did not become ready/);
});

test("PLAYARR_STEPS stays below the booster limit and preserves step boundaries", () => {
  const serialized = serializeSteps("dark", ["wait", "js:pageStack.currentPage.openFirst('series')", routeReadinessProbe(marker, "series")]);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 3500);
  assert.deepEqual(serialized.split("|"), ["js:Api.themeMode='dark'", "wait", "js:pageStack.currentPage.openFirst('series')", routeReadinessProbe(marker, "series")]);
  assert.throws(() => serializeSteps("dark", ["js:" + "x".repeat(3500)]), /maximum is 3499/);
  assert.throws(() => serializeSteps("dark", ["js:a||b"]), /reserved pipe delimiter/);
  assert.match(routeLogCommand(321), /journalctl -b --no-pager _PID=321/);
  const calls = [];
  const fakeSsh = (user, command) => {
    calls.push([user, command]);
    return calls.length === 1 ? "321 998877 1\n" : `PLAYARR_CAPTURE_ROUTE_READY=${marker}`;
  };
  assert.equal(readOwnedRouteLog(fakeSsh, { pid: 321, starttime: "998877", marker }), `PLAYARR_CAPTURE_ROUTE_READY=${marker}`);
  assert.ok(calls.every(([user]) => user === "root"), "journal reads use root after process ownership verification");
  assert.match(calls[1][1], /_PID=321/);
  assert.throws(() => readOwnedRouteLog((user) => user === "root" ? "322 998877 1\n" : "", { pid: 321, starttime: "998877", marker }), /identity changed/);
});
