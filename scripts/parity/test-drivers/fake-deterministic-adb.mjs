#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const [group, ...args] = process.argv.slice(2);
const stateFile = process.env.PLAYARR_PARITY_FAKE_ADB_STATE;
const readState = () => {
  try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return { window_animation_scale: "1.0", transition_animation_scale: "1.0", animator_duration_scale: "1.0", launches: [], logs: [] }; }
};
const saveState = (state) => writeFileSync(stateFile, JSON.stringify(state));

if (group === "logcat" && args[0] === "-c") {
  const state = readState(); state.logs = []; saveState(state);
} else if (group === "logcat" && args[0] === "-d") {
  process.stdout.write(readState().logs.join("\n"));
} else if (group === "shell" && args[0] === "settings" && args[1] === "get") {
  process.stdout.write(readState()[args[3]] ?? "null");
} else if (group === "shell" && args[0] === "settings" && args[1] === "put") {
  const state = readState();
  if (process.env.PLAYARR_PARITY_FAKE_ADB_FAIL_PUT !== args[3]) state[args[3]] = args[4];
  saveState(state);
} else if (group === "shell" && args[0] === "dumpsys" && args[1] === "input") {
  process.stdout.write("TouchMode: 0");
} else if (group === "shell" && args[0] === "pm" && args[1] === "path") {
  process.stdout.write(`package:${process.env.PLAYARR_PARITY_FAKE_APK_PATH ?? "/data/app/io.playarr.mobile/base.apk"}`);
} else if (group === "shell" && args[0] === "sha256sum") {
  process.stdout.write(`${"a".repeat(64)}  ${args[1]}`);
} else if (group === "shell" && args[0] === "am" && args[1] === "start") {
  const state = readState();
  state.launches.push(args);
  const clockIndex = args.indexOf("parity_clock");
  if (clockIndex >= 0) state.logs.push(`I PlayarrParity: clock_consumed=${process.env.PLAYARR_PARITY_FAKE_CLOCK_LOG ?? args[clockIndex + 1]}`);
  const routeIndex = args.indexOf("parity_route");
  if (routeIndex >= 0) {
    const route = args[routeIndex + 1];
    state.logs.push(`I PlayarrParity: route=${route} section=`);
  }
  saveState(state);
} else if (group === "shell" && args[0] === "uiautomator") {
  // The driver reads the accessibility tree from the following exec-out cat call.
} else if (group === "exec-out" && args[0] === "cat") {
  const nav = process.env.PLAYARR_PARITY_FAKE_ADB_NAV_FOCUS === "1";
  const x = nav ? 20 : 200;
  process.stdout.write(`<hierarchy><node text="Library" focused="true" focusable="true" bounds="[${x},0][${x + 100},100]"/></hierarchy>`);
}
