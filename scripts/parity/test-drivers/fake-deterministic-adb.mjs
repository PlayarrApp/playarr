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
    if (state.captureGeneration) {
      const sequence = (env.PLAYARR_PARITY_FAKE_CAPTURE_SEQUENCE ?? "ready").split(",");
      const index = state.captureReadCount ?? 0;
      state.captureObservation = sequence[Math.min(index, sequence.length - 1)];
      state.captureReadCount = index + 1;
      mutated = true;
      const pending = state.captureObservation === "pending" ? 1 : 0;
      const marker = `I PlayarrParity: capture_state generation=${state.captureGeneration} screen=${state.captureScreen} data=ready data_count=1 layout=ready surface=${env.PLAYARR_PARITY_FAKE_CAPTURE_SURFACE ?? "content"} art_seen=1 art_pending=${pending} art_failed=0`;
      stdout = [...state.logs, marker].join("\n");
    } else stdout = state.logs.join("\n");
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
    stdout = `TouchModePerDisplay:\n  Display: 0 TouchMode: ${state.touchMode === 1 ? 1 : 0}`;
  } else if (group === "shell" && args[0] === "input" && args[1] === "keyevent") {
    state.keys ??= [];
    state.keys.push(args.at(-1));
    if (state.appForeground) state.touchMode = 0;
    mutated = true;
  } else if (group === "shell" && args[0] === "wm" && args[1] === "size") {
    stdout = "Physical size: 1920x1080\nOverride size: 1280x720";
  } else if (group === "shell" && args[0] === "pm" && args[1] === "path") {
    stdout = `package:${env.PLAYARR_PARITY_FAKE_APK_PATH ?? "/data/app/io.playarr.mobile/base.apk"}`;
  } else if (group === "shell" && args[0] === "sha256sum") {
    stdout = `${"a".repeat(64)}  ${args[1]}`;
  } else if (group === "shell" && args[0] === "am" && args[1] === "start") {
    state.appForeground = true;
    state.launches.push(args);
    mutated = true;
    const clockIndex = args.indexOf("parity_clock");
    if (clockIndex >= 0) state.logs.push(`I PlayarrParity: clock_consumed=${env.PLAYARR_PARITY_FAKE_CLOCK_LOG ?? args[clockIndex + 1]}`);
    const routeIndex = args.indexOf("parity_route");
    if (routeIndex >= 0) state.logs.push(`I PlayarrParity: route=${args[routeIndex + 1]} section=`);
    const generationIndex = args.indexOf("parity_capture_generation");
    const screenIndex = args.indexOf("parity_capture_screen");
    if (generationIndex >= 0 && screenIndex >= 0) {
      state.captureGeneration = args[generationIndex + 1];
      state.captureScreen = args[screenIndex + 1];
      state.captureReadCount = 0;
    }
  } else if (group === "shell" && args[0] === "uiautomator") {
    // The driver reads the accessibility tree from the following exec-out cat call.
  } else if (group === "exec-out" && args[0] === "cat") {
    const x = env.PLAYARR_PARITY_FAKE_DRAWER_FOCUS === "1" ? 900 : env.PLAYARR_PARITY_FAKE_ADB_NAV_FOCUS === "1" ? 20 : 200;
    const label = state.captureObservation === "focus" ? "Changed" : "Library";
    stdout = `<hierarchy><node text="${label}" focused="true" focusable="true" bounds="[${x},0][${x + 100},100]"/></hierarchy>`;
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
