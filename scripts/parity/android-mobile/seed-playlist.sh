#!/usr/bin/env bash
# Seed the design fixture playlist on the static parity server (throw-away DB copy): seed-playlist.sh. Skips when a playlist exists.
set -euo pipefail
eval "$(node "$(dirname "$0")/../parity-config.mjs" --shell)"
export PW=$(grep -E '^(export )?PLAYARR_PARITY_STATIC_PASSWORD=' ~/.secrets | head -1 | sed -E 's/^(export )?[^=]*=//; s/^["'"'"']//; s/["'"'"']$//')
node --input-type=module -e '
const srv = process.env.PARITY_SERVER_URL.replace(/\/$/, "");
const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: process.env.PARITY_ACCOUNT_NAME, password: process.env.PW }) });
if (!lr.ok) throw new Error(`login ${lr.status}`);
const auth = { authorization: `Bearer ${(await lr.json()).access_token}` };
const ex = await (await fetch(`${srv}/api/v1/playlists`, { headers: auth })).json();
if ((Array.isArray(ex) ? ex : ex.items ?? ex.playlists ?? []).length) { console.log("playlist exists"); process.exit(0); }
const c = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
if (!c.ok) throw new Error(`create ${c.status}`);
const p = await c.json();
for (const w of ["ca309574-c0f4-4564-bb54-4512eab7e531", "7ab4ce97-d59e-43d6-8e03-31d4d29a5c90", "4ec39b80-28c3-4d83-9f83-f07872e5f4c0"]) {
  const a = await fetch(`${srv}/api/v1/playlists/${p.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: w }) });
  if (!a.ok) throw new Error(`add ${a.status}`);
}
console.log("seeded");
'
