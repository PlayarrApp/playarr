# Playarr for Linux phones

`clients/linux-mobile/` is the native Playarr app for Linux phones (postmarketOS with Phosh, the Nura phone and
any GNOME-mobile style shell). It is a GTK4 and libadwaita application written in Rust, with GStreamer
(`playbin3`, HLS) for playback. It is not a browser view: every screen is a native widget tree, and the layout,
rails, cards and tokens follow the web app's mobile layout (`clients/tv-web`, the design source of truth).

## Identity

- Link broker (`https://playarr.app/api/link/*`): `linux-phone`.
- Server header `X-Playarr-Client-Platform`: `web` until the server's closed platform enum gains `linux-phone`
  (one constant, `SERVER_PLATFORM` in `src/api.rs`).

## Sign-in

Device-code pairing through the hosted link broker, like the TV apps: the app shows a QR code and a short code,
the viewer approves on another device (or in a browser on the phone) and picks the profile, and the app receives
the server address and tokens. The user never types a server URL. The session lives in
`$XDG_DATA_HOME/playarr-mobile/session.json` (mode 0600).

## Build and test

```sh
# Debian/Ubuntu: libgtk-4-dev libadwaita-1-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
# Alpine: gtk4.0-dev libadwaita-dev gstreamer-dev gst-plugins-base-dev
cargo test
cargo run
```

Runtime needs GStreamer `playbin3` plus `gtk4paintablesink` (Debian `gstreamer1.0-gtk4`, Alpine `gst-plugin-gtk4`).
Media requests need the account token on every HLS segment, which GStreamer's adaptive demuxers do not forward, so
playback goes through a loopback proxy in the app process (`src/proxy.rs`).

## Font

`data/fonts/` holds Nunito Sans (SIL OFL, see `OFL-NunitoSans.txt`) converted from the web app's woff2. Packages
install it under the system font directory so fontconfig finds it.

## Screens

Sign-in, profile picker, Home (On deck first, then the server rails), Movies, Series and Music grids with infinite
scroll and a filters sheet (sort, availability, genre), release calendar (agenda, week, month), search, title
detail (film, series with seasons and episodes, artist with albums and tracks), a long-press actions sheet (play,
details, add to playlist), settings (theme, account), and the player (resume, scrubber, progress reporting every ten
seconds and on exit). Offline downloads are not available yet and the sheet says so.

## Debug and capture hooks

Environment variables for development and the parity capture scripts; none changes behaviour when unset.

| Variable | Effect |
|---|---|
| `PLAYARR_BROKER` | Link broker origin (default the hosted broker). |
| `PLAYARR_BROKER_PLATFORM` | Broker identity override while a broker does not know `linux-phone` yet. |
| `PLAYARR_AUDIO_SINK` | GStreamer audio sink element, for example `fakesink` on a machine without sound. |
| `PLAYARR_ROUTE` | Skip the picker and open `home`, `movies`, `series`, `music`, `search`, `calendar`, `film`, `series-detail`, `player`, `profiles`, `settings`, `filters` or `actions`. |
| `PLAYARR_SEARCH`, `PLAYARR_CAL_VIEW`, `PLAYARR_AUTO_FILTERS`, `PLAYARR_KEEP_CONTROLS` | Pre-fill the search, pick the calendar view, open the filters sheet, pin the player controls. |

## Packaging

`packaging/flatpak/` builds a Flatpak (GNOME 50 runtime, and GStreamer's GTK4 sink from gst-plugins-rs);
`packaging/alpine/APKBUILD` builds the Alpine and postmarketOS package.

## Scope

Offline downloads, the requests and household screens and casting are not part of this client yet.
