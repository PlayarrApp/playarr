#!/usr/bin/env node
// Signs the Sailfish emulator in to the static parity server: logs in over HTTP on this host and writes a fresh app config
// (one profile, no leftover app state) over ssh. The password comes from the environment, never from argv or output.
//   PLAYARR_SF_SSH_KEY, optional PLAYARR_SF_SSH_CONFIG, PLAYARR_SF_SSH_PORT (2223), PLAYARR_SF_SSH_HOST (127.0.0.1)
//   PARITY_SERVER_URL, PARITY_ACCOUNT_NAME (or parity.env via parity-config), PLAYARR_PARITY_STATIC_PASSWORD
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadParityConfig } from "../parity-config.mjs";
import { readSecrets } from "../dpad-account.mjs";

loadParityConfig();
const secrets = readSecrets();
const server = process.env.PARITY_SERVER_URL, user = process.env.PARITY_ACCOUNT_NAME, password = secrets.PLAYARR_PARITY_STATIC_PASSWORD;
if (!server || !user || !password) throw new Error("static server url, account and password are required");
const deviceId = randomUUID();
const res = await fetch(`${server}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-playarr-client-platform": "sailfish" },
  body: JSON.stringify({ username: user, password, device_id: deviceId, device_name: "Sailfish emulator", client_platform: "sailfish", client_version: "parity" }),
});
if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
const t = await res.json();
const sub = JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString()).sub;
const conf = `[General]\nactive=${sub}\ntheme=light\n\n[profiles]\n1\\access=${t.access_token}\n1\\avatar=astronaut\n1\\deviceId=${deviceId}\n1\\expiresAt=${Date.now() + t.expires_in * 1000}\n1\\name=Device Test\n1\\pinLocked=false\n1\\refresh=${t.refresh_token}\n1\\server=${server}\n1\\userId=${sub}\nsize=1\n`;
const host = process.env.PLAYARR_SF_SSH_HOST ?? "127.0.0.1", port = process.env.PLAYARR_SF_SSH_PORT ?? "2223";
const sshConfigArgs = process.env.PLAYARR_SF_SSH_CONFIG ? ["-F", process.env.PLAYARR_SF_SSH_CONFIG] : [];
execFileSync("ssh", [...sshConfigArgs, "-i", process.env.PLAYARR_SF_SSH_KEY, "-p", port, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", `defaultuser@${host}`,
  "killall harbour-playarr invoker 2>/dev/null; mkdir -p ~/.config/harbour-playarr && cat > ~/.config/harbour-playarr/harbour-playarr.conf"], { input: conf });
console.log(`signed in as ${user} on ${server}`);
