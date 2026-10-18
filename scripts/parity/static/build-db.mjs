#!/usr/bin/env node
// Builds the pristine DB of the static parity server from scratch (never a copy of any live DB):
//   1. run the backend once on an empty SQLite file, so it applies the migrations and the account hash is made;
//   2. insert the frozen content of catalogue.mjs with fixed ids and dates;
//   3. generate the artwork and the one playable clip, deterministically, from the repo only.
// Usage: build-db.mjs --server-bin <playarr-server> --home <dir>     Needs PLAYARR_PARITY_STATIC_PASSWORD in ~/.secrets (or the env).
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSecrets } from "../dpad-account.mjs";
import { loadParityConfig } from "../parity-config.mjs";
import { ARTISTS, CALENDAR, CLOCK, FROZEN_AT, MOVIES, ON_DECK, PROFILES, SERIES, WATCHED, WATCHLIST, uid } from "./catalogue.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const home = arg("home"), serverBin = arg("server-bin");
if (!home || !serverBin) throw new Error("usage: build-db.mjs --server-bin <playarr-server> --home <dir>");
const cfg = loadParityConfig();
const password = process.env.PLAYARR_PARITY_STATIC_PASSWORD ?? readSecrets()["PLAYARR_PARITY_STATIC_PASSWORD"];
if (!password) throw new Error("PLAYARR_PARITY_STATIC_PASSWORD is missing from ~/.secrets");
// Image URLs stored in the DB. Clients that fetch images[].url directly (the Apple apps) need one they can reach: the hosted
// instance sets PARITY_ART_BASE to the public tunnel path (https://<host>/art); the default is the loopback artwork server.
const artBase = process.env.PARITY_ART_BASE ?? `http://127.0.0.1:${cfg.PARITY_ART_PORT}/art`;
const artDir = join(home, "art"), mediaDir = join(home, "media"), clip = join(mediaDir, "clip.mkv");
const CLIP_SECONDS = 60, FONT = join(here, "../../fixtures/fonts/NunitoSans-Bold-art.ttf");
mkdirSync(artDir, { recursive: true }); mkdirSync(mediaDir, { recursive: true });

const ffmpeg = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-threads", "2", ...args], { stdio: "inherit", timeout: 120000 }); if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`); };

// --- artwork: gradient + title text in a fixed colour pair per title, byte-stable (the gradient source is seeded).
const PALETTE = [["0x8a3a5e", "0x14102b"], ["0x2f6f8f", "0x0d1b2e"], ["0x8a6a2a", "0x24160b"], ["0x4a8a5a", "0x0c2218"], ["0x6a4aa0", "0x170f33"]];
const stamp = createHash("sha1").update(readFileSync(join(here, "catalogue.mjs"))).update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(FONT)).digest("hex");
const stampFile = join(artDir, ".stamp");
const fresh = existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp;
function art(file, w, h, [c0, c1], title, seed) {
  const out = join(artDir, file);
  if (fresh && existsSync(out)) return;
  const fs = Math.round(w / 14), text = title.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const vf = [
    `drawbox=x=${Math.round(w * 0.12 + ((seed * 17) % (w * 0.3)))}:y=${Math.round(h * 0.1)}:w=${Math.round(h * 0.55)}:h=${Math.round(h * 0.55)}:color=white@0.07:t=fill`,
    `drawbox=x=0:y=${Math.round(h * 0.7)}:w=${w}:h=${Math.round(h * 0.3)}:color=black@0.45:t=fill`,
    `drawtext=fontfile='${FONT}':text='${text}':fontcolor=white:fontsize=${fs}:x=(w-text_w)/2:y=${Math.round(h * 0.76)}`,
  ].join(",");
  ffmpeg(["-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:d=1:n=2:seed=${seed + 1}`, "-frames:v", "1", "-vf", vf, out]);
}
[...MOVIES, ...SERIES, ...ARTISTS].forEach((t, i) => {
  const colours = PALETTE[i % PALETTE.length];
  art(`${t.workId}-poster.png`, 600, 900, colours, t.title, i);
  art(`${t.workId}-backdrop.png`, 1280, 720, colours, t.title, i);
});
writeFileSync(stampFile, stamp);

// --- the one playable clip every movie and episode points at (h264, English and French audio, English subtitles).
if (!existsSync(clip)) {
  const srt = join(mediaDir, "clip.en.srt");
  writeFileSync(srt, [1, 2, 3].map((n) => `${n}\n00:00:0${(n - 1) * 2},000 --> 00:00:0${(n - 1) * 2 + 1},500\n[English] placeholder cue ${n}\n`).join("\n"));
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=320x180:rate=15:duration=${CLIP_SECONDS}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${CLIP_SECONDS}`, "-f", "lavfi", "-i", `sine=frequency=523:duration=${CLIP_SECONDS}`, "-i", srt,
    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-t", String(CLIP_SECONDS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-b:a", "48k", "-c:s", "srt",
    "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=fra", "-metadata:s:s:0", "language=eng", "-disposition:a:0", "default", clip]);
  rmSync(srt);
}
const clipSize = statSync(clip).size;

// --- migrations: boot the backend once on an empty DB with a throwaway bootstrap admin, then stop it.
const dbFile = join(home, "pristine.db");
for (const f of ["", "-wal", "-shm"]) rmSync(dbFile + f, { force: true });
const boot = spawn(serverBin, [], {
  stdio: ["ignore", "ignore", "inherit"],
  env: { PATH: process.env.PATH, DATABASE_URL: `sqlite://${dbFile}?mode=rwc`, PLAYARR_HTTP_BIND_ADDR: `127.0.0.1:${cfg.PARITY_BUILD_PORT}`, PLAYARR_METRICS_BIND_ADDR: `127.0.0.1:${Number(cfg.PARITY_BUILD_PORT) + 1}`,
    PLAYARR_JWT_SECRET: "parity-static-build-only-secret-0123456789abcdef", PLAYARR_AUTH_MODE: "full-account", PLAYARR_STATIC: "1",
    PLAYARR_BOOTSTRAP_ADMIN_USERNAME: "parity-bootstrap", PLAYARR_BOOTSTRAP_ADMIN_PASSWORD: password, PLAYARR_ARTWORK_CACHE_DIR: join(home, "build-artwork") },
});
let up = false;
for (let i = 0; i < 240 && !up && boot.exitCode === null; i++) {
  up = await fetch(`http://127.0.0.1:${cfg.PARITY_BUILD_PORT}/healthz`).then((r) => r.ok, () => false);
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
boot.kill("SIGTERM");
await new Promise((r) => (boot.exitCode !== null ? r() : boot.once("exit", r)));
if (!up) throw new Error("backend did not come up to run the migrations");

// --- content
const db = new DatabaseSync(dbFile);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const peerId = one("select peer_id from node_identity").peer_id;
const boots = one("select password_hash from users where username = 'parity-bootstrap'");
const radarr = uid("source:radarr"), sonarr = uid("source:sonarr"), lidarr = uid("source:lidarr");
const j = JSON.stringify;
const iso = (offsetMs) => new Date(Date.parse(CLOCK) + offsetMs).toISOString();

db.exec("begin");
for (const t of ["users", "policies"]) run(`delete from ${t} where ${t === "users" ? "username = 'parity-bootstrap'" : "name = 'Bootstrap Admin'"}`);
for (const [id, kind, name] of [[radarr, "radarr", "Movies"], [sonarr, "sonarr", "Series"], [lidarr, "lidarr", "Music"]]) // a lidarr instance is what makes /catalog/kinds list artists, so the Music nav item shows
  run("insert into source_instances (id, kind, name, base_url, api_key_encrypted, priority, enabled_for_requests, best_effort, updated_at, origin_peer_id, folder_mappings) values (?,?,?,?,?,?,?,?,?,?,?)",
    id, kind, name, "http://127.0.0.1:9", "unused", 10, 0, 0, FROZEN_AT, peerId, "{}");

const accountName = cfg.PARITY_ACCOUNT_NAME;
const userIds = {};
for (const p of PROFILES) {
  const username = `${accountName}${p.suffix}`, id = uid(`user:${p.key}`), policy = uid(`policy:${p.key}`);
  userIds[p.key] = id;
  run("insert into policies (id, name, library_allow, can_transcode, can_download, can_delete, can_share_public, device_allow, is_admin, can_stream, updated_at, origin_peer_id, group_library_allow, household, can_request) values (?,?,?,1,1,0,0,'[]',0,1,?,?,'[]',?,0)",
    policy, `${username}'s policy`, j([sonarr, radarr, lidarr]), FROZEN_AT, peerId, j({ unrated: "block", timezone: null, daily_budget_minutes: null, channel_allow: null, game_allow: null, app_allow: null, guardian_user_ids: [], approval_required: [], offline_ttl_hours: null }));
  run("insert into users (id, username, display_name, password_hash, policy_id, created_at, disabled, preferred_audio_language, updated_at, origin_peer_id) values (?,?,?,?,?,?,0,'en',?,?)",
    id, username, p.display, boots.password_hash, policy, FROZEN_AT, FROZEN_AT, peerId);
  run("insert into user_profile_avatars (user_id, preference, updated_at) values (?,?,?)", id, j({ kind: "preset", value: p.avatar }), FROZEN_AT);
}

const images = (workId) => j([{ kind: "poster", url: `${artBase}/${workId}-poster.png`, width: null, height: null }, { kind: "backdrop", url: `${artBase}/${workId}-backdrop.png`, width: null, height: null }]);
const insertWork = (w, kind, tags, availability, releaseDate) =>
  run("insert into works (id, kind, title, sort_title, overview, images, genres, tags, added_at, monitored, availability, release_date) values (?,?,?,?,?,?,?,?,?,1,?,?)",
    w.workId, kind, w.title, w.title.toLowerCase(), w.overview ?? null, images(w.workId), j(w.genres ?? []), j(tags), w.addedAt, availability, releaseDate);
const insertFile = (fileId, workId, leaf, source, n) => {
  run("insert into media_files (id, work_id, leaf_ref, path, container, codec, bitrate, size_bytes, source_instance_id, source_file_id, duration_ms) values (?,?,?,?,?,?,?,?,?,?,?)",
    fileId, workId, leaf, clip, "mkv", "x264", 300000, clipSize, source, String(n), CLIP_SECONDS * 1000);
  for (const [kind, lang] of [["audio", "en"], ["audio", "fr"], ["subtitle", "en"]]) run("insert into media_file_languages (media_file_id, kind, lang, source) values (?,?,?,'arr')", fileId, kind, lang);
};
let fileNo = 0;
for (const m of MOVIES) {
  insertWork(m, "movie", [`rating:${m.certification}`], "available", `${m.year}-06-01T00:00:00.000Z`);
  run("insert into work_external_refs (work_id, provider, external_id) values (?,?,?)", m.workId, "tmdb", String(m.tmdbId));
  insertFile(m.fileId, m.workId, "work", radarr, ++fileNo);
}
for (const s of SERIES) {
  insertWork(s, "series", [`rating:${s.certification}`, "score:7.5:100"], "unknown", `${s.year}-01-01T00:00:00.000Z`);
  run("insert into work_external_refs (work_id, provider, external_id) values (?,?,?)", s.workId, "tvdb", String(s.tvdbId));
  for (const sn of s.seasons) {
    const seasonId = uid(`${s.key}:season:${sn.number}`);
    run("insert into seasons (id, series_work_id, season_number, monitored, availability) values (?,?,?,1,'unknown')", seasonId, s.workId, sn.number);
    for (const e of sn.episodes) {
      run("insert into episodes (id, season_id, episode_number, title, overview, air_date, runtime_minutes, monitored, availability, images) values (?,?,?,?,?,?,1,1,'available',?)",
        e.id, seasonId, e.number, e.title, "Placeholder episode.", e.airDate, j([{ kind: "thumb", url: `${artBase}/${s.workId}-backdrop.png`, width: null, height: null }]));
      insertFile(e.fileId, s.workId, `episode:${e.id}`, sonarr, ++fileNo);
    }
  }
}
for (const a of ARTISTS) {
  insertWork({ ...a, genres: ["Pop"] }, "artist", [], "available", null);
  for (const al of a.albums) {
    run("insert into albums (id, artist_work_id, title, album_type, release_date, monitored, availability) values (?,?,?,?,?,1,'available')", al.id, a.workId, al.title, "studio", al.releaseDate);
    // A track file per track: the Music library lists only artists with a playable file.
    al.tracks.forEach((t, i) => {
      run("insert into tracks (id, album_id, disc_number, track_number, title, duration_seconds, availability) values (?,?,1,?,?,?,'available')", t.id, al.id, i + 1, t.title, t.seconds);
      insertFile(uid(`file:${t.id}`), a.workId, `track:${t.id}`, lidarr, ++fileNo);
    });
  }
}

// Watch progress and watchlist belong to the main profile; the others stay clean.
const main = userIds.main;
const progress = (fileId, positionMs, state, at) =>
  run("insert into watch_progress (user_id, media_file_id, position_ms, duration_ms, state, updated_at) values (?,?,?,?,?,?)", main, fileId, positionMs, CLIP_SECONDS * 1000, state, at);
for (const d of ON_DECK) {
  const ref = d.movie !== undefined ? MOVIES[d.movie] : SERIES[d.episode.series].seasons[d.episode.season - 1].episodes[d.episode.episode - 1];
  progress(ref.fileId, d.positionMs, "part_watched", iso(-d.hoursAgo * 3600e3));
}
WATCHED.forEach((w, i) => progress(MOVIES[w.movie].fileId, CLIP_SECONDS * 1000, "watched", iso(-(48 + i) * 3600e3)));
WATCHLIST.forEach((w, i) => {
  const t = w.kind === "movie" ? MOVIES[w.index] : SERIES[w.index];
  const provider = w.kind === "movie" ? "tmdb" : "tvdb", id = String(w.kind === "movie" ? t.tmdbId : t.tvdbId);
  run("insert into watchlist_items (user_id, title_key, kind, title, year, work_id, external_refs, poster_url, added_at) values (?,?,?,?,?,?,?,?,?)",
    main, `${provider}:${w.kind}:${id}`, w.kind, t.title, t.year, t.workId, j([{ provider, external_id: id }]), `${artBase}/${t.workId}-poster.png`, iso(-(i + 1) * 6 * 3600e3));
});

// Calendar: the cached monthly chunks the background refresher would otherwise fill from the *arr instances.
const chunks = new Map();
CALENDAR.forEach((c, n) => {
  const isMovie = c.movie !== undefined, t = isMovie ? MOVIES[c.movie] : SERIES[c.series], instance = isMovie ? radarr : sonarr;
  const last = isMovie ? null : t.seasons.at(-1), epNo = isMovie ? null : last.episodes.length + 1;
  const key = isMovie ? `movie:tmdb${t.tmdbId}:digital:${c.date}` : `episode:tvdb${t.tvdbId}:s${last.number}e${epNo}:air:${c.date}`;
  const entry = { id: key, media_kind: isMovie ? "movie" : "episode", release_type: isMovie ? "digital" : "air", title: t.title, subtitle: isMovie ? null : `Episode ${epNo}`,
    season_number: isMovie ? null : last.number, episode_number: epNo, date: c.date, release_at: c.releaseAt, monitored: true, has_file: false,
    poster_url: `${artBase}/${t.workId}-poster.png`, overview: "Placeholder release.",
    sources: [{ source_instance_id: instance, source_name: isMovie ? "Movies" : "Series", display_label: isMovie ? "Movies" : "Series", source_kind: isMovie ? "radarr" : "sonarr", arr_id: 5000 + n }] };
  const bucket = `${instance}|${c.date.slice(0, 7)}`;
  chunks.set(bucket, [...(chunks.get(bucket) ?? []), { entry, dedup_key: key, work_ref: isMovie ? ["tmdb", String(t.tmdbId)] : ["tvdb", String(t.tvdbId)] }]);
});
for (const instance of [radarr, sonarr, lidarr]) {
  for (const month of ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"])
    run("insert into calendar_source_chunks (instance_id, month, fetched_at, entries_json) values (?,?,?,?)", instance, month, FROZEN_AT, j(chunks.get(`${instance}|${month}`) ?? []));
  run("insert into calendar_source_health (instance_id, last_success_at, last_attempt_at, consecutive_failures) values (?,?,?,0)", instance, FROZEN_AT, FROZEN_AT);
}
db.exec("commit");
db.exec("pragma wal_checkpoint(truncate)");
db.close();
console.log(`pristine DB ${dbFile}: ${MOVIES.length} movies, ${SERIES.length} series, ${fileNo} files, ${ARTISTS.length} artists, ${PROFILES.length} profiles`);
