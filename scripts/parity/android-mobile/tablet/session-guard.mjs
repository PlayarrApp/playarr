#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { assertDeviceTestIdentity, loadTrustedDeviceTestServerUrl } from "../../device-test-guard.mjs";

function readVarint(bytes, state) {
  let value = 0, shift = 0;
  while (state.offset < bytes.length && shift < 70) {
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return value;
    shift += 7;
  }
  throw new Error("invalid DataStore preferences encoding");
}

function fields(bytes) {
  const result = [];
  const state = { offset: 0 };
  while (state.offset < bytes.length) {
    const tag = readVarint(bytes, state), wire = tag & 7, number = tag >> 3;
    if (!number) throw new Error("invalid DataStore preferences encoding");
    if (wire === 2) {
      const size = readVarint(bytes, state), end = state.offset + size;
      if (end > bytes.length) throw new Error("invalid DataStore preferences encoding");
      result.push({ number, wire, value: bytes.subarray(state.offset, end) }); state.offset = end;
    } else if (wire === 0) result.push({ number, wire, value: readVarint(bytes, state) });
    else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (state.offset + size > bytes.length) throw new Error("invalid DataStore preferences encoding");
      result.push({ number, wire, value: bytes.subarray(state.offset, state.offset + size) }); state.offset += size;
    } else throw new Error("unsupported DataStore preferences encoding");
  }
  return result;
}

/** Decode only string preferences from AndroidX PreferencesMap protobuf bytes. */
export function decodeStringPreferences(bytes) {
  const output = new Map();
  for (const field of fields(bytes)) {
    if (field.number !== 1 || field.wire !== 2) continue;
    const entry = fields(field.value);
    const key = entry.find((item) => item.number === 1 && item.wire === 2)?.value.toString("utf8");
    const wrapper = entry.find((item) => item.number === 2 && item.wire === 2)?.value;
    if (!key || !wrapper) continue;
    const value = fields(wrapper).find((item) => item.number === 5 && item.wire === 2)?.value.toString("utf8");
    if (value !== undefined) output.set(key, value);
  }
  return output;
}

export function deviceTestUsernameAllowlist(secrets = {}, env = {}) {
  return new Set(["PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME"]
    .map((key) => secrets[key] ?? env[key]).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()));
}

function canonicalUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("active Android session server is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("active Android session server is invalid");
  return url.toString().replace(/\/$/, "");
}

export function validateActiveSession({ preferences, allowedUsernames, trustedServerUrl, sessionServerUrl = trustedServerUrl, profiles }) {
  const accessToken = preferences.get("playarr_access_token");
  const serverUrl = preferences.get("playarr_base_url");
  const currentServerUrl = preferences.get("playarr_current_server_url");
  const currentUserId = preferences.get("playarr_user_id");
  if (!accessToken || !serverUrl || !currentServerUrl || !currentUserId) throw new Error("active Android session is incomplete");
  if (canonicalUrl(serverUrl) !== canonicalUrl(sessionServerUrl) || canonicalUrl(currentServerUrl) !== canonicalUrl(sessionServerUrl)) throw new Error("active Android session server is not trusted");
  if (!Array.isArray(profiles)) throw new Error("active Android session identity response is invalid");
  const current = profiles.filter((profile) => profile?.is_current === true);
  if (current.length !== 1 || current[0]?.id !== currentUserId || typeof current[0]?.username !== "string") {
    throw new Error("active Android session identity is missing or mismatched");
  }
  assertDeviceTestIdentity({ identity: { username: current[0].username, isCurrentCount: 1, serverUrl: trustedServerUrl }, allowedUsernames, expectedServerUrl: trustedServerUrl });
  return true;
}

export async function assertConnectedAndroidSession({ serial, packageName = "io.playarr.mobile", secrets, serverAlias, adb = "adb", readSession, fetchImpl = fetch } = {}) {
  if (!serial) throw new Error("Android serial is required");
  const read = readSession ?? (() => execFileSync(adb, ["-s", serial, "exec-out", "run-as", packageName, "cat", "files/datastore/playarr_client_prefs.preferences_pb"], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1024 * 1024 }));
  const bytes = read();
  const preferences = decodeStringPreferences(bytes);
  const env = process.env;
  const allowedUsernames = deviceTestUsernameAllowlist(secrets, env);
  if (!allowedUsernames.size) throw new Error("no Android tablet device-test usernames are allowlisted");
  const trustedServerUrl = loadTrustedDeviceTestServerUrl({ secrets, env });
  const sessionServerUrl = serverAlias ? canonicalUrl(serverAlias) : trustedServerUrl;
  const token = preferences.get("playarr_access_token");
  const server = preferences.get("playarr_base_url");
  const currentServer = preferences.get("playarr_current_server_url");
  if (!token || !server || !currentServer || canonicalUrl(server) !== sessionServerUrl || canonicalUrl(currentServer) !== sessionServerUrl) {
    throw new Error("active Android session is missing or uses an untrusted server");
  }
  const response = await fetchImpl(`${trustedServerUrl}/api/v1/users/profiles`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("active Android session identity request failed");
  validateActiveSession({ preferences, allowedUsernames, trustedServerUrl, sessionServerUrl, profiles: await response.json() });
  const after = read();
  if (!after.equals(bytes)) throw new Error("active Android session changed during identity check");
  return true;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const serial = process.argv[2];
    const serverAlias = process.argv[3];
    const adb = process.env.PLAYARR_TABLET_ADB || "adb";
    const secrets = {};
    for (const line of readFileSync(`${homedir()}/.secrets`, "utf8").split("\n")) {
      const index = line.indexOf("=");
      if (index > 0 && !line.startsWith("#")) secrets[line.slice(0, index)] = line.slice(index + 1).replace(/^['"]|['"]$/g, "");
    }
    await assertConnectedAndroidSession({ serial, secrets, serverAlias, adb });
    process.stdout.write("active Android device-test identity verified\n");
  } catch (error) {
    process.stderr.write(`${error?.message || "Android session guard failed"}\n`);
    process.exitCode = 1;
  }
}
