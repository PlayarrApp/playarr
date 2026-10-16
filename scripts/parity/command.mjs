import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function processStartTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19] ?? null;
  } catch {
    return null;
  }
}

function childPids(pid) {
  try {
    return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function rememberTree(pid, seen, expectedStart) {
  const actualStart = processStartTime(pid);
  if (!actualStart || (expectedStart && actualStart !== expectedStart)) return;
  const previousStart = seen.get(pid);
  if (previousStart && previousStart !== actualStart) return;
  seen.set(pid, actualStart);
  for (const child of childPids(pid)) rememberTree(child, seen);
}

function signalOwned(pid, starttime, signal) {
  if (!starttime || processStartTime(pid) !== starttime) return;
  try { process.kill(pid, signal); } catch { /* the observed process may have exited */ }
}

function timeoutError(command, stdout, stderr) {
  const error = new Error(`command timed out: ${command}`);
  error.code = "ETIMEDOUT";
  error.killed = true;
  error.signal = "SIGTERM";
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

export function commandTimeout({ timeout = 90000, deadlineMs, now = Date.now() } = {}) {
  if (!Number.isFinite(timeout) || timeout < 1) throw new Error("command timeout must be a positive number");
  if (deadlineMs === undefined) return timeout;
  const remaining = Math.floor(deadlineMs - now);
  return remaining < 1 ? 0 : Math.min(timeout, remaining);
}

// Fire TV runs on Linux. Fail closed elsewhere because /proc ancestry is the
// proof used to limit timeout cleanup to this command's observed descendants.
export function execFileBounded(command, args, options = {}) {
  if (!existsSync("/proc/self/stat")) return Promise.reject(new Error("bounded Fire TV commands require Linux /proc process ancestry"));
  const { timeout = 90000, deadlineMs, maxBuffer = 1024 * 1024, ...spawnOptions } = options;
  const boundedTimeout = commandTimeout({ timeout, deadlineMs });
  if (boundedTimeout === 0) return Promise.reject(timeoutError(command, "", ""));

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] });
    const seen = new Map();
    let rootStart = null;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let stopReason = null;
    let cleanupPromise = null;
    let settled = false;
    let closed = false;

    const finish = (error, code, signal) => {
      if (settled) return;
      settled = true;
      clearInterval(scanner);
      clearTimeout(timer);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else if (code !== 0) {
        const failure = new Error(stderr || `command exited with code ${code}: ${command}`);
        failure.code = code;
        failure.signal = signal;
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
      } else resolve({ stdout, stderr });
    };

    const completeStop = () => {
      if (!closed || !cleanupPromise) return;
      cleanupPromise.then(() => {
        if (stopReason === "timeout") finish(timeoutError(command, stdout, stderr));
        else {
          const error = new Error(`command exceeded maxBuffer: ${command}`);
          error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          error.killed = true;
          error.signal = "SIGTERM";
          error.maxBuffer = maxBuffer;
          finish(error);
        }
      });
    };

    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        if (child.pid && rootStart && processStartTime(child.pid) === rootStart) {
          rememberTree(child.pid, seen, rootStart);
          for (const [pid, starttime] of [...seen.entries()].reverse()) {
            if (pid !== child.pid) signalOwned(pid, starttime, "SIGTERM");
          }
          signalOwned(child.pid, rootStart, "SIGTERM");
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
          if (processStartTime(child.pid) === rootStart) rememberTree(child.pid, seen, rootStart);
          for (const [pid, starttime] of [...seen.entries()].reverse()) signalOwned(pid, starttime, "SIGKILL");
        }
      })().catch(() => {});
      return cleanupPromise;
    };

    child.once("spawn", () => {
      rootStart = processStartTime(child.pid);
      if (rootStart) rememberTree(child.pid, seen, rootStart);
    });
    const scanner = setInterval(() => {
      if (child.pid && rootStart) rememberTree(child.pid, seen, rootStart);
    }, 20);
    scanner.unref();

    const onData = (target) => (chunk) => {
      if (stopReason) return;
      if (outputBytes + chunk.length > maxBuffer) {
        const accepted = Math.max(0, maxBuffer - outputBytes);
        if (target === "stdout") stdout += chunk.subarray(0, accepted).toString();
        else stderr += chunk.subarray(0, accepted).toString();
        stopReason = "maxBuffer";
        cleanup().then(completeStop);
        return;
      }
      outputBytes += chunk.length;
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      closed = true;
      if (stopReason) completeStop();
      else finish(null, code, signal);
    });
    const timer = setTimeout(() => {
      if (stopReason) return;
      stopReason = "timeout";
      cleanup().then(completeStop);
    }, boundedTimeout);
  });
}
