// seed-deck.mjs <deck_media_file_id> <zero_media_file_id>...: the canonical On deck for a capture (the web refs' deck item at
// 15098 ms of 6742000), every other listed file at 0, so Home matches the reference whatever an earlier run played.
const SRV = process.env.SERVER_URL, [deck, ...zero] = process.argv.slice(2);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (![deck, ...zero].every((id) => ID.test(id ?? ""))) throw new Error("seed-deck: every argument must be a media file ID");
const lr = await fetch(SRV + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-capture", username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD }) });
if (!lr.ok) throw new Error("login " + lr.status);
const tok = (await lr.json()).access_token;
const put = async (id, position_ms, duration_ms) => {
  const r = await fetch(SRV + "/api/v1/playback/" + id + "/progress", { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify({ position_ms, duration_ms, completed: false }) });
  if (!r.ok) throw new Error("seed " + r.status);
};
for (const id of zero) await put(id, 0, 6454000);
await put(deck, 15098, 6742000);
console.log("deck seeded");
