import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { commandTimeout, execFileBounded } from "./command.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("command timeout is capped by the caller's startup or readiness deadline", () => {
  assert.equal(commandTimeout({ timeout: 90000, deadlineMs: 15_500, now: 10_000 }), 5_500);
  assert.equal(commandTimeout({ timeout: 90000, deadlineMs: 100_500, now: 10_000 }), 90000);
  assert.equal(commandTimeout({ timeout: 90000, deadlineMs: 10_000, now: 10_000 }), 0);
});

test("timed-out commands clean up only their observed descendant processes", async () => {
  const script = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "console.log(child.pid);",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const started = Date.now();
  let timeoutError;
  try {
    await execFileBounded(process.execPath, ["-e", script], { timeout: 10000, deadlineMs: started + 180, maxBuffer: 1024 });
  } catch (error) {
    timeoutError = error;
  }
  assert.equal(timeoutError?.code, "ETIMEDOUT");
  assert.ok(Date.now() - started < 1500, "command should stop within a bounded cleanup interval");
  const childPid = Number(timeoutError.stdout.trim());
  assert.ok(Number.isSafeInteger(childPid) && childPid > 1, "test child PID should be captured from command output");
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const stat = await readFile(`/proc/${childPid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/, 1)[0];
      if (state === "Z") return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await sleep(25);
  }
  assert.fail(`descendant process ${childPid} remained live after timeout cleanup`);
});
