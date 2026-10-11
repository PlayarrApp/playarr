# Playarr for Sailfish OS

Fully native client: Qt 5.6 / QML with Sailfish Silica, a C++ backend (`QNetworkAccessManager`) and QtMultimedia
playback. The web app's mobile layout is the design reference; colours are the web tokens, dark and light
(`qml/components/Tokens.qml`), following the ambience unless the in-app theme is set.

Milestone 1 (this directory): QR / device-code sign-in through the hosted link (no server address is ever typed),
profile picker with the shared alien and other preset avatars, Home rails with "Start watching", Movies / Series /
Music grids with infinite scroll, title detail (seasons, episodes, albums), search, theme and sign-out settings, and
playback with resume and server progress reporting (direct and HLS).

Not yet: calendar, downloads, watchlist, requests, player menus (audio, subtitles, quality), PIN prompts, scroll-edge
fades, and the "sailfish" platform identity. Until the broker allow-list and the server enum accept `sailfish` the app
sends the `web` compatibility identity (one constant, `kPlatform` in `src/api.cpp`), as the Roku client does.

## Layout

| Path | What |
| --- | --- |
| `src/api.*` | server client: authenticated JSON requests, single-flight token refresh, hosted link flow, stored profiles |
| `src/main.cpp` | app entry, image network factory (bearer token only for the signed-in server, 200 MB artwork cache) |
| `qml/` | Silica UI: `pages/` and `components/` |
| `rpm/harbour-playarr.spec` | RPM spec (i486 for the emulator, armv7hl and aarch64 for devices) |
| `tests/` | logic checks (`tests.pro`), a placeholder API server and a host QML smoke run (`smoke/`) |
| `scripts/sdk-build.sh` | build with the official SDK tarballs, no Docker and no root |

## Build (no container, no root)

The Sailfish SDK's `sfdk` needs Docker or VirtualBox. `scripts/sdk-build.sh` instead unpacks the official SDK Target
and Tooling tarballs once and runs `qmake`, `make` and `rpmbuild` inside them in an unprivileged bubblewrap user
namespace (the same toolchain `sfdk` uses, minus the engine):

```
scripts/sdk-build.sh setup  ~/sfos-sdk            # i486 target, about 3 GB
scripts/sdk-build.sh test   ~/sfos-sdk            # logic checks
scripts/sdk-build.sh build  ~/sfos-sdk ~/out i486 # RPM in ~/out
```

Needs `bwrap`, `bsdtar`, `rsync`, `curl`. The i486 tools run natively on x86-64. armv7hl and aarch64 RPMs need the
matching Target plus `qemu-user` for the target's own tools; build those where that is available.

## Smoke run on a desktop

`tests/smoke` loads the same QML against small stand-ins for the Silica types (layout and data flow only, not a
Silica render) and writes screenshots: `python3 tests/fake_server.py <port>`, seed a profile in the app's settings
file for that server, then run `playarr-smoke` with `QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software` and
`SMOKE_STEPS='wait|grab:out.png'`. Real rendering is checked on the Sailfish emulator.

## Storage

Tokens are kept in the app's per-user settings file (`~/.config/harbour-playarr`). shortcut: move them to Sailfish
Secrets once it is available to Harbour apps.
