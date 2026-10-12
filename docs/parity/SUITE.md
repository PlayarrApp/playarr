# Shared parity suite

One suite, every device. `scripts/parity/suite.json` lists what each platform must be scored on; web
(`clients/tv-web`) is the source of truth, so its run writes the expected results and every other client is compared
against them. Validate the file with `node --test scripts/parity/suite.test.mjs` (in `scripts/parity`).

Devices and how each is run: [DEVICES.md](DEVICES.md).

## What the suite holds

- **15 screens** (home, movies, series, music, calendar-month, calendar-week, calendar-agenda, search, film-detail,
  series-detail, settings, filters, profiles, player-controls, actions), each with the web `route` it ends on and the
  D-pad `keys` that reach it from the signed-in Home screen (`match` is the end-state pattern when it differs from
  `route`, e.g. the agenda is the calendar's default view). Calendar views are chosen in the calendar's Filters panel
  (View toggle, then Back); the library Filters button is the last stop to the right of the grid.
- **2 themes**: dark, light. 15 x 2 = 30 captures per client.
- **D-pad checks**: a start screen, a key sequence, and the focused item (its accessible label) compared with web's
  result in `expected.json`.
- **Performance cases** a (normal 1080p), b (high-bitrate H.264 the server serves without a live re-encode), c (title served
  by the other server) are NOT parity: since 12 Oct they live in the `performance` section of `suite.json` for a later
  performance suite and are run only with `--only performance` (writing `performance.json`). The player's look and navigation
  stay parity: the `player-controls` screen (dark and light) and the player D-pad checks below.
- **Player D-pad checks** (from `player-controls`, which loads the player and shows its controls; `wait` gives it time):
  initial focus, Right order across the controls (audio, subtitles, playlist, quality, info, cast), Left at the edge, Up to the
  seek bar and Down back to the buttons, OK on play/pause, and Back: on web one Back with the controls up already leaves the player (to the title's detail screen) and a second
  Back goes on to the list (`observe: "state"` records the route shape, e.g. `player/:id`, `movies/:id`, `movies`), and the audio/subtitle panel opening and closing.
- **Downloads cases** (`downloads` in `suite.json`, media pinned in `downloadMedia`: the smallest original files: a movie and an
  episode on the test server): start a movie download and see it complete, start an episode download, pause then
  resume, cancel mid-download, delete a completed download, edit keep-until and quality, play the downloaded title
  offline (network off, then the same "frames advance" check as playback), and a system notification that appears,
  updates its progress and ends as completed or paused. Four more cases (series-level and season-level pause and delete)
  are marked `requires: grouped-downloads` and are skipped as "not built yet" until the grouped Downloads page ships.
  Run them under the shared playback lock and delete what you download.
- **Now-playing entry**: performance case a (`nowPlaying: true`) also checks that the platform's now-playing entry
  exists with a title, is in the playing state, and that its Pause action pauses the player.

Pinned titles: `film-detail` (2 Fast 2 Furious) and `series-detail` (2 Broke Girls) carry an `open` path with the work id. The runner always
calls `driver.route(open)` for them, so a driver must open that exact title by id (deep link or its own search), never "the first card":
web and native then show the same title. The web driver also waits for skeletons, spinners and images to settle before a screenshot.

The four Home checks (`compare: "position"` in `suite.json`, each with `start: { rail: 0, index: 0 }`) compare focus **position**, not the label: Home rails reorder
whenever other devices play on the shared account, so the same key press lands on a different title from run to run. The label stays in
the result as information. A driver that does not report `position` is compared by label, as before. When a check has `start`, the runner reads `focused()` after `home()` and, if the position differs, re-homes and retries (up to 3 times), so `home()` must leave focus on the first Home card with the key handler live. The web reference fails the run instead of recording a null or wrong-start answer. `expected.json` stores
`{ label, position }` for these checks, and a plain label for the others.

Keys: `up down left right select back`, `select:long` for a long press, `name*N` to repeat. Nav moves are anchored at
the bottom of the nav rail (`left`, `down*12` clamps on the profile entry), because the top depends on the account.
The account is the Device Test profile.

## Driver contract

A device worker writes one ES module exporting `createDriver({ out, args })` that returns an object with these methods
(all async; `start`/`stop` optional). The runner `scripts/parity/suite-run.mjs` does everything else.

| Method | Meaning |
| --- | --- |
| `start()` / `stop()` | Launch and tidy up the app or session. |
| `setTheme("dark"\|"light")` | Switch theme (system setting or in-app), staying signed in. |
| `home()` | Back to the signed-in Home screen with its first card focused. |
| `key(name, { long })` | Press one D-pad key (`long`: hold about 1 s). |
| `route(path)` | Deep link to a web route; used for screens whose `keys` are null and for pinned `open` paths (map the work id to the device's own detail screen). |
| `location()` | Current route as `/path?query` in web terms (map native screens to the suite routes). |
| `focused()` | The focused item: its label (accessibility label or visible text) as a string, or `{ label, position: { rail, index } }`, or null. `position` is where focus sits: on Home `rail` is the rail number (0 = first rail) and `index` the card number in it (0 = first); on the nav rail `rail` is `"nav"` and `index` the item number from the top. Report it wherever the device can; drivers that cannot keep returning a string. |
| `screenshot(file)` | Write a 1920x1080 PNG. Throw if the screen is an error or signed-out screen. |
| `supports` | Optional object of flags: `downloads`, `notifications` (the driver can read system notifications), `nowPlaying` (it can read the now-playing entry), `grouped-downloads` (the device has the grouped Downloads page). |
| `download(case, expect)` | Optional. Run one downloads case (`case.action`, `case.media` = title, work id, file id), return `{ state: "ok"\|"failed", detail }`. Must leave nothing downloaded. |
| `cleanupDownloads()` | Optional. Remove every download the cases touched (safety net after an abort). |
| `play(case, expect)` | Play the media file `case.file` (deep link or the device's own way), return `{ state: "playing"\|"stalled"\|"error", startSeconds, advancedSeconds, detail?, nowPlaying?: { ok } }` (`nowPlaying` only when `case.nowPlaying` and `supports.nowPlaying`). |

Run: `node suite-run.mjs --driver ./my-driver.mjs --out <dir>/<cand>/ [--themes dark] [--only screens,dpad,downloads,performance]
[--screens home,movies] [--reset-progress] [--via keys|route] [--expected <web>/expected.json]`. A screen whose end state does not match
the suite route is not written. `--reset-progress` (needs the same `PLAYARR_*` env as the web driver) sets the watch progress of every pinned file back to 0 through the API before the captures and after each playback case and offline-play check, so On deck and Resume stay the same on every device. Web reference: `--driver drivers/web.mjs --reference --out <dir>/web` (env:
`PLAYARR_WEB_URL`, `PLAYARR_SERVER_URL`, `PLAYARR_USERNAME`, `PLAYARR_PASSWORD`, `PARITY_CHROME`).

## Session rule: never share sessions

Every suite run signs in fresh with its own new device id. Never load, copy or reuse another run's storage state,
cookies or tokens, and never write a session to disk to reuse it: keep it in memory for the length of the run (the web
driver carries it across the theme switch in memory only) and delete any state file the run created when it ends.
Concurrent runs on one account otherwise revoke each other's sessions. The legend and capture scripts follow the same
rule.

## Layout and result files

Captures: `<out>/<theme>/<id>.png`. The reference run also writes `<out>/expected.json`
(`{ suite, dpad: { <id>: <label> }, performance: { <id>: { state } } }`).

`dpad.json` (device runs):

```json
{ "suite": 1, "checked_at": "ISO time",
  "results": [ { "id": "home-right", "pass": true, "compared": "position", "expected": { "label": "open x", "position": { "rail": 0, "index": 1 } }, "actual": { "label": "open y", "position": { "rail": 0, "index": 1 } } } ] }
```

`performance.json` (only with `--only performance`; same shape):

```json
{ "suite": 1, "checked_at": "ISO time",
  "results": [ { "id": "a", "pass": true, "state": "playing", "startSeconds": 4.1, "advancedSeconds": 4.2 } ] }
```

`downloads.json`: one result per case. `pass: null` with `state: "not supported"` (device or driver without downloads,
or without `supports.notifications`) or `"not built yet"` (`requires: grouped-downloads`) is a skip, not a failure,
and does not count towards the total.

```json
{ "suite": 1, "checked_at": "ISO time",
  "results": [ { "id": "movie-download", "pass": true, "state": "ok", "detail": "..." },
               { "id": "series-pause", "pass": null, "state": "not built yet" } ] }
```

Each performance result may also carry `profile`, data for the performance and bug-testing epic that is never part of the
score: `mode` (negotiated: `direct` or `hls`), `playMethod` (`direct_play`, `direct_stream` or `transcode`), `health` (the
server's facts for the session: source and delivered video, bitrate, dynamic range, audio, transcode reason),
`quality`, `decoded` (video width and height), `timeToFirstFrameSeconds`, `negotiationStatuses`,
`no_transcode_capacity` (a 503 was seen) and `stalled`. Drivers fill what they can read; web gets the facts from
`POST /api/v1/playback/sessions/{id}/health`.

The device wall legend reads `<dir>/<cand>/dpad.json` and `downloads.json`: passed = results with `pass: true`, out of the suite's
check count (the D-pad checks in `suite.json`; skipped download cases do not count). Missing results count as failed. `performance.json`
(only with `--only performance`, same shape) is not scored.
