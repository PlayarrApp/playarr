// Shared helpers for the parity suite (suite.json): validation, key expansion, route matching.
const KEY = /^(up|down|left|right|select|back)(:long)?(\*[1-9]\d*)?$/;

export function expandKeys(keys) {
  return keys.flatMap((k) => {
    const m = KEY.exec(k);
    if (!m) throw new Error(`bad key ${JSON.stringify(k)}`);
    const [name] = k.replace(/\*\d+$/, "").split(":");
    const long = k.includes(":long");
    return Array.from({ length: Number(m[3]?.slice(1) ?? 1) }, () => ({ key: name, long }));
  });
}

export function routeMatches(pattern, url) {
  const [pp, pq] = pattern.split("?");
  const u = new URL(url, "http://x");
  if (!new RegExp(`^${pp.replace(/:id/g, "[^/]+")}$`).test(u.pathname)) return false;
  return !pq || [...new URLSearchParams(pq)].every(([k, v]) => u.searchParams.get(k) === v);
}

// D-pad labels share semantic roles across platforms. The action-list Play entry and play/pause
// control represent different checks: one names the action, while the toggle preserves exact state.
export function focusForCheck(f, checkId) {
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const raw = norm(f && typeof f === "object" ? f.label : f);
  const label = checkId === "long-press-actions" && ["▶play", "play-pause", "play"].includes(raw) ? "play"
    : checkId === "player-ok-toggle" ? raw : /^(play|pause)$/.test(raw) ? "play-pause" : raw;
  return { label, position: f && typeof f === "object" ? f.position ?? null : null };
}

// Returns a list of problems (empty when valid).
export function validateSuite(s, legendScreens) {
  const bad = [];
  const dup = (xs) => xs.filter((x, i) => xs.indexOf(x) !== i);
  const ids = (s.screens ?? []).map((x) => x.id);
  if (ids.length !== 15) bad.push(`expected 15 screens, got ${ids.length}`);
  if (dup(ids).length) bad.push(`duplicate screen ids ${dup(ids)}`);
  if (legendScreens && JSON.stringify(legendScreens) !== JSON.stringify(ids)) bad.push("screen ids differ from the legend list");
  if (JSON.stringify(s.themes) !== '["dark","light"]') bad.push("themes must be dark, light");
  for (const x of s.screens ?? []) {
    if (!x.route?.startsWith("/")) bad.push(`${x.id}: route`);
    if (x.open && !routeMatches(x.route, x.open)) bad.push(`${x.id}: open must match route`);
    if (x.keys !== null && !Array.isArray(x.keys)) bad.push(`${x.id}: keys must be an array or null`);
    try { if (x.keys) expandKeys(x.keys); } catch (e) { bad.push(`${x.id}: ${e.message}`); }
  }
  const dids = (s.dpad ?? []).map((x) => x.id);
  if (!dids.length) bad.push("no dpad checks");
  if (dup(dids).length) bad.push(`duplicate dpad ids ${dup(dids)}`);
  for (const d of s.dpad ?? []) {
    const from = (s.screens ?? []).find((x) => x.id === d.from);
    if (!from) bad.push(`${d.id}: unknown from ${d.from}`);
    else if (!from.keys) bad.push(`${d.id}: start screen ${d.from} has no keys`);
    try { expandKeys(d.keys); } catch (e) { bad.push(`${d.id}: ${e.message}`); }
    if (!Array.isArray(d.keys)) bad.push(`${d.id}: keys must be an array (empty = no key, read the initial focus)`);
  }
  if (JSON.stringify((s.performance ?? []).map((x) => x.id)) !== '["a","b","c"]') bad.push("performance cases must be a, b, c");
  for (const p of s.performance ?? []) if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.file ?? "")) bad.push(`${p.id}: file must be a media file id`);
  const dl = s.downloads ?? [];
  const dlids = dl.map((x) => x.id);
  if (!dl.length) bad.push("no downloads cases");
  if (dup(dlids).length) bad.push(`duplicate downloads ids ${dup(dlids)}`);
  for (const d of dl) if (!s.downloadMedia?.[d.media]) bad.push(`${d.id}: unknown media ${d.media}`);
  for (const m of Object.values(s.downloadMedia ?? {})) for (const k of ["work", "file"]) if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(m[k] ?? "")) bad.push(`downloadMedia ${k} must be an id`);
  return bad;
}

// Sets the Device Test profile's watch progress of each media file back to 0, so On deck and Resume stay the same on every
// device. Logs in with its own device id (nothing is stored). env: PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD.
export async function resetProgress(files, env = process.env) {
  const srv = env.PLAYARR_SERVER_URL?.replace(/\/$/, "");
  if (!srv || !env.PLAYARR_USERNAME) throw new Error("--reset-progress needs PLAYARR_SERVER_URL, PLAYARR_USERNAME and PLAYARR_PASSWORD");
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-reset", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
  if (!lr.ok) throw new Error(`reset-progress login ${lr.status}`);
  const h = { "content-type": "application/json", authorization: `Bearer ${(await lr.json()).access_token}` };
  for (const f of new Set(files)) {
    const meta = await (await fetch(`${srv}/api/v1/media/${f}/metadata`, { headers: h })).json().catch(() => ({}));
    const r = await fetch(`${srv}/api/v1/playback/${f}/progress`, { method: "PUT", headers: h, body: JSON.stringify({ position_ms: 0, duration_ms: meta.duration_ms ?? 0, completed: false }) });
    if (!r.ok) throw new Error(`reset-progress ${f}: ${r.status}`);
  }
}
