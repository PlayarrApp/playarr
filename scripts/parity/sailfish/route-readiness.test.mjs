import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DIAGNOSTIC_SINK_LIMIT, formatOwnedDiagnostics, ownedDiagnosticCommand, preserveBeforeCleanup, requireRouteReady, routeReadinessProbe, readOwnedRouteLog, routeLogCommand, selectCanonicalRouteLog, serializeSteps } from "./route-readiness.mjs";

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
  assert.match(routeLogCommand(321), /cat \/run\/user\/100000\/pa\.log/);
  assert.match(routeLogCommand(321), /journalctl -b --no-pager -o cat _PID=321/);
  const duplicateSinkLog = "__PLAYARR_PA_LOG__\nPARITY|key|4|press\nPARITY|key|4|release\n__PLAYARR_PID_JOURNAL__\nPARITY|key|4|press\nPARITY|key|4|release\nPARITY|keydone|4";
  assert.equal(selectCanonicalRouteLog(duplicateSinkLog), "PARITY|key|4|press\nPARITY|key|4|release");
  assert.equal(selectCanonicalRouteLog("__PLAYARR_PA_LOG__\nordinary startup output\n__PLAYARR_PID_JOURNAL__\nPARITY|screen|/"), "PARITY|screen|/");
  assert.throws(() => selectCanonicalRouteLog("unbounded combined logs"), /source boundaries/);
  const calls = [];
  const fakeSsh = (user, command) => {
    calls.push([user, command]);
    return calls.length === 1 ? "321 998877 1\n" : `__PLAYARR_PA_LOG__\nPLAYARR_CAPTURE_ROUTE_READY=${marker}\n__PLAYARR_PID_JOURNAL__\nPLAYARR_CAPTURE_ROUTE_READY=${marker}`;
  };
  assert.equal(readOwnedRouteLog(fakeSsh, { pid: 321, starttime: "998877", marker }), `PLAYARR_CAPTURE_ROUTE_READY=${marker}`);
  assert.ok(calls.every(([user]) => user === "root"), "owned log reads use root after process ownership verification");
  assert.match(calls[1][1], /pa\.log/);
  assert.throws(() => readOwnedRouteLog((user) => user === "root" ? "322 998877 1\n" : "", { pid: 321, starttime: "998877", marker }), /identity changed/);
});

test("owned failure diagnostics verify process identity and retain bounded separate sinks", () => {
  const identity = { pid: 321, starttime: "998877", marker };
  const command = ownedDiagnosticCommand(identity);
  assert.match(command, /expected_start='998877'/);
  assert.match(command, /grep -Fxq -- "\$marker"/);
  assert.match(command, /tail -c 65536 \/run\/user\/100000\/pa\.log/);
  assert.match(command, /journalctl -b --no-pager -o cat _PID="\$pid".*tail -c 65536/s);
  const syntax = spawnSync("sh", ["-n"], { input: command, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.throws(() => ownedDiagnosticCommand({ ...identity, pid: 0 }), /invalid Sailfish diagnostic process identity/);
  assert.throws(() => ownedDiagnosticCommand(identity, DIAGNOSTIC_SINK_LIMIT + 1), /invalid Sailfish diagnostic limit/);

  const redactionAddress = [198, 51, 100, 4].join(".");
  const paLog = `${"x".repeat(70000)} start https://private.invalid/path?token=credential ${redactionAddress}`;
  const journal = `${"y".repeat(70000)} actual route access_token=credential`;
  const output = `__PLAYARR_DIAGNOSTIC_META__ pid=321 start=998877\n__PLAYARR_DIAGNOSTIC_PA_LOG__\n${paLog}\n__PLAYARR_DIAGNOSTIC_PID_JOURNAL__\n${journal}`;
  const saved = formatOwnedDiagnostics(output, identity, ["credential"]);
  const [savedPa, savedJournal] = saved.split("\n[owned-pid journal]\n");
  assert.ok(Buffer.byteLength(savedPa) < DIAGNOSTIC_SINK_LIMIT + 128);
  assert.ok(Buffer.byteLength(savedJournal) < DIAGNOSTIC_SINK_LIMIT + 128);
  assert.match(saved, /\[redacted-url\]/);
  assert.match(saved, /\[redacted-address\]/);
  assert.doesNotMatch(saved, /credential|198\.51\.100\.4/);
  assert.match(saved, /actual route/);
  assert.throws(() => formatOwnedDiagnostics(output.replace("start=998877", "start=wrong"), identity), /source boundaries/);
  assert.throws(() => formatOwnedDiagnostics(output, identity, [], DIAGNOSTIC_SINK_LIMIT + 1), /invalid Sailfish diagnostic limit/);
});

test("diagnostic preservation happens before cleanup and cannot skip cleanup on error", () => {
  const order = [];
  preserveBeforeCleanup(() => order.push("snapshot"), () => order.push("cleanup"));
  assert.deepEqual(order, ["snapshot", "cleanup"]);

  order.length = 0;
  assert.throws(() => preserveBeforeCleanup(() => { order.push("snapshot"); throw new Error("snapshot failed"); }, () => order.push("cleanup")), /cleanup completed, but diagnostics could not be preserved/);
  assert.deepEqual(order, ["snapshot", "cleanup"]);

  order.length = 0;
  assert.throws(() => preserveBeforeCleanup(() => { order.push("snapshot"); throw new Error("snapshot failed"); }, () => { order.push("cleanup"); throw new Error("cleanup failed"); }), AggregateError);
  assert.deepEqual(order, ["snapshot", "cleanup"]);
});
