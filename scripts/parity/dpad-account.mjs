#!/usr/bin/env node
// Dedicated D-pad account: D-pad runs sign in as `device-test-dpad`, so plays by other runs never change its On deck.
//   node scripts/parity/dpad-account.mjs create   admin API: create the user like Device Test (profile name, libraries, rights),
//                                                 add PLAYARR_DEVICE_TEST_DPAD_USERNAME/_PASSWORD to ~/.secrets (backed up first, 0600)
//   node scripts/parity/dpad-account.mjs seed     put the pinned title's progress back (The 5th Wave at 15098 ms: the one On deck card)
//   node scripts/parity/dpad-account.mjs env      print the key names a driver wrapper must map (no values)
// Drivers: set PARITY_ACCOUNT=dpad and map PLAYARR_DEVICE_TEST_DPAD_* to PLAYARR_USERNAME/PLAYARR_PASSWORD (see parityCredentials).
// Env: PLAYARR_SERVER_URL (or PLAYARR_DEVICE_TEST_SERVER_URL in ~/.secrets). Needs PLAYARR_AGENT_ADMIN_USERNAME/_PASSWORD to create. Prints no secrets.
import fs from "node:fs";
import { homedir } from "node:os";

const FILE = `${homedir()}/.secrets`;
export function readSecrets(file = FILE) {
  const out = {};
  for (const l of fs.readFileSync(file, "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) out[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); }
  return out;
}
/** Credentials a parity driver signs in with: the dedicated D-pad account when PARITY_ACCOUNT=dpad, else Device Test. */
export function parityCredentials(env = process.env, sec = readSecrets()) {
  const sfx = env.PARITY_ACCOUNT === "dpad" ? "_DPAD" : "";
  return { username: sec[`PLAYARR_DEVICE_TEST${sfx}_USERNAME`], password: sec[`PLAYARR_DEVICE_TEST${sfx}_PASSWORD`] };
}
const PINNED = { file: "a2c2cf1c-2059-4289-88fb-c7882a3ed7b7", position_ms: 15098, duration_ms: 6742000 };

async function login(srv, username, password, name) {
  const r = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: name, username, password }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return { authorization: `Bearer ${(await r.json()).access_token}`, "content-type": "application/json" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sec = readSecrets(), cmd = process.argv[2];
  const srv = (process.env.PLAYARR_SERVER_URL ?? sec.PLAYARR_DEVICE_TEST_SERVER_URL ?? "").replace(/\/$/, "");
  if (!srv) throw new Error("PLAYARR_SERVER_URL (or PLAYARR_DEVICE_TEST_SERVER_URL in ~/.secrets) is required");
  if (cmd === "env") console.log("PLAYARR_DEVICE_TEST_DPAD_USERNAME PLAYARR_DEVICE_TEST_DPAD_PASSWORD");
  else if (cmd === "create") {
    if (sec.PLAYARR_DEVICE_TEST_DPAD_USERNAME) throw new Error("the D-pad account is already in ~/.secrets");
    const h = await login(srv, sec.PLAYARR_AGENT_ADMIN_USERNAME, sec.PLAYARR_AGENT_ADMIN_PASSWORD, "parity-admin");
    const users = await (await fetch(`${srv}/api/v1/admin/users`, { headers: h })).json();
    const dt = users.find((u) => u.username === sec.PLAYARR_DEVICE_TEST_USERNAME);
    if (!dt) throw new Error("Device Test user not found");
    const pw = `${crypto.randomUUID().replace(/-/g, "")}Aa1!`, bak = `${FILE}.bak.${Math.floor(Date.now() / 1000)}`;
    fs.copyFileSync(FILE, bak); fs.chmodSync(bak, 0o600);
    let t = fs.readFileSync(FILE, "utf8"); if (!t.endsWith("\n")) t += "\n";
    fs.writeFileSync(FILE, `${t}PLAYARR_DEVICE_TEST_DPAD_USERNAME=device-test-dpad\nPLAYARR_DEVICE_TEST_DPAD_PASSWORD=${pw}\n`, { mode: 0o600 }); fs.chmodSync(FILE, 0o600);
    const r = await fetch(`${srv}/api/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ username: "device-test-dpad", display_name: dt.display_name, password: pw, is_admin: false, can_stream: dt.can_stream, library_allow: dt.library_allow, can_download: dt.can_download, can_request: dt.can_request }) });
    console.log("create", r.status);
  } else if (cmd === "seed") {
    const c = parityCredentials({ PARITY_ACCOUNT: "dpad" }, sec);
    const h = await login(srv, c.username, c.password, "parity-seed");
    const r = await fetch(`${srv}/api/v1/playback/${PINNED.file}/progress`, { method: "PUT", headers: h, body: JSON.stringify({ position_ms: PINNED.position_ms, duration_ms: PINNED.duration_ms, completed: false }) });
    console.log("seed", r.status);
  } else throw new Error("usage: dpad-account.mjs create|seed|env");
}
