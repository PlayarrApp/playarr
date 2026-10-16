import { clientSecretKeys, readSecrets } from "./dpad-account.mjs";
import { resolveTestServerUrl } from "./test-server-env.mjs";

const safeUsernameKeys = ["PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME"];

/** Resolve explicit test-account configuration. PLAYARR_USERNAME is accepted only if independently allowlisted. */
export function loadAllowedDeviceTestUsernames({ secrets, env = process.env, client } = {}) {
  if (!secrets) secrets = optionalSecrets(env);
  const usernames = new Set();
  for (const key of safeUsernameKeys) {
    const username = secrets[key] ?? env[key];
    if (typeof username === "string" && username.trim()) usernames.add(username.trim());
  }
  if (client) {
    const key = clientSecretKeys(client).username;
    const username = secrets[key] ?? env[key];
    if (typeof username === "string" && username.trim()) usernames.add(username.trim());
  }
  // Preserve explicitly configured isolated parity accounts only for the selected client key.
  // An arbitrary key that merely resembles a parity username key is not an allowlist.
  const parityKey = client ? `PLAYARR_PARITY_${String(client).replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_USERNAME` : null;
  if (parityKey && !/^PLAYARR_PARITY_[A-Z0-9]+(?:_[A-Z0-9]+)*_USERNAME$/.test(parityKey)) {
    throw new Error("invalid parity client key for device-test account policy");
  }
  if (parityKey) {
    const username = secrets[parityKey] ?? env[parityKey];
    if (typeof username === "string" && username.trim()) usernames.add(username.trim());
  }
  const callerUsername = env.PLAYARR_USERNAME;
  if (typeof callerUsername === "string" && callerUsername.trim() && !usernames.has(callerUsername.trim())) {
    throw new Error("configured login account is not in the device-test allowlist");
  }
  return usernames;
}

function canonicalServerUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("trusted device-test server is not configured");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("trusted device-test server configuration is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("trusted device-test server configuration is invalid");
  }
  return url.toString().replace(/\/$/, "");
}

export function loadTrustedDeviceTestServerUrl({ env = process.env } = {}) {
  const trusted = canonicalServerUrl(resolveTestServerUrl(env));
  if (env.PLAYARR_SERVER_URL && canonicalServerUrl(env.PLAYARR_SERVER_URL) !== trusted) {
    throw new Error("configured server does not match the trusted device-test server");
  }
  return trusted;
}

function optionalSecrets(env) {
  try { return readSecrets(); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return env;
  }
}

/** Throw before any driver operation unless exactly one authenticated current profile is allowlisted. */
export function assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl } = {}) {
  if (!identity || identity.isCurrentCount !== 1 || typeof identity.username !== "string" || !identity.username ||
      !(allowedUsernames instanceof Set) || !allowedUsernames.has(identity.username) ||
      canonicalServerUrl(identity.serverUrl) !== expectedServerUrl) {
    throw new Error("device-test account guard rejected the current session");
  }
  return true;
}

export function assertAllowedDeviceTestUsername(username, allowedUsernames) {
  if (typeof username !== "string" || !username || !(allowedUsernames instanceof Set) || !allowedUsernames.has(username)) {
    throw new Error("device-test account guard rejected the configured login username");
  }
  return true;
}

export function trustedLoginUsername(env = process.env, allowedUsernames, expectedServerUrl) {
  const username = env.PLAYARR_USERNAME;
  assertAllowedDeviceTestUsername(username, allowedUsernames);
  if (env.PLAYARR_TEST_SERVER_URL && canonicalServerUrl(resolveTestServerUrl(env)) !== expectedServerUrl) throw new Error("login server does not match the trusted device-test server");
  return username;
}

/** Browser-evaluable helper: resolve identity only from the authenticated server profiles endpoint. */
export async function fetchCurrentIdentity({ expectedServerUrl } = {}) {
  const canonical = (value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error("invalid server");
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("invalid server");
    return url.toString().replace(/\/$/, "");
  };
  let sessionText, session, token, base;
  try {
    sessionText = localStorage.getItem("playarr:session");
    session = JSON.parse(sessionText || "null");
    token = session?.accessToken;
    base = localStorage.getItem("playarr:apiBaseUrl");
  } catch { throw new Error("device-test account identity unavailable"); }
  if (typeof token !== "string" || !token || typeof base !== "string" || !base) throw new Error("device-test account identity unavailable");
  let serverUrl;
  try { serverUrl = canonical(base); }
  catch { throw new Error("device-test account identity server is invalid"); }
  if (expectedServerUrl && serverUrl !== canonical(expectedServerUrl)) throw new Error("device-test account identity server is not trusted");
  let response, profiles;
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 5000);
    response = await fetch(`${base.replace(/\/$/, "")}/api/v1/users/profiles`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new Error();
    profiles = await response.json();
  } catch { throw new Error("device-test account identity request failed"); }
  finally { clearTimeout(timeout); }
  try {
    if (localStorage.getItem("playarr:session") !== sessionText || localStorage.getItem("playarr:apiBaseUrl") !== base) {
      throw new Error("device-test account session changed during identity check");
    }
  } catch (error) {
    if (error?.message === "device-test account session changed during identity check") throw error;
    throw new Error("device-test account identity unavailable");
  }
  if (!Array.isArray(profiles)) throw new Error("device-test account identity response invalid");
  const current = profiles.filter((profile) => profile?.is_current === true);
  if (current.length !== 1 || typeof current[0]?.username !== "string" || !current[0].username) {
    throw new Error("device-test account identity is missing or ambiguous");
  }
  return { username: current[0].username, isCurrentCount: current.length, serverUrl };
}

export async function assertDeviceTestPage({ page, allowedUsernames, expectedServerUrl }) {
  const identity = await page.evaluate(fetchCurrentIdentity, { expectedServerUrl });
  return assertDeviceTestIdentity({ identity, allowedUsernames, expectedServerUrl });
}
