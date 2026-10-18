#!/usr/bin/env node
// Loads parity.env into process.env (variables already set win) and derives the rest from the frozen catalogue and screens.json:
// PARITY_CLOCK / PARITY_FIXED_NOW (screens.json determinism.clock), the canonical On deck item, the web app served by the static server.
// PARITY_LIVE=1, or no PLAYARR_PARITY_STATIC_PASSWORD (env or ~/.secrets), applies none of it to process.env (captures against a live server). Scripts call loadParityConfig() first; sh uses:
//   eval "$(node scripts/parity/parity-config.mjs --shell)"      (prints exports; the password is never part of it)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { CLOCK, MOVIES, ON_DECK } from "./static/catalogue.mjs";

const FILE = fileURLToPath(new URL("./parity.env", import.meta.url));

export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** This host's LAN address (the source address of the default route), or undefined when there is none. */
export function lanAddress() {
  try { return /\bsrc (\d+\.\d+\.\d+\.\d+)/.exec(execFileSync("ip", ["-4", "route", "get", "1.1.1.1"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))?.[1]; } catch { return undefined; }
}

/** Static mode is for machines set up for it: the parity password is in the environment or ~/.secrets (so CI and other checkouts are untouched). */
function staticPasswordPresent(env) {
  if (env.PLAYARR_PARITY_STATIC_PASSWORD) return true;
  try { return /^PLAYARR_PARITY_STATIC_PASSWORD=./m.test(readFileSync(`${homedir()}/.secrets`, "utf8")); } catch { return false; }
}

export function deriveConfig(file, deck = MOVIES[ON_DECK[0].movie]) {
  const cfg = { ...file };
  cfg.PARITY_SERVER_HOST ||= lanAddress();
  if (cfg.PARITY_SERVER_HOST) cfg.PARITY_SERVER_URL ||= `http://${cfg.PARITY_SERVER_HOST}:${cfg.PARITY_SERVER_PORT}`;
  cfg.PARITY_CLOCK = CLOCK;
  cfg.PARITY_FIXED_NOW = CLOCK;
  cfg.PARITY_DECK_MEDIA_FILE_ID = deck.fileId;
  cfg.PARITY_DECK_POSITION_MS = String(ON_DECK[0].positionMs);
  cfg.PARITY_DECK_DURATION_MS = "60000";
  if (cfg.PARITY_SERVER_URL) Object.assign(cfg, { PLAYARR_SERVER_URL: cfg.PARITY_SERVER_URL, PLAYARR_WEB_URL: `${cfg.PARITY_SERVER_URL}/tv` });
  return cfg;
}

export function loadParityConfig(env = process.env) {
  const file = parseEnvFile(readFileSync(FILE, "utf8"));
  // Any key of parity.env can be overridden from the environment (a second instance needs its own server, artwork and build ports).
  for (const k of ["PARITY_SERVER_HOST", ...Object.keys(file)]) if (env[k]) file[k] = env[k];
  const cfg = deriveConfig(file);
  if (env.PARITY_LIVE !== "1" && staticPasswordPresent(env)) for (const [k, v] of Object.entries(cfg)) env[k] ??= v;
  return Object.fromEntries(Object.keys(cfg).map((k) => [k, env[k] ?? cfg[k]]));
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--shell")
  for (const [k, v] of Object.entries(loadParityConfig({ ...process.env }))) console.log(`export ${k}='${v}'`);
