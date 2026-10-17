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
- **Player D-pad checks** (from `player-controls`, which loads the player and shows its controls). They play a title, which changes On deck on the shared account, so the runner skips them (`pass: null`, not a failure) unless the file named by `PLAYARR_PLAYBACK_PHASE_FILE` exists (the PLAYBACK-PHASE window) or `--player` is given; `--skip-player` always skips. Before the first key a driver with `playerReady()` must reach a known state: video playing, controls visible, focus on play/pause (web waits for it; other drivers get the fixed `wait`). The play/pause button is one role: its label ("Play" or "Pause") is ignored in comparisons.
  initial focus, Right order across the controls (audio, subtitles, playlist, quality, info, cast), Left at the edge, Up to the
  seek bar and Down back to the buttons, OK on play/pause, and Back: on web, with the title playing and focus on play/pause, the first Back hides the controls (still `player/:id`) and the second leaves the player (to `movies/:id`) (`observe: "state"` records the route shape, e.g. `player/:id`, `movies/:id`, `movies`), and the audio/subtitle panel opening and closing.
- **Downloads cases** (`downloads` in `suite.json`, media pinned in `downloadMedia`: the smallest original files: a movie and an
  episode on the test server): start a movie download and see it complete, start an episode download, pause then
  resume, cancel mid-download, delete a completed download, edit keep-until and quality, play the downloaded title
  offline (network off, then the same "frames advance" check as playback), and a system notification that appears,
  updates its progress and ends as completed or paused. Four more cases (series-level and season-level pause and delete)
  are marked `requires: grouped-downloads` and are skipped as "not built yet" until the grouped Downloads page ships.
  Run them under the shared playback lock and delete what you download.
- **Now-playing entry**: performance case a (`nowPlaying: true`) also checks that the platform's now-playing entry
  exists with a title, is in the playing state, and that its Pause action pauses the player.

Pinned detail checks carry an `open` path with a work id. The runner always
calls `driver.route(open)` for them, so a driver must open that exact work by id (deep link or its own search), never "the first card":
web and native then show the same work. The web driver waits for route content, fonts, visible images and loading indicators before a screenshot.

The four Home checks (`compare: "position"` in `suite.json`, each with `start: { rail: 0, index: 0 }`) compare focus **position**, not the label. The label stays in
the result as information. A driver that does not report `position` is compared by label. A wrong start or missing focus fails that single observation; the runner does not repeat a failed navigation check. `expected.json` stores
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
| `playerReady()` | Optional. Before a player D-pad check: wait until the video is playing, the controls are visible and focus is on play/pause; throw if it does not happen. |
| `playhead()` | Optional. Playhead in seconds, or null. Before the first key of a player check the runner waits (up to 45 s) until it is past 1 s, so a slow player does not eat keys. |
| `panelOpen()` | Optional. True when the audio or subtitle panel is open. The `player-panel-*` checks (`observe: "panel"`) record `panel:open` or `panel:closed`; without it they fall back to the focused label. |
| `play(case, expect)` | Play the media file `case.file` (deep link or the device's own way), return `{ state: "playing"\|"stalled"\|"error", startSeconds, advancedSeconds, detail?, nowPlaying?: { ok } }` (`nowPlaying` only when `case.nowPlaying` and `supports.nowPlaying`). |

Run: `node suite-run.mjs --driver ./my-driver.mjs --out <dir>/<cand>/ [--themes dark] [--only screens,dpad,downloads,performance]
[--screens home,movies] [--checks home-right] [--via keys|route] [--expected <web>/expected.json]`. A screen whose end state does not match
the suite route is not written. State pinning is the default for every driver (fixed clock, canonical On deck seeded from `PARITY_DECK_MEDIA_FILE_ID` or the `PLAYARR_DEVICE_TEST_HOME_DECK_MEDIA_FILE_ID` secret); strict readiness and build identity apply only to drivers that declare `strictReadiness` (web, apple-ios); others use their normal wait, and `captures.json` or `readiness.json` records `readiness`. Set `PARITY_STABLE=0` to opt out, as the hosted walls and fixture tests do. Stable mode requires a client driver that implements `setDeterministicCapture({ fixedNow, disableAnimations })`, `waitReady({ screen, phase })`, and an identifiable deployed build. Unsupported capabilities fail the run. It takes one observation per check and preserves failures in the score.

Stable D-pad runs also require an isolated client account and an explicit scratch lock directory. `PARITY_CLIENT` selects that account; `PARITY_LOCK_DIR` serialises runs against it. For a canonical navigation fixture, set the local-only `PARITY_DECK_MEDIA_FILE_ID` (and optionally `PARITY_DECK_POSITION_MS`, `PARITY_DECK_DURATION_MS`). Every capture script (`capture-refs.mjs`, `capture-web-motion.mjs`, `suite-run.mjs`) then resets all other progress and seeds that one On deck item through `scripts/parity/canonical-deck.mjs`; `PARITY_SEED_CANONICAL=1` makes a missing ID an error. The runner seeds state while holding the account lock and records only a hash of progress and preferences in provenance. Those fields are restored after the run. Unchanged progress rows are not rewritten, preserving their recency; the API cannot backdate progress rows that the run changed. Resume choices are cleared for setup, are not restored, and are excluded from the state hash. Use only a disposable isolated account whose resume choices may be cleared and whose changed progress recency is acceptable; never point this flow at a personal account or device. A matching state hash therefore describes progress and preferences only, not the complete account state.

For example, a full D-pad capture including player checks uses `--only dpad --player`. A navigation-only run uses `--only dpad --skip-player`; its player rows are explicitly skipped and it must be labelled as a navigation subset. To compare repeated runs, keep the same build, suite, fixed clock, canonical state and expected reference. `PARITY_EXPECTED_BUILD_SHA` pins the build and the runner checks it before and after capture. `PARITY_FIXED_NOW` pins wall-clock date while browser timers continue to advance. The web driver disables CSS transitions and Web Animations during stable capture. Stable-focus and detail-readiness predicates are synchronous because Playwright's polling callback does not await returned promises; focus readiness requires stable native focus and, when remote-marker mode is active, agreement with the marker.

Web reference: `--driver drivers/web.mjs --reference --out <dir>/web` (env:
`PLAYARR_WEB_URL`, `PLAYARR_SERVER_URL`, `PLAYARR_USERNAME`, `PLAYARR_PASSWORD`, `PARITY_CHROME`).

## Session rule: never share sessions

Every suite run signs in with a fresh device id. Never load or reuse browser storage state, cookies or tokens from
another run. Keep session material in memory for the run. Stable runs serialise access to the dedicated capture account
and restore its captured state after the run; do not run concurrent captures against that account.

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

## Deterministic result publication

Every `dpad.json` result records suite version, build identity, clock pin (`unpinned` for non-stable runs), isolated state hash, stable-run flag, expected-reference SHA-256 and per-check timestamp. Stable screen manifests retain their capture provenance fields. Selective result merges require all D-pad provenance fields to match, so unpinned runs cannot merge into stable results.
Selective runs (`--checks`) publish only when a complete prior result has matching provenance. The merge preserves all
untouched IDs and rejects missing/extra IDs or a lower pass count unless `PARITY_REGRESSION_REASON` names the accepted
regression. A full selection replaces the result set; when it has the same provenance, it also rejects an unacknowledged
drop in pass count. A complete run against a different build or state is a new baseline and records its provenance.
