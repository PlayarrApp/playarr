// Prints, base64 encoded, the JavaScript the web view shell runs before the page boots: the server, the theme and a fresh signed-in
// session in the page's storage (the keys capture-web.mjs seeds). Env: PERF_SERVER, PERF_USER, PERF_PASSWORD.
const base = process.env.PERF_SERVER.replace(/\/$/, "");
const api = async (path, token, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};
const username = process.env.PERF_USER;
const device_id = "00000000-0000-4000-8000-0000000000a1";
const s = await api("/api/v1/auth/login", null, { method: "POST", body: JSON.stringify({ username, password: process.env.PERF_PASSWORD, device_id, device_name: "perf-ab", client_platform: "android-tv", client_version: "perf" }) });
let name = username;
try { name = (await api("/api/v1/users/profiles", s.access_token)).find((p) => p.id === s.user_id)?.display_name?.trim() || username; } catch {}
const js = `try{localStorage.setItem("playarr-theme","dark");localStorage.setItem("playarr:apiBaseUrl",${JSON.stringify(base)});` +
  `localStorage.setItem("playarr.profileSessions.v4",${JSON.stringify(JSON.stringify([{ profileKey: "perf", apiBaseUrl: base, userId: s.user_id, name, deviceId: device_id, session: { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 } }]))});` +
  `localStorage.setItem("playarr.currentUserName",${JSON.stringify(name)});localStorage.setItem("playarr.activeProfile.v1",${JSON.stringify(JSON.stringify({ profileKey: "perf", apiBaseUrl: base, userId: s.user_id }))});}catch(e){}`;
// PERF_EXTRA_JS_FILE: diagnostic JavaScript appended to the seed (for example to inject a style experiment). Not used by the A/B proper.
const extra = process.env.PERF_EXTRA_JS_FILE ? (await import("node:fs")).readFileSync(process.env.PERF_EXTRA_JS_FILE, "utf8") : "";
process.stdout.write(Buffer.from(js + extra).toString("base64"));
