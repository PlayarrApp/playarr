# Playarr for Samsung Tizen TV (native, Tizen .NET / NUI)

Fully native Samsung TV client in C# with Tizen NUI, replacing the packaged web app (`clients/tv-web/apps/tv-tizen`)
over time. The web TV client (`clients/tv-web`, 1920x1080) is the design source of truth: layout, focus, D-pad
behaviour and tokens match it.

- `src/Playarr.Tizen.Logic` (net8.0): remote-key mapping, geometric D-pad focus search, client identity. No Tizen API, unit tested.
- `src/Playarr.Tizen` (net8.0-tizen10.0): the NUI application head. It also uses `clients/xbox/src/Playarr.Core` (API client, device flow, models) through `Playarr.Tizen.Logic`.
- `tests/Playarr.Tizen.Logic.Tests`: xUnit.

## Toolchain (Linux, no root)

1. .NET SDK 8.0.4xx in a user prefix.
2. The Samsung Tizen workload: `workload-install.sh -v 10.0.126 --dotnet-install-dir <prefix>` from `Samsung/Tizen.NET` (see the `tizen-native-check` job for the pinned commit and checksum).
3. `dotnet build src/Playarr.Tizen -c Release` produces a tpk, test-signed with the SDK's default certificate (enough for CI).
4. `scripts/deploy.sh [serial]` builds with your Samsung certificate profile and installs and runs it through `sdb`.

## Emulator notes

- NUI aborts on the Tizen TV emulator unless multisampling is off: `Program.Main` calls libc `setenv("DALI_MULTI_SAMPLING_LEVEL", "-1")`
  (`Environment.SetEnvironmentVariable` does not reach native code on Linux).
- `sdb shell` and `dlog` are disabled on the TV profile; read app output (stderr is redirected) from the emulator's kernel log.

## What is built

Sign-in (QR via the hosted link broker, as `tizen-native`), nav rail with D-pad focus, Home, Movies/Series/Music grids with the
A-Z rail and the Filters drawer, film and series detail with a cast rail, search, Settings (appearance), the profile picker,
calendar (month, week, agenda), long-press title actions, and HLS playback on the TV player plane (controls, resume, progress
reports), offline downloads and Playlists, Watchlist and Requests show an honest "not available yet" page except Downloads (below).

Layout, tokens and focus follow web TV at 1920x1080; the geometry in the code is measured from the web DOM. Artwork goes through
the server's artwork route (`/api/v1/artwork/...`), like web.

## Parity driver

Build with `-p:PlayarrDebug=true` (never in CI or release): the app then starts a control server on port 8765 (`/state`, `/key`,
`/route`, `/theme`, `/text`). `scripts/parity/drivers/tizen-native.mjs` drives the shared suite through `sdb forward` and
screenshots the emulator display (`docs/parity/DEVICES.md`).

## Downloads, and what the platform does not do

Downloads follow the server tickets API (`/api/v1/downloads`): choose a quality and a keep-until from the film detail Download
button, then the Downloads page lists Active, Downloaded and Needs attention with Pause, Resume, Cancel, Play (offline, from the
local file), Edit (keep-until) and Delete. The engine runs in the app (HttpClient with Range resume into the app data
directory, `downloads.json` as the index), so a transfer continues only while the app is running and anything mid-transfer on
start comes back paused.

Not supported on this platform, by design of the Tizen TV profile:

- **Download notifications** (progress, paused, completed, failed): a TV has no notification tray for third-party apps, so the
  Downloads page and the in-app toast are the only surface.
- **Now-playing notifications and media-session hooks**: the Tizen TV profile has no system media-controls surface that a
  third-party .NET app can publish to, so title, artwork and transport controls are only on the player itself and the remote's
  media keys.
- **Background transfers**: the app has no background service on the TV profile.
- Season downloads create one ticket per episode and run two at a time; the keep-until presets are Forever, 1 week or 30 days after watched.
