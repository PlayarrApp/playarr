#!/usr/bin/env node
// Manage dedicated per-client parity accounts. Never use the shared Device Test account for deterministic capture.
//   node dpad-account.mjs create <client>   clone Device Test permissions to an isolated account
//   node dpad-account.mjs env <client>      print the environment variable names a driver maps
// Credentials are kept in ~/.secrets. Values are never printed.
import fs from "node:fs";
import crypto from "node:crypto";
import { homedir } from "node:os";

const FILE = `${homedir()}/.secrets`;
const clientSlug = (value) => {
  const slug = String(value ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new Error("client must be a lowercase slug (letters, digits, hyphens)");
  return slug;
};

export function readSecrets(file = FILE, relevantKeys) {
  const out = {};
  const wanted = relevantKeys ? new Set(relevantKeys) : null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    const key = i > 0 && !line.startsWith("#") ? line.slice(0, i) : null;
    if (key && (!wanted || wanted.has(key))) out[key] = line.slice(i + 1).replace(/^['"]|['"]$/g, "");
  }
  return out;
}

export function clientSecretKeys(client) {
  const key = clientSlug(client).toUpperCase().replace(/-/g, "_");
  return { username: `PLAYARR_PARITY_${key}_USERNAME`, password: `PLAYARR_PARITY_${key}_PASSWORD` };
}

/** Replace secret keys in place, backing up the latest file only when values change. */
export function storeSecrets(values, file = FILE) {
  const lock = `${file}.lock`;
  let lockFd;
  const deadline = Date.now() + 30_000;
  while (lockFd === undefined) {
    try { lockFd = fs.openSync(lock, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const before = fs.statSync(lock);
        const ownerText = fs.readFileSync(lock, "utf8").trim();
        const after = fs.statSync(lock);
        if (before.dev !== after.dev || before.ino !== after.ino || !/^[1-9]\d*$/.test(ownerText)) {
          if (Date.now() >= deadline) throw new Error("timed out waiting for ~/.secrets write lock; inspect the lock before removing it");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
          continue;
        }
        const owner = Number(ownerText);
        if (Number.isSafeInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (probeError) {
            if (probeError.code === "ESRCH") {
              const current = fs.statSync(lock);
              if (current.dev === after.dev && current.ino === after.ino && fs.readFileSync(lock, "utf8").trim() === ownerText) {
                fs.unlinkSync(lock);
              }
              continue;
            }
            if (probeError.code !== "EPERM") throw probeError;
          }
        }
      } catch (readError) {
        if (readError.code !== "ENOENT") throw readError;
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for ~/.secrets write lock; inspect the lock before removing it");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    fs.writeSync(lockFd, String(process.pid));
    const previous = fs.readFileSync(file, "utf8");
    const lines = previous.split("\n");
    const seen = new Set();
    const updates = new Map(Object.entries(values));
    const nextLines = [];
    for (const line of lines) {
      const i = line.indexOf("=");
      const key = i > 0 && !line.startsWith("#") ? line.slice(0, i) : null;
      if (!key || !updates.has(key)) {
        nextLines.push(line);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const value = updates.get(key);
      const existingValue = line.slice(i + 1).replace(/^['"]|['"]$/g, "");
      if (value != null && existingValue === String(value)) {
        nextLines.push(line);
        continue;
      }
      if (value != null) nextLines.push(`${key}=${value}`);
    }
    const hasTrailingNewline = previous.endsWith("\n");
    const appendAt = hasTrailingNewline ? Math.max(0, nextLines.length - 1) : nextLines.length;
    const additions = [...updates].filter(([key, value]) => !seen.has(key) && value != null).map(([key, value]) => `${key}=${value}`);
    nextLines.splice(appendAt, 0, ...additions);
    const body = nextLines.join("\n");
    if (body === previous) return;

    let backup = `${file}.bak.${Date.now()}`;
    while (fs.existsSync(backup)) backup = `${file}.bak.${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o600);

    const temporary = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temporary, body, { mode: 0o600 });
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    fs.chmodSync(file, 0o600);
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

/** Credentials for a named client account. Explicit client selection never falls back to a shared user. */
export function parityCredentials(env = process.env, sec = readSecrets()) {
  if (env.PARITY_CLIENT) {
    const keys = clientSecretKeys(env.PARITY_CLIENT);
    const username = sec[keys.username] ?? env[keys.username];
    const password = sec[keys.password] ?? env[keys.password];
    if (!username || !password) throw new Error(`missing client account credentials (${keys.username}, ${keys.password})`);
    return { username, password };
  }
  const suffix = env.PARITY_ACCOUNT === "dpad" ? "_DPAD" : "";
  return { username: sec[`PLAYARR_DEVICE_TEST${suffix}_USERNAME`], password: sec[`PLAYARR_DEVICE_TEST${suffix}_PASSWORD`] };
}

function accountKeys(client) {
  return client === "dpad"
    ? { username: "PLAYARR_DEVICE_TEST_DPAD_USERNAME", password: "PLAYARR_DEVICE_TEST_DPAD_PASSWORD" }
    : clientSecretKeys(client);
}

export async function login(srv, username, password, name) {
  const response = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: name, username, password }) });
  if (!response.ok) throw new Error(`login ${response.status}`);
  const auth = await response.json();
  if (!auth.access_token) throw new Error("login returned no access token");
  return { authorization: `Bearer ${auth.access_token}`, "content-type": "application/json" };
}

async function clonePreferences(srv, clientName, sec) {
  const targetKeys = accountKeys(clientName);
  const targetUsername = sec[targetKeys.username], targetPassword = sec[targetKeys.password];
  if (!targetUsername || !targetPassword) throw new Error(`missing isolated account credentials (${targetKeys.username}, ${targetKeys.password})`);
  const source = await login(srv, sec.PLAYARR_DEVICE_TEST_USERNAME, sec.PLAYARR_DEVICE_TEST_PASSWORD, "parity-pref-source");
  const target = await login(srv, targetUsername, targetPassword, `parity-${clientName}`);
  const read = async (headers, path) => {
    const response = await fetch(`${srv}${path}`, { headers });
    if (!response.ok) throw new Error(`read preferences ${response.status}`);
    return response.json();
  };
  const write = async (headers, path, method, value) => {
    const response = await fetch(`${srv}${path}`, { method, headers, body: JSON.stringify(value) });
    if (!response.ok) throw new Error(`write preferences ${response.status}`);
  };
  const [railPreferences, playerPreferences] = await Promise.all([
    read(source, "/api/v1/home/rails/preferences"),
    read(source, "/api/v1/users/me/player-preferences"),
  ]);
  const rails = railPreferences.rails ?? [];
  await Promise.all([
    write(target, "/api/v1/home/rails/preferences", "PUT", { order: rails.map((rail) => rail.id), hidden: rails.filter((rail) => rail.hidden).map((rail) => rail.id) }),
    write(target, "/api/v1/users/me/player-preferences", "PATCH", playerPreferences),
  ]);
  console.log(`copied profile preferences from Device Test to isolated account ${clientName}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sec = readSecrets(), cmd = process.argv[2], clientArg = process.argv[3];
  const legacy = !clientArg && ["create", "seed", "env"].includes(cmd);
  const client = legacy ? "dpad" : clientSlug(clientArg);
  const keys = accountKeys(client);
  const srv = (process.env.PLAYARR_SERVER_URL ?? sec.PLAYARR_DEVICE_TEST_SERVER_URL ?? "").replace(/\/$/, "");
  if (!srv && cmd !== "env") throw new Error("PLAYARR_SERVER_URL (or PLAYARR_DEVICE_TEST_SERVER_URL in ~/.secrets) is required");
  if (cmd === "env") console.log(`${keys.username} ${keys.password}`);
  else if (cmd === "clone-prefs") {
    await clonePreferences(srv, client, sec);
  } else if (cmd === "create") {
    if (sec[keys.username] || sec[keys.password]) throw new Error(`credentials for client ${client} already exist in ~/.secrets`);
    if (!sec.PLAYARR_DEVICE_TEST_USERNAME || !sec.PLAYARR_DEVICE_TEST_PASSWORD || !sec.PLAYARR_AGENT_ADMIN_USERNAME || !sec.PLAYARR_AGENT_ADMIN_PASSWORD) throw new Error("Device Test and parity admin credentials are required in ~/.secrets");
    const admin = await login(srv, sec.PLAYARR_AGENT_ADMIN_USERNAME, sec.PLAYARR_AGENT_ADMIN_PASSWORD, "parity-admin");
    const response = await fetch(`${srv}/api/v1/admin/users`, { headers: admin });
    if (!response.ok) throw new Error(`list users ${response.status}`);
    const users = await response.json();
    const template = users.find((user) => user.username === sec.PLAYARR_DEVICE_TEST_USERNAME);
    if (!template) throw new Error("Device Test user not found");
    const username = client === "dpad" ? "device-test-dpad" : `parity-${client}`;
    if (users.some((user) => user.username === username)) throw new Error(`server account ${username} already exists without local credentials; refusing to adopt it`);
    const password = `${crypto.randomUUID().replace(/-/g, "")}Aa1!`;
    storeSecrets({ [keys.username]: username, [keys.password]: password });
    let created;
    try {
      created = await fetch(`${srv}/api/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ username, display_name: template.display_name, password, is_admin: false, can_stream: template.can_stream, library_allow: template.library_allow, can_download: template.can_download, can_request: template.can_request }) });
      if (!created.ok) throw new Error(`create account ${created.status}`);
    } catch (error) {
      throw new Error(`account creation returned an error; credentials remain safely stored under ${keys.username} and ${keys.password}; inspect server state before retrying (${error.message})`);
    }
    await login(srv, username, password, `parity-${client}`);
    console.log(`created isolated account for ${client}; credentials saved under ${keys.username} and ${keys.password}`);
  } else if (cmd === "seed") {
    const file = process.env.PARITY_DECK_MEDIA_FILE_ID;
    if (!file || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(file)) throw new Error("PARITY_DECK_MEDIA_FILE_ID is required for a local seed");
    const credentials = parityCredentials(legacy ? { PARITY_ACCOUNT: "dpad" } : { PARITY_CLIENT: client }, sec);
    const loginResult = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: `parity-${client}`, username: credentials.username, password: credentials.password }) });
    if (!loginResult.ok) throw new Error(`login ${loginResult.status}`);
    const auth = await loginResult.json();
    const response = await fetch(`${srv}/api/v1/playback/${file}/progress`, { method: "PUT", headers: { authorization: `Bearer ${auth.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ position_ms: Number(process.env.PARITY_DECK_POSITION_MS ?? 15098), duration_ms: Number(process.env.PARITY_DECK_DURATION_MS ?? 6742000), completed: false }) });
    if (!response.ok) throw new Error(`seed progress ${response.status}`);
    console.log(`seeded canonical progress for ${client}`);
  } else throw new Error("usage: dpad-account.mjs create|clone-prefs|seed|env [client]");
}
