#!/usr/bin/env node
// Seed one playlist on the throw-away static-server DB so playlists and playlist-detail show items (design-report addendum 3 Nov).
// Same fixture as capture-design.mjs on web: "Parity Watch Night" with the pinned film, series and one extra work. Skipped when a playlist exists.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withCaptureState } from "../capture-state.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const screens = JSON.parse(readFileSync(join(here, "screens.json"), "utf8")).screens;
const open = (id) => screens.find((s) => s.id === id).open;
await withCaptureState({ client: "roku", files: [] }, async (state) => {
  const env = state.env;
  const srv = env.PLAYARR_SERVER_URL.replace(/\/$/, "");
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-design", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
  if (!lr.ok) throw new Error(`login ${lr.status}`);
  const auth = { authorization: `Bearer ${(await lr.json()).access_token}` };
  const existing = await (await fetch(`${srv}/api/v1/playlists`, { headers: auth })).json();
  if ((Array.isArray(existing) ? existing : existing.items ?? existing.playlists ?? []).length) { console.log("playlist exists"); return; }
  const created = await fetch(`${srv}/api/v1/playlists`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Parity Watch Night", media_type: "video" }) });
  if (!created.ok) throw new Error(`create playlist ${created.status}`);
  const playlist = await created.json();
  for (const workId of [open("film-detail"), open("series-detail")].map((r) => r.split("/").pop()).concat(["4ec39b80-28c3-4d83-9f83-f07872e5f4c0"])) {
    const added = await fetch(`${srv}/api/v1/playlists/${playlist.id}/items`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ work_id: workId }) });
    if (!added.ok) throw new Error(`add playlist item ${added.status}`);
  }
  console.log("playlist seeded");
});
