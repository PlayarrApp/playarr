#!/usr/bin/env node

const args = process.argv.slice(2);
const mode = process.env.PLAYARR_PARITY_FAKE_ADB_HANG;
const hangs = (command) => {
  if (mode !== command) return false;
  setInterval(() => {}, 60_000);
  return true;
};

if (args[0] === "shell" && args[1] === "uiautomator" && hangs("uiautomator")) {
  // Keep the child alive until the driver's execFile timeout terminates it.
} else if (args[0] === "exec-out" && args[1] === "screencap" && hangs("screencap")) {
  // Keep the child alive until the driver's execFile timeout terminates it.
} else if (args[0] === "exec-out" && args[1] === "cat") {
  const focused = process.env.PLAYARR_PARITY_FAKE_ADB_NO_FOCUS !== "1";
  process.stdout.write(`<hierarchy><node text="Library" focused="${focused}" focusable="true" bounds="[200,0][300,100]"/></hierarchy>`);
} else if (args[0] === "exec-out" && args[1] === "screencap") {
  process.stdout.write("");
}
