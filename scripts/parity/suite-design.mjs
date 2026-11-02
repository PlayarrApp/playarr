// Design-report screen list reader (see design-screens.json). Additive to suite.json: the D-pad suite is untouched.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The ids SCREENS-ALL.md names (owner, 3 Nov 2026): the 15 original, 27 new, and the state screens. */
export const DESIGN_IDS = [
  "home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "player-controls", "actions",
  "login", "login-qr", "signup", "link", "household", "downloads", "sites", "music-detail", "episode-detail", "search-results", "watchlist", "requests", "playlists", "playlist-detail", "folders", "player",
  "settings-appearance", "settings-profile-avatar", "settings-language", "settings-player", "settings-server", "settings-profile-lock", "settings-invite", "settings-request-latency", "settings-remote", "settings-your-data", "settings-home", "not-found",
  "home--focus-second-rail", "search--keyboard", "profiles--add",
];

export function loadDesignScreens(file = join(here, "design-screens.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Problems with a design screen list: ids missing or extra against DESIGN_IDS, unknown kinds, duplicate ids, a pinned open with no suite entry. */
export function validateDesignScreens(spec, suite = JSON.parse(readFileSync(join(here, "suite.json"), "utf8"))) {
  const problems = [];
  const ids = spec.screens.map((s) => s.id);
  for (const id of DESIGN_IDS) if (!ids.includes(id)) problems.push(`missing screen ${id}`);
  for (const id of ids) if (!DESIGN_IDS.includes(id)) problems.push(`unknown screen ${id}`);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) problems.push(`duplicate screen ${id}`);
  for (const s of spec.screens) {
    if (!["shell", "outside", "signedOut", "player"].includes(s.kind)) problems.push(`${s.id}: unknown kind ${s.kind}`);
    if (s.open === "suite" && !suite.screens.find((x) => x.id === s.id)?.open) problems.push(`${s.id}: no open route in suite.json`);
    if (!s.route?.startsWith("/")) problems.push(`${s.id}: route must start with /`);
  }
  for (const [alias, target] of Object.entries(spec.aliases ?? {})) if (!ids.includes(target)) problems.push(`alias ${alias} points at unknown ${target}`);
  return problems;
}
