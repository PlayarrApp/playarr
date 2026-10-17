#!/usr/bin/env node
// Resets the shared Device Test account to the web refs' Home state (capture-refs of 2026-10-15 13:48): On deck holds only
// "The 5th Wave" (part-watched). Every other progress row is zeroed (state unseen), every series' recorded
// resume choices are deleted, so no stacked resume plan adds a card. Test leftovers only; reads ~/.secrets, prints no secrets.
//   node reset-deck-canonical.mjs [--dry]
import fs from "node:fs";
import { resolveTestServerUrl } from "../../test-server-env.mjs";
const dry = process.argv.includes("--dry");
const sec = {}; for (const l of fs.readFileSync(process.env.HOME + "/.secrets", "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) sec[l.slice(0, i)] = l.slice(i + 1).replace(/^["']|["']$/g, ""); }
const SRV = resolveTestServerUrl(process.env);
const FILM_FILE = "a2c2cf1c-2059-4289-88fb-c7882a3ed7b7";   // The 5th Wave
const login = await fetch(SRV + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-deck", username: sec.PLAYARR_DEVICE_TEST_USERNAME, password: sec.PLAYARR_DEVICE_TEST_PASSWORD }) });
if (!login.ok) throw new Error("login " + login.status);
const h = { "content-type": "application/json", authorization: "Bearer " + (await login.json()).access_token };
const get = async (p) => (await fetch(SRV + p, { headers: h })).json();
const put = (file, pos, dur, done) => fetch(SRV + `/api/v1/playback/${file}/progress`, { method: "PUT", headers: h, body: JSON.stringify({ position_ms: pos, duration_ms: dur, completed: done }) });
const all = await get("/api/v1/playback/progress");
let cleared = 0;
for (const p of all) {
  if (p.state === "unseen" || p.media_file_id === FILM_FILE) continue;
  if (!dry) await put(p.media_file_id, 0, p.duration_ms || 6454000, false);
  cleared += 1;
}
const film = all.find((p) => p.media_file_id === FILM_FILE);
if (!dry) await put(FILM_FILE, film?.position_ms > 0 ? film.position_ms : 15098, film?.duration_ms || 6742000, false);
const series = new Set(all.map((p) => p.work_id));
if (!dry) for (const id of series) await fetch(SRV + `/api/v1/catalog/${id}/resume-plan/choices`, { method: "DELETE", headers: h }).catch(() => {});
const after = await get("/api/v1/playback/progress");
console.log(`${dry ? "would clear" : "cleared"} ${cleared} rows; part_watched now ${after.filter((p) => p.state === "part_watched").length}`);
