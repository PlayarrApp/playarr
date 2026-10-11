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
- **Playback cases** a (normal 1080p), b (4K HEVC), c (title served by the other server). Each pins a
  media `file` id on the test server (the Device Test account). Case c is the same file served through the other server
  and needs the admin routing rule that prefers the other node (`setup` in `suite.json`); web then plays it through
  `/media/proxy/`. Without that rule it just replays case a.

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
| `route(path)` | Deep link to a web route; used only for screens whose `keys` are null. |
| `location()` | Current route as `/path?query` in web terms (map native screens to the suite routes). |
| `focused()` | Label of the focused item (accessibility label or visible text), or null. |
| `screenshot(file)` | Write a 1920x1080 PNG. Throw if the screen is an error or signed-out screen. |
| `play(case, expect)` | Play the media file `case.file` (deep link or the device's own way), return `{ state: "playing"\|"stalled"\|"error", startSeconds, advancedSeconds, detail? }`. |

Run: `node suite-run.mjs --driver ./my-driver.mjs --out <dir>/<cand>/ [--themes dark] [--only screens,dpad,playback]
[--screens home,movies] [--via keys|route] [--expected <web>/expected.json]`. A screen whose end state does not match
the suite route is not written. Web reference: `--driver drivers/web.mjs --reference --out <dir>/web` (env:
`PLAYARR_WEB_URL`, `PLAYARR_SERVER_URL`, `PLAYARR_USERNAME`, `PLAYARR_PASSWORD`, `PARITY_CHROME`).

## Session rule: never share sessions

Every suite run signs in fresh with its own new device id. Never load, copy or reuse another run's storage state,
cookies or tokens, and never write a session to disk to reuse it: keep it in memory for the length of the run (the web
driver carries it across the theme switch in memory only) and delete any state file the run created when it ends.
Concurrent runs on one account otherwise revoke each other's sessions. The legend and capture scripts follow the same
rule.

## Layout and result files

Captures: `<out>/<theme>/<id>.png`. The reference run also writes `<out>/expected.json`
(`{ suite, dpad: { <id>: <label> }, playback: { <id>: { state } } }`).

`dpad.json` (device runs):

```json
{ "suite": 1, "checked_at": "ISO time",
  "results": [ { "id": "home-right", "pass": true, "expected": "open x", "actual": "open x" } ] }
```

`playback.json`:

```json
{ "suite": 1, "checked_at": "ISO time",
  "results": [ { "id": "a", "pass": true, "state": "playing", "startSeconds": 4.1, "advancedSeconds": 4.2 } ] }
```

The device wall legend reads `<dir>/<cand>/dpad.json` and `playback.json`: passed = results with `pass: true`, out of
the suite's check count (11 D-pad checks, 3 playback cases). Missing results count as failed.
