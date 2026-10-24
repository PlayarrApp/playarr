# Parity devices: how each one is run and tested

Every device is scored by the shared suite (`SUITE.md`) against the web reference and shown on the device wall legend.
Captures go to `<legend dir>/<cand>/<theme>/<screen>.png`; the TV reference is web TV at 1920x1080, the mobile
reference is web mobile at the device's own size. The legend dir is the client's folder under the parity scratch area
(host paths are not recorded here). Host names, addresses and credentials never appear in this repository.

## TV (reference: web TV, 1920x1080)

| Device | How it runs | How it is driven | How captures are taken | Known limits | Legend dir |
| --- | --- | --- | --- | --- | --- |
| Web TV (reference) | Chromium in Playwright, TV user agent | Keyboard arrows, Enter, Escape (`drivers/web.mjs`) | Playwright page screenshot | None: it is the source of truth | `web` |
| Android TV | Android Emulator, TV image | `adb shell input keyevent` D-pad keys | `adb exec-out screencap` | No hardware video plane; software codecs | `android` |
| Fire TV (Vega OS) | Vega virtual device | `drivers/firetv.mjs`: X key events to the emulator window; commands and state through the app's control channel (a build with `PLAYARR_PARITY_CONTROL=1`: `vmsgr send` in, the app's log out) | `import -window root` of the emulator display | Build must match the host architecture; `loggingctl` returns only what was logged so far, so state is polled; older Fire OS runs the Android TV app | `firetv` |
| Apple TV | tvOS simulator | `xcrun simctl` and XCUITest remote presses | `xcrun simctl io screenshot` | Simulator video is not the device decoder | `apple` |
| Samsung Tizen | Tizen TV emulator 10.0 under KVM with host GPU GL, signed with an owner-provided Samsung certificate profile | X key events to the emulator window; the debug build's `netlog.js` channel evaluates page code (`drivers/tizen-webos.mjs`, `DEVICE=tizen`) | Emulator screen grab (`xwd`) | No 4K, DRM or some Samsung APIs; the video plane is a native AVPlay overlay the screen grab cannot see | `tizen-webos` (cand `tizen`) |
| Samsung Tizen (native) | The native Tizen .NET app (`clients/tizen-native`, debug build) on the Tizen TV emulator | `drivers/tizen-native.mjs`: debug mirror keys over `sdb forward` | `import -window root` of the emulator display | No 4K, DRM or some Samsung APIs; same emulator as the web package | `tizen-native` (cand `dev`) |
| LG webOS | webOS TV 23 Simulator (Chromium 94) under a virtual X display | Chrome DevTools Protocol key events and page evaluation (`drivers/tizen-webos.mjs`, `DEVICE=webos`) | Screen grab (`xwd`) | Simulator only; no real panel or decoder; see the documented exceptions below | `tizen-webos` (cand `webos`) |
| HarmonyOS TV | DevEco Previewer (`scripts/harmony-wall/preview.sh`, run locally; images are region-locked) | Previewer key input | Previewer screenshot | Previewer renders UI only: no real playback | `harmony` |
| Xbox | UWP app sideloaded on a GitHub-hosted Windows runner (`parity-xbox.yml`, dispatch only, static server, clock pinned by the app under `parity.on`); reproduce with `scripts/parity/xbox/run-hosted.sh <legend dir> [ref]` | Keyboard arrows through `xbox-io` (the app maps them as the D-pad) | Runner screen capture | No real console video path; runner font rasteriser differs from the browser's; on-screen keyboard for text | `xbox` |
| macOS (Apple TV app) | The Apple TV app on a Mac, inside its own simulator folder only | Keyboard arrows | Window capture, never the desktop | Muted; never stream or capture the desktop | `macos` |
| Hisense VIDAA | Real TV: MQTT remote plus the debug mirror build | MQTT remote key messages | Debug mirror build screenshots | Hardware only, no emulator | `vidaa` (pending) |
| Roku Streaming Stick 4K | Real device, developer mode | ECP key presses | `plugin_inspect` screenshots | No emulator; screenshot has no video plane | `roku` (pending) |

### Android TV: the one-command run

The Android TV emulator (`playarr_vnc_tv`) runs headless (`-no-window`, no X display, no VNC) as a user unit. Sign the app in to
the static parity server once, then run everything (15 screens in both themes plus the 12 non-player D-pad checks, pinned clock
`2026-10-07T12:00:00Z`) with:

    scripts/parity/android-tv/sign-in.sh                       # clears app data, en-GB and UTC, signs in as `parity`
    scripts/parity/android-tv/run.sh <fresh out dir> --only screens,dpad --skip-player

`run.sh` reverses the static server's artwork port into the emulator, and recycles the emulator unit every 8 app launches
(`recycle.sh`: the software-GL emulator leaks about 190 MiB of host memory per launch and wedges `adb` near its cgroup limit).
Publish with `scripts/parity/android-tv/publish.sh <out dir> <branch> <pr>`; it deletes the previous candidate captures, keeps
every JSON result and writes `build.json`. Player D-pad checks need the web ref's exact Play/Pause state and a playback window,
so they stay out of this run. Fire OS runs the same app and APK.
### Tizen native: the one-command run

`scripts/parity/tizen-native/run.sh <out dir>` runs the 15 screens in both themes and the 12 D-pad checks against the static
parity server with the pinned clock (`2026-10-07T12:00:00Z`). Prerequisites: the Tizen TV emulator on a headless X display
(Xvfb, never a VNC server), the debug tpk (`clients/tizen-native/scripts/deploy.sh` with `PLAYARR_BUILD_ARGS=-p:PlayarrDebug=true`)
installed and signed in as the static `parity` account (uninstall first for a fresh sign-in), `PARITY_LOCK_DIR` set to a scratch
directory, and `PARITY_EMULATOR_LOCK` pointing at the flock file shared with the tizen-webos lane. Output is `<out>/dark`, `<out>/light`
`<out>/dpad.json` (the screens run includes the ref-only `calendar-link` through `--extra-screens`) and the layout documents `<out>/layout/<theme>/<screen>.json` (docs/parity/LAYOUT.md; the debug mirror's `POST /layout` walks the NUI view tree, the driver writes it with every screenshot; `PARITY_NO_LAYOUT=1` skips it); point `<out>` at the legend's `tizen-native/dev`. Two back-to-back runs give byte-identical screens.

### Tizen and webOS: how the shared runs work

- Both devices run the same page code, so `drivers/tizen-webos.mjs` is one driver with two transports. Tizen needs a debug
  build (the clean dist plus `scripts/parity/tizen-webos/netlog.js` loaded first) and the host log sink
  `scripts/parity/tizen-webos/logserver.py <dir>/log.txt`; point the driver at `<dir>` with `PARITY_NETLOG`. Restore the
  clean build after a run.
- Tizen key presses are X key events (`xclick.py`). A long press needs X autorepeat off on the display (`xset r off`,
  which the driver does), or the repeats cancel the long-press timer and the press becomes a click.
- Light and dark captures go to `<cand>/dark` (or `<cand>` itself) and `<cand>/light`, with the web references in
  `web` and `web/light`, as the legend expects.
- Search is captured with the on-screen keyboard dismissed and player-controls with the video plane hidden, on web and
  device alike: the keyboard is platform UI and the video plane is a native overlay, neither is app output.
- Playback is judged as playing when the playhead advances by `advanceSeconds` within `advanceSeconds + 6` s of wall
  clock; a fixed 3 s window of a stream that is still buffering fails even on web.
- Home rails depend on the shared account's recent activity (other clients play and mark items), so run the web
  reference and the device checks straight after each other; a Home check that differs only in the first card is drift,
  not a D-pad bug.

### webOS documented exceptions (not chased)

These are engine or simulator effects of the webOS TV 23 Simulator, not Playarr code. The webOS score is reported with
this note.

- **Forced font weight.** (Worked around in the webOS build by repeating each author weight with extra specificity.) The simulator injects `* { font-weight: 400 !important }` (Electron `insertCSS`), so bold
  text renders lighter than on web. An app rule cannot restore the per-element weights against an `!important` universal
  rule. Not verified on a real TV.
- **Date comma.** Chromium 94's ICU (CLDR) formats the en-GB clock date as "SUN, 11 OCTOBER", web (Chromium 120) as
  "SUN 11 OCTOBER".
- **Image resampling.** Chromium 94 scales and filters card artwork slightly differently from Chromium 120, so every
  poster edge differs by a pixel or less. This is most of the remaining 2 to 3% on image-heavy screens (movies, series,
  music).
- **Fractional line-height.** Chromium 94 truncates a fractional `line-height` to whole pixels when it lays out text lines
  (21.84 px becomes 21 px per line; an explicit `22px` gives 22), with or without `-webkit-line-clamp`. Multi-line text
  (synopses, descriptions) drifts up to about 3 px over five lines and everything below sits higher than on web. Nothing
  in the stylesheet can restore fractional line boxes, and a build-time rewrite cannot know the computed line-height, so
  it is left as an engine difference.
- **On-screen keyboard.** A focused text field opens the platform keyboard; the suite captures search with it dismissed.

### Roku player chrome: what is native and what is a platform limit

The Roku bar follows the web order: previous, play, next, audio, subtitles, queue, quality, info. Subtitles use the Video node's caption tracks (the server's WebVTT sidecars), the queue lists the episodes or tracks of the title, and info shows the playback facts the Video node reports.

- **Volume.** Real platform limit: a channel cannot change or read the system volume; the remote's own volume keys drive the TV or receiver. No volume control is drawn.
- **Picture-in-picture.** Real platform limit: Roku has no PiP for a third-party video plane.
- **Cast.** Real platform limit: a channel cannot start a cast session to another device; Roku is itself a cast target. No cast button is drawn.
- **Audio track picker.** Built: it starts a replacement session at the same position that maps the chosen stream (`audio_stream_index`), as web does.
- **Not yet checked on the stick.** The panels need a playing title, so they are verified only in a playback window.

## Mobile (gated by 17.10022; reference: web mobile at the device's size)

Mobile devices have no D-pad: they run the screen and theme captures, and the legend shows the
D-pad column as n/a.

| Device | How it runs | How it is driven | How captures are taken | Known limits | Legend dir |
| --- | --- | --- | --- | --- | --- |
| iPhone | iOS simulator | `xcrun simctl`, XCUITest taps | `xcrun simctl io screenshot` | Simulator video only | `ios-phone` |
| iPad | iOS simulator (iPad) | As iPhone | As iPhone | Own size; compared with web mobile at that size | `ios-tablet` |
| Android phone | Android Emulator, phone image | `adb shell input` | `adb exec-out screencap` | Software codecs | `android-phone` |
| HarmonyOS phone | DevEco Previewer | Previewer input | Previewer screenshot | UI only, no real playback | `harmony-phone` |
| Sailfish OS | Sailfish SDK emulator (VirtualBox on KVM) | `scripts/parity/sailfish/driver.mjs`: app smoke-script hook over ssh, no D-pad | Display capture over VNC | Slow; software GL; touch phone, so the D-pad checks are not passed | `sailfish` |
| Nura (postmarketOS) | `pmbootstrap` qemu-amd64, headless (no VNC) | QEMU QMP tablet taps and the app's route control file; touch phone, so no D-pad checks (`dpadNA`) | QEMU `screendump` over QMP | Slow; software rendering. Reproduce: `scripts/parity/nura/run.sh <outdir>` (see `scripts/parity/nura/README.md`) | `postmarketos` |

## Sailfish emulator: cold boot

A cold-booted emulator on a busy host shows only the lipstick wallpaper or a "Playarr is not responding" dialog. The VM
disk is slow with the VirtualBox host I/O cache off, so lipstick and pulseaudio miss systemd's one minute start timeout
and loop. Once, with the VM powered off: `VBoxManage storagectl <vm> --name SATA --hostiocache on`. After each cold boot:
`PLAYARR_SF_SSH_KEY=<key> scripts/parity/sailfish/vm-coldboot.sh` (raises the guest start timeouts, waits for the lock
screen, unlocks). Boot takes 2 to 4 minutes. If `VBoxHeadless` ignores SIGTERM at the BIOS stage, kill that PID and let
the service restart.

## Downloads: which platforms support them

Checked in each client's code (11 Oct 2026). Platforms marked Yes must run the `downloads` cases and report
`downloads.json`; the others record "not supported", which is not a failure. Move a platform to Yes in the same PR that
ships its download engine.

| Platform | Downloads | Evidence |
| --- | --- | --- |
| Web TV (reference) | Yes | OPFS or IndexedDB engine (`downloadEngine.ts`); grouped Downloads page (series, season, episode) with Pause, Resume, Edit, Cancel and Delete at each level, an opt-in system notification, offline playback from the local copy. The edit drawer changes keep-until only, so the quality half of the `edit` case fails on the reference until the web client can edit quality. |
| Android TV and Android phone | Yes | One app: `PlayarrDownloadService` (Media3 downloads with a notification), keep-until sweep worker |
| Fire TV (Fire OS, Android TV app) | Yes | Same app as Android TV |
| Fire TV (Vega OS) | No | Vega app has no downloads route (design marks `/downloads` out of scope) |
| iOS and iPadOS | Yes | `PlayarrKit/Downloads` engine, Downloads view |
| tvOS | No | The page says Apple TV streams and keeps no offline copies |
| macOS (Apple TV app) | No | Same app as tvOS |
| HarmonyOS TV and phone | Not yet | Downloads page exists, no engine (`DownloadsRepository.ets`); becomes Yes with the engine |
| Sailfish OS | Yes | `downloads.cpp` with Range resume, offline playback |
| Nura (postmarketOS, `linux-mobile`) | No | README: offline downloads not available yet |
| Xbox and Windows (UWP) | No | `DownloadsPage` says downloads are not available yet |
| Roku | No | Real platform limit (no offline downloads). The Downloads nav item and the Download row of the title actions drawer are left out on purpose; this is a device limit, not a parity gap. |
| Samsung Tizen, LG webOS, Hisense VIDAA | Unverified | They run the web client, so downloads work only if the device browser offers OPFS or IndexedDB (`detectDownloadStorage`); probe on the device and set the flag in the driver |

Notifications (a live system notification per download) and the now-playing entry are checked only where the driver sets
`supports.notifications` and `supports.nowPlaying`; elsewhere the suite records "not supported".

## Legend and build.json rules

- After every capture run, unmerged branches included, write captures to the legend dir, refresh `web/` in the same
  run and write `<cand>/build.json` `{ "branch", "sha", "pr", "captured_at" }`. A branch other than `main` shows
  the UNMERGED badge.
- Never publish an error or signed-out screen as a capture: abort instead (the suite runner does).
- The device test account, "Device Test" profile, is signed in on Home, dark by default.
- Result files `dpad.json` and `downloads.json` (and `performance.json` for the later performance suite) sit beside the captures (schema in `SUITE.md`).
- The score per client: Dark % and Light % are the mean per-screen similarity over the screens captured in that theme;
  D-pad is checks passed of the suite's D-pad checks (playback is no longer scored: it moved to the performance suite); overall is the mean of the parts that have results
  (mobile has no D-pad). Coverage (captured screens out of 15 per theme) is shown beside, never mixed into a percentage.

## iPhone and iPad: reproduce command

Hosted only (no local Apple toolchain), static server, pinned clock `2026-10-07T12:00:00Z` (the workflow default):
`gh workflow run parity-apple-ios.yml --ref main -f devices=iphone,ipad -f ref=<40-character app commit SHA>`, then
download the `apple-wall-<device>-<run id>-dark|light` artifacts into `ios-phone/dev` and `ios-tablet/dev`
(light screens in the `light/` subfolder) and write `build.json`. Touch devices: no D-pad checks.
