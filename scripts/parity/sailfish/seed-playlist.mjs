#!/usr/bin/env node
// Seeds the playlist fixture the frozen seed lacks (design report addendum 3 Nov): "Parity Watch Night" with the pinned film, the pinned
// series and one more title. Skipped when a playlist exists. env: PARITY_* via parity-config, PLAYARR_PARITY_STATIC_PASSWORD via dpad-account.
import { loadParityConfig } from "../parity-config.mjs";
import { readSecrets } from "../dpad-account.mjs";

loadParityConfig();
const srv = process.env.PARITY_SERVER_URL.replace(/\/$/, ""), user = process.env.PARITY_ACCOUNT_NAME, password = readSecrets().PLAYARR_PARITY_STATIC_PASSWORD;
const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: user, password }) });
if (!lr.ok) throw new Error(`login ${lr.status}`);
const auth = { authorization: `Bearer ${(await lr.json()).access_token}` };
const existing = await (await fetch(`${srv}/api/v1/playlists`, { headers: auth })).json();
if ((Array.isArray(existing) ? existing : existing.items ?? existing.playlists ?? []).length) { console.log("playlist exists"); process.exit(0); }
const created = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
if (!created.ok) throw new Error(`create playlist ${created.status}`);
const playlist = await created.json();
for (const workId of ["ca309574-c0f4-4564-bb54-4512eab7e531", "7ab4ce97-d59e-43d6-8e03-31d4d29a5c90", "4ec39b80-28c3-4d83-9f83-f07872e5f4c0"]) {
  const added = await fetch(`${srv}/api/v1/playlists/${playlist.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: workId }) });
  if (!added.ok) throw new Error(`add playlist item ${added.status}`);
}
console.log("playlist seeded");
