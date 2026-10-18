// Frozen content of the static parity server: pure data, no clock, no randomness, no network.
// Placeholder names only; never put a real title in this file. build-db.mjs turns it into the seeded SQLite DB.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const screens = JSON.parse(readFileSync(new URL("../screens.json", import.meta.url), "utf8"));
/** The one instant every parity capture pins (single copy: screens.json determinism.clock). */
export const CLOCK = screens.determinism.clock;
const clockMs = Date.parse(CLOCK);
const iso = (offsetMs) => new Date(clockMs + offsetMs).toISOString();
const HOUR = 3600e3, DAY = 86400e3;

/** Deterministic UUID from a key. */
export const uid = (key) => {
  const h = createHash("sha1").update(`playarr-parity-static:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// Ids that scripts/parity/suite.json pins (detail pages, perf and download files). The static server owns them so
// capture-refs.mjs and the suite run unchanged against it.
export const PINNED = {
  "movie:0": { work: "ca309574-c0f4-4564-bb54-4512eab7e531" },
  "series:0": { work: "7ab4ce97-d59e-43d6-8e03-31d4d29a5c90" },
  "movie:1": { work: "4ec39b80-28c3-4d83-9f83-f07872e5f4c0", file: "f057244e-e512-4eda-a0e1-2c0a847357ef" },
  "movie:2": { file: "feabc8ba-712f-4816-b7b0-a0bb58aa1e94" },
  "movie:3": { file: "b9a68b2c-8382-4c34-a6f0-c4dd58f55093" },
  "series:1": { work: "3289a2c5-592e-4ed0-943a-17d9033457ef", episodeFile: { season: 2, episode: 3, id: "44adbf21-bce8-4fd8-904a-fbd61e5ca7ad" } },
};

const ADJ = ["Amber", "Silent", "Crimson", "Hollow", "Golden", "Northern", "Velvet", "Paper", "Electric", "Distant", "Salt", "Quiet", "Scarlet", "Marble", "Midnight"];
const NOUN = ["Harbour", "Orchard", "Lantern", "Meridian", "Compass", "Garden", "Signal", "Archive", "Voyage", "Horizon", "Station", "Thicket", "Cathedral", "Ledger", "Tide"];
const GENRES = ["Drama", "Adventure", "Comedy", "Thriller", "Animation", "Family", "Documentary", "Mystery"];
const RATINGS = ["G", "PG", "PG-13", "R", "PG", "PG-13"];
const TV_RATINGS = ["TV-Y7", "TV-PG", "TV-14", "TV-MA", "TV-G"];
const name = (i, salt) => `${ADJ[(i * 7 + salt) % ADJ.length]} ${NOUN[(i * 4 + salt * 3 + Math.floor(i / 15)) % NOUN.length]}`;

export const MOVIE_COUNT = 30, SERIES_COUNT = 20;

// Newest first: item n of the interleaved order was added n*7+3 hours before the clock, so Recently Added is fixed.
const addedAt = (n) => iso(-(n * 7 + 3) * HOUR);

export const MOVIES = Array.from({ length: MOVIE_COUNT }, (_, i) => ({
  key: `movie:${i}`,
  workId: PINNED[`movie:${i}`]?.work ?? uid(`movie:${i}`),
  fileId: PINNED[`movie:${i}`]?.file ?? uid(`movie:${i}:file`),
  title: `${name(i, 1)} ${i + 1}`,
  year: 1998 + ((i * 5) % 28),
  tmdbId: 810000 + i,
  certification: RATINGS[i % RATINGS.length],
  genres: [GENRES[i % GENRES.length], GENRES[(i + 3) % GENRES.length]],
  addedAt: addedAt(i * 2),
  overview: `Placeholder film number ${i + 1}, written for the parity reference library.`,
}));

export const SERIES = Array.from({ length: SERIES_COUNT }, (_, i) => {
  const seasons = 1 + (i % 3);
  const pin = PINNED[`series:${i}`];
  const workId = pin?.work ?? uid(`series:${i}`);
  return {
    key: `series:${i}`,
    workId,
    title: `${name(i, 4)} ${i + 1}`,
    year: 2004 + ((i * 3) % 22),
    tvdbId: 910000 + i,
    certification: TV_RATINGS[i % TV_RATINGS.length],
    genres: [GENRES[(i + 1) % GENRES.length]],
    addedAt: addedAt(i * 2 + 1),
    overview: `Placeholder series number ${i + 1}, written for the parity reference library.`,
    seasons: Array.from({ length: Math.max(seasons, pin?.episodeFile?.season ?? 0) }, (_, s) => ({
      number: s + 1,
      episodes: Array.from({ length: 3 + ((i + s) % 2) }, (_, e) => ({
        number: e + 1,
        id: uid(`series:${i}:s${s + 1}e${e + 1}`),
        fileId: pin?.episodeFile && pin.episodeFile.season === s + 1 && pin.episodeFile.episode === e + 1 ? pin.episodeFile.id : uid(`series:${i}:s${s + 1}e${e + 1}:file`),
        title: `Episode ${e + 1}`,
        airDate: iso(-((i * 11 + s * 40 + e * 7 + 20) * DAY)).slice(0, 10),
      })),
    })),
  };
});

export const ARTISTS = Array.from({ length: 6 }, (_, i) => ({
  workId: uid(`artist:${i}`),
  title: `${name(i + 3, 9)} Ensemble`,
  addedAt: addedAt(60 + i),
  albums: Array.from({ length: 2 }, (_, a) => ({
    id: uid(`artist:${i}:album:${a}`),
    title: `${name(i * 2 + a, 6)} Sessions`,
    releaseDate: iso(-((i * 90 + a * 400 + 30) * DAY)).slice(0, 10),
    tracks: Array.from({ length: 5 }, (_, t) => ({ id: uid(`artist:${i}:album:${a}:t${t}`), title: `Track ${t + 1}`, seconds: 150 + t * 17 })),
  })),
}));

/** Profiles of the parity account's household. The first is the account the captures sign in as. */
export const PROFILES = [
  { key: "main", suffix: "", display: "Parity", avatar: "astronaut" },
  { key: "kids", suffix: "-kids", display: "Parity Kids", avatar: "robot" },
  { key: "guest", suffix: "-guest", display: "Parity Guest", avatar: "cat" },
];

// The main profile's On deck: exactly the canonical deck item (position in ms of the 60 s clip). Every capture flow
// (capture-refs.mjs, the device drivers) resets progress to that one item, so seeding more would make the first
// capture of a run differ from the rest. WATCHED titles never show on deck.
export const ON_DECK = [{ movie: 4, positionMs: 15000, hoursAgo: 2 }];
export const WATCHED = [{ movie: 6 }, { movie: 7 }, { movie: 8 }];
export const WATCHLIST = [
  { kind: "movie", index: 9 }, { kind: "series", index: 8 }, { kind: "movie", index: 12 },
  { kind: "series", index: 11 }, { kind: "movie", index: 15 }, { kind: "series", index: 14 },
];

// Calendar entries, in days relative to the clock (2026-10-07): a mix around it, kept in cached monthly chunks.
export const CALENDAR = [
  { series: 2, offset: -9 }, { series: 3, offset: -2 }, { series: 4, offset: 0 }, { series: 6, offset: 1 },
  { series: 7, offset: 3 }, { series: 9, offset: 6 }, { series: 10, offset: 9 }, { series: 12, offset: 14 },
  { movie: 16, offset: -5 }, { movie: 17, offset: 2 }, { movie: 18, offset: 5 }, { movie: 19, offset: 11 }, { movie: 20, offset: 20 },
].map((e) => ({ ...e, date: iso(e.offset * DAY).slice(0, 10), releaseAt: `${iso(e.offset * DAY).slice(0, 10)}T01:00:00Z` }));

export const FROZEN_AT = iso(-HOUR); // created_at/updated_at of every seeded row
