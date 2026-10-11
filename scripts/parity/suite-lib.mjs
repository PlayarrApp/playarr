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
    if (!d.keys?.length) bad.push(`${d.id}: empty keys`);
  }
  if (JSON.stringify((s.playback ?? []).map((x) => x.id)) !== '["a","b","c"]') bad.push("playback cases must be a, b, c");
  for (const p of s.playback ?? []) if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.file ?? "")) bad.push(`${p.id}: file must be a media file id`);
  return bad;
}
