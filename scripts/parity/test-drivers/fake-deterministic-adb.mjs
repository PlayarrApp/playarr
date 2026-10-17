#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const initialFakeAdbState = () => ({
  window_animation_scale: "1.0",
  transition_animation_scale: "1.0",
  animator_duration_scale: "1.0",
  timezone: "Asia/Bangkok",
  locales: "",
  launches: [],
  logs: [],
});

export function handleFakeDeterministicAdbCommand(state, group, args, env = {}) {
  let stdout = "";
  let mutated = false;
  if (group === "logcat" && args[0] === "-c") {
    state.logs = [];
    mutated = true;
  } else if (group === "logcat" && args[0] === "-d") {
    stdout = state.logs.join("\n");
  } else if (group === "shell" && args[0] === "settings" && args[1] === "get") {
    stdout = state[args[3]] ?? "null";
  } else if (group === "shell" && args[0] === "settings" && args[1] === "put") {
    if (env.PLAYARR_PARITY_FAKE_ADB_FAIL_PUT !== args[3]) state[args[3]] = args[4];
    mutated = true;
  } else if (group === "shell" && args[0] === "getprop" && args[1] === "persist.sys.timezone") {
    stdout = state.timezone;
  } else if (group === "shell" && args[0] === "cmd" && args[1] === "alarm" && args[2] === "set-timezone") {
    state.timezone = args[3];
    mutated = true;
  } else if (group === "shell" && args[0] === "cmd" && args[1] === "locale" && args[2] === "get-app-locales") {
    stdout = `Locales for ${args[3]} for user 0 are [${state.locales}]`;
  } else if (group === "shell" && args[0] === "cmd" && args[1] === "locale" && args[2] === "set-app-locales") {
    state.locales = args[5];
    mutated = true;
  } else if (group === "shell" && args[0] === "dumpsys" && args[1] === "input") {
    stdout = "TouchMode: 0";
  } else if (group === "shell" && args[0] === "pm" && args[1] === "path") {
    stdout = `package:${env.PLAYARR_PARITY_FAKE_APK_PATH ?? "/data/app/io.playarr.mobile/base.apk"}`;
  } else if (group === "shell" && args[0] === "sha256sum") {
    stdout = `${"a".repeat(64)}  ${args[1]}`;
  } else if (group === "shell" && args[0] === "am" && args[1] === "start") {
    state.launches.push(args);
    mutated = true;
    const clockIndex = args.indexOf("parity_clock");
    if (clockIndex >= 0) state.logs.push(`I PlayarrParity: clock_consumed=${env.PLAYARR_PARITY_FAKE_CLOCK_LOG ?? args[clockIndex + 1]}`);
    const routeIndex = args.indexOf("parity_route");
    if (routeIndex >= 0) state.logs.push(`I PlayarrParity: route=${args[routeIndex + 1]} section=`);
  } else if (group === "exec-out" && args[0] === "cat") {
    const x = env.PLAYARR_PARITY_FAKE_ADB_NAV_FOCUS === "1" ? 20 : 200;
    stdout = `<hierarchy><node text="Library" focused="true" focusable="true" bounds="[${x},0][${x + 100},100]"/></hierarchy>`;
  }
  return { stdout, stderr: "", mutated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [group, ...args] = process.argv.slice(2);
  const stateFile = process.env.PLAYARR_PARITY_FAKE_ADB_STATE;
  let state;
  try { state = JSON.parse(readFileSync(stateFile, "utf8")); } catch { state = initialFakeAdbState(); }
  const { stdout, mutated } = handleFakeDeterministicAdbCommand(state, group, args, process.env);
  if (mutated) writeFileSync(stateFile, JSON.stringify(state));
  process.stdout.write(stdout);
}
