import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  APP_ARGV, APP_EXE, appIdentityReceipt, cleanupAppProcessScript, newProcessMarker,
  parseAppProcesses, requireSingleAppProcess, scanAppProcessesScript,
} from "./process.mjs";

const marker = newProcessMarker(Buffer.from("a1b2c3d4", "hex"));

test("Sailfish capture marker is short, unique, and validated", () => {
  assert.equal(marker, "--pc=a1b2c3d4");
  assert.throws(() => scanAppProcessesScript("--pc=too-long-marker"), /invalid Sailfish process marker/);
});

test("process preflight parses NUL-separated argv and requires exactly one marked app", () => {
  const script = scanAppProcessesScript(marker);
  assert.match(script, /tr '\\000' '\\n'/);
  assert.match(script, new RegExp(`expected='${APP_EXE}'`));
  assert.match(script, new RegExp(`app='${APP_ARGV}'`));
  assert.match(script, /while \[ "\$i" -lt 20 \]/); // proc stat field 22, after fields 1-2
  assert.deepEqual(requireSingleAppProcess("321 998877 1\n", marker), {
    pid: 321, starttime: "998877", markerPresent: true, marker,
  });
  assert.throws(() => requireSingleAppProcess("", marker), /expected one marked app, found 0/);
  assert.throws(() => requireSingleAppProcess("321 998877 0\n", marker), /expected one marked app, found 1/);
  assert.throws(() => requireSingleAppProcess("321 998877 1\n322 998900 1\n", marker), /expected one marked app, found 2/);
  assert.deepEqual(parseAppProcesses("", marker), []);
});

test("cleanup rechecks PID, start time, executable, app argv, and marker before signalling", () => {
  const script = cleanupAppProcessScript({ pid: 321, starttime: "998877", marker });
  for (const expected of [
    "pid='321'", "expected_start='998877'", `expected_exe='${APP_EXE}'`, `app='${APP_ARGV}'`, `marker='${marker}'`,
    "[ \"$exe\" = \"$expected_exe\" ] || return 1", "[ \"$1\" = \"$expected_start\" ] || return 1", "kill -TERM \"$pid\"", "kill -KILL \"$pid\"",
    "owned Playarr process persisted after KILL", "exit 1",
  ]) assert.ok(script.includes(expected), `missing ownership check: ${expected}`);
  assert.ok(script.indexOf("kill -TERM") > script.indexOf("grep -Fxq -- \"$marker\""));
  assert.ok(script.indexOf("kill -KILL") > script.indexOf("still_owned || exit 0", script.indexOf("kill -TERM")));
  assert.ok(script.lastIndexOf("still_owned || exit 0") > script.indexOf("kill -KILL"), "ownership is polled after KILL");
  assert.throws(() => cleanupAppProcessScript({ pid: 0, starttime: "1", marker }), /invalid Sailfish process identity/);
});

test("identity receipt contains only the successful app identity and capture time", () => {
  assert.deepEqual(appIdentityReceipt({ pid: 321, starttime: "998877", marker, markerPresent: true }, new Date("2026-10-16T05:00:00.000Z")), {
    pid: 321,
    start_ticks: "998877",
    marker,
    capturedAt: "2026-10-16T05:00:00.000Z",
  });
  assert.deepEqual(appIdentityReceipt({ pid: 322, starttime: "998878", marker, markerPresent: false }, new Date("2026-10-16T05:00:00.000Z")), {
    pid: 322,
    start_ticks: "998878",
    marker: "none",
    capturedAt: "2026-10-16T05:00:00.000Z",
  });
  assert.throws(() => appIdentityReceipt({ pid: 0, starttime: "1", marker }), /invalid Sailfish process identity/);
  assert.throws(() => appIdentityReceipt({ pid: 321, starttime: "998877", marker: "--pc=invalid", markerPresent: true }), /invalid Sailfish process marker/);
});

test("generated remote process scripts have valid POSIX shell syntax", () => {
  const scripts = [scanAppProcessesScript(marker), cleanupAppProcessScript({ pid: 321, starttime: "998877", marker })];
  for (const script of scripts) {
    const result = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});
