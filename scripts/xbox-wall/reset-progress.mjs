// reset-progress.mjs <media_file_id>: set the device test account's watch progress to 0 (both clients then start at 0).
const SRV = process.env.SERVER_URL, mf = process.argv[2];
const lr = await fetch(SRV + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-capture", username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD }) });
if (!lr.ok) throw new Error("login " + lr.status);
const tok = (await lr.json()).access_token;
const r = await fetch(SRV + "/api/v1/playback/" + mf + "/progress", { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify({ position_ms: 0, duration_ms: 6454000, completed: false }) });
if (!r.ok) throw new Error("reset " + r.status + " " + (await r.text()).slice(0, 200)); console.log("progress reset");
