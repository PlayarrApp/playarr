// Shared helpers for the parity suite (suite.json): validation, key expansion, route matching.
import { createHash } from "node:crypto";

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

// Sets the isolated profile's watch progress of each media file back to 0, so On deck and Resume stay the same on every
// device. Login tokens stay in memory. env: PLAYARR_SERVER_URL, PLAYARR_USERNAME, PLAYARR_PASSWORD.
export async function resetProgress(files, env = process.env) {
  const srv = env.PLAYARR_SERVER_URL?.replace(/\/$/, "");
  if (!srv || !env.PLAYARR_USERNAME) throw new Error("--reset-progress needs PLAYARR_SERVER_URL, PLAYARR_USERNAME and PLAYARR_PASSWORD");
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-reset", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
  if (!lr.ok) throw new Error(`reset-progress login ${lr.status}`);
  const session = await lr.json();
  if (!session.access_token) throw new Error("reset-progress login returned no access token");
  const h = { "content-type": "application/json", authorization: `Bearer ${session.access_token}` };
  for (const f of new Set(files)) {
    const meta = await (await fetch(`${srv}/api/v1/media/${f}/metadata`, { headers: h })).json().catch(() => ({}));
    const r = await fetch(`${srv}/api/v1/playback/${f}/progress`, { method: "PUT", headers: h, body: JSON.stringify({ position_ms: 0, duration_ms: meta.duration_ms ?? 0, completed: false }) });
    if (!r.ok) throw new Error(`reset-progress ${f}: ${r.status}`);
  }
}

// Files behind the pinned film and series screens (the film's file and every episode of the pinned series), so a reset covers
// what On deck and the detail screens show, as capture-refs.mjs does for the web references.
export async function pinnedCatalogFiles(suite, env = process.env, { required = false } = {}) {
  const srv = env.PLAYARR_SERVER_URL?.replace(/\/$/, "");
  if (!srv || !env.PLAYARR_USERNAME || !env.PLAYARR_PASSWORD) {
    if (required) throw new Error("stable catalog lookup requires resolved isolated account credentials");
    return [];
  }
  const lr = await fetch(`${srv}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "parity-reset", username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
  if (!lr.ok) {
    if (required) throw new Error(`stable catalog lookup login failed with status ${lr.status}`);
    return [];
  }
  const session = await lr.json();
  if (!session.access_token) {
    if (required) throw new Error("stable catalog lookup login returned no access token");
    return [];
  }
  const h = { authorization: `Bearer ${session.access_token}` };
  const idOf = (id) => suite.screens.find((s) => s.id === id)?.open?.split("/").pop();
  const get = async (id) => {
    if (!id) return {};
    const response = await fetch(`${srv}/api/v1/catalog/${id}`, { headers: h });
    if (!response.ok) {
      if (required) throw new Error(`stable catalog lookup failed with status ${response.status}`);
      return {};
    }
    try { return await response.json(); }
    catch (error) {
      if (required) throw new Error(`stable catalog lookup returned invalid JSON: ${error.message}`);
      return {};
    }
  };
  const film = await get(idOf("film-detail")), series = await get(idOf("series-detail"));
  const episodeFiles = (series.children?.Series ?? []).flatMap((s) => s.episodes ?? []).map((episode) => episode.media_file_id).filter(Boolean);
  if (required && (!film.media_file_id || episodeFiles.length === 0)) {
    throw new Error("stable catalog lookup did not return the pinned film and an episode file");
  }
  return [film.media_file_id, ...episodeFiles].filter(Boolean);
}

/** Verify that Home has only the configured canonical deck row in progress, without changing account state. */
export async function assertCanonicalHomeProgress(env = process.env, fetchImpl = fetch) {
  const server = env.PLAYARR_SERVER_URL?.replace(/\/$/, "");
  const username = env.PLAYARR_USERNAME?.trim();
  const password = env.PLAYARR_PASSWORD;
  const canonicalFile = env.PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID?.trim();
  const approved = [env.PLAYARR_DEVICE_TEST_USERNAME, env.PLAYARR_DEVICE_TEST_DPAD_USERNAME]
    .filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
  if (!server || !username || !password || !approved.includes(username)) {
    throw new Error("Home fixture preflight requires credentials matching a configured Device Test username");
  }
  if (typeof canonicalFile !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canonicalFile)) {
    throw new Error("Home fixture preflight requires PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID");
  }
  const fail = (part, status) => { throw new Error(`Home fixture preflight ${part} failed${status ? ` (${status})` : ""}`); };
  const request = async (url, options, part) => {
    try {
      const response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(5000) });
      return response;
    } catch {
      fail(`${part} request`);
    }
  };
  const json = async (response, part) => {
    if (!response.ok) fail(part, response.status);
    try { return await response.json(); } catch { fail(`${part} returned invalid JSON`); }
  };
  const login = await json(await request(`${server}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: crypto.randomUUID(), device_name: "home-fixture-preflight", username, password }),
  }, "login"), "login");
  if (typeof login?.access_token !== "string" || !login.access_token) fail("login response schema");
  const headers = { authorization: `Bearer ${login.access_token}` };
  const profiles = await json(await request(`${server}/api/v1/users/profiles`, { headers }, "identity lookup"), "identity lookup");
  if (!Array.isArray(profiles)) fail("identity response schema");
  const current = profiles.filter((profile) => profile?.is_current === true);
  if (current.length !== 1 || current[0]?.username !== username) fail("authenticated identity mismatch");

  const progress = await json(await request(`${server}/api/v1/playback/progress`, { headers }, "progress lookup"), "progress lookup");
  if (!Array.isArray(progress) || progress.some((row) => !row || typeof row.media_file_id !== "string" ||
      typeof row.state !== "string" || typeof row.position_ms !== "number" || !Number.isFinite(row.position_ms) || row.position_ms < 0 ||
      typeof row.duration_ms !== "number" || !Number.isFinite(row.duration_ms) || row.duration_ms < 0) ||
      new Set(progress.map((row) => row.media_file_id)).size !== progress.length) fail("progress response schema");
  const partWatched = progress.filter((row) => row.state === "part_watched");
  if (partWatched.length !== 1 || partWatched[0].media_file_id !== canonicalFile) {
    throw new Error(`Home fixture preflight expected 1 canonical part_watched row, found ${partWatched.length}; capture refused`);
  }
  const row = partWatched[0];
  const signature = createHash("sha256").update(JSON.stringify([canonicalFile, row.state, row.position_ms, row.duration_ms])).digest("hex");
  return { expectedPartWatched: 1, actualPartWatched: 1, signature };
}
