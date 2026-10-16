#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function runFakeDeterministicAdb(args = process.argv.slice(2), env = process.env) {
  const [group, ...commandArgs] = args;
  const stateFile = env.PLAYARR_PARITY_FAKE_ADB_STATE;
  const readState = () => {
    try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return { window_animation_scale: "1.0", transition_animation_scale: "1.0", animator_duration_scale: "1.0", launches: [], logs: [] }; }
  };
  const saveState = (state) => writeFileSync(stateFile, JSON.stringify(state));
  let stdout = "";

  if (group === "logcat" && commandArgs[0] === "-c") {
    const state = readState(); state.logs = []; saveState(state);
  } else if (group === "logcat" && commandArgs[0] === "-d") {
    stdout = readState().logs.join("\n");
  } else if (group === "shell" && commandArgs[0] === "settings" && commandArgs[1] === "get") {
    stdout = readState()[commandArgs[3]] ?? "null";
  } else if (group === "shell" && commandArgs[0] === "settings" && commandArgs[1] === "put") {
    const state = readState();
    if (env.PLAYARR_PARITY_FAKE_ADB_FAIL_PUT !== commandArgs[3]) state[commandArgs[3]] = commandArgs[4];
    saveState(state);
  } else if (group === "shell" && commandArgs[0] === "dumpsys" && commandArgs[1] === "input") {
    stdout = "TouchMode: 0";
  } else if (group === "shell" && commandArgs[0] === "pm" && commandArgs[1] === "path") {
    stdout = `package:${env.PLAYARR_PARITY_FAKE_APK_PATH ?? "/data/app/io.playarr.mobile/base.apk"}`;
  } else if (group === "shell" && commandArgs[0] === "sha256sum") {
    stdout = `${"a".repeat(64)}  ${commandArgs[1]}`;
  } else if (group === "shell" && commandArgs[0] === "am" && commandArgs[1] === "start") {
    const state = readState();
    state.launches.push(commandArgs);
    const clockIndex = commandArgs.indexOf("parity_clock");
    if (clockIndex >= 0) state.logs.push(`I PlayarrParity: clock_consumed=${env.PLAYARR_PARITY_FAKE_CLOCK_LOG ?? commandArgs[clockIndex + 1]}`);
    const routeIndex = commandArgs.indexOf("parity_route");
    if (routeIndex >= 0) {
      const route = commandArgs[routeIndex + 1];
      state.logs.push(`I PlayarrParity: route=${route} section=`);
    }
    saveState(state);
  } else if (group === "exec-out" && commandArgs[0] === "cat") {
    const nav = env.PLAYARR_PARITY_FAKE_ADB_NAV_FOCUS === "1";
    const x = nav ? 20 : 200;
    stdout = `<hierarchy><node text="Library" focused="true" focusable="true" bounds="[${x},0][${x + 100},100]"/></hierarchy>`;
  }

  return stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(runFakeDeterministicAdb());
}
