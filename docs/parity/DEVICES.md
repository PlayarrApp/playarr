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
| Fire TV (Vega OS) | Vega virtual device | `drivers/firetv.mjs`: X key events to the emulator window; commands and state through the app's control channel (a build with `PLAYARR_PARITY_CONTROL=1`: `vmsgr send` in, the app's log out) | `import -window root` of the emulator display | Build must match the host architecture; `loggingctl` returns only what was logged so far, so state is polled; older Fire OS runs the Android TV app; see "Fire TV (Vega OS): how the run works" below | `firetv` |
| Apple TV | tvOS simulator | `xcrun simctl` and XCUITest remote presses | `xcrun simctl io screenshot` | Simulator video is not the device decoder | `apple` |
| Samsung Tizen | Tizen TV emulator 10.0 under KVM with host GPU GL, signed with an owner-provided Samsung certificate profile | X key events to the emulator window; the debug build's `netlog.js` channel evaluates page code (`drivers/tizen-webos.mjs`, `DEVICE=tizen`) | Emulator screen grab (`xwd`) | No 4K, DRM or some Samsung APIs; the video plane is a native AVPlay overlay the screen grab cannot see | `tizen-webos` (cand `tizen`) |
| Samsung Tizen (native) | The native Tizen .NET app (`clients/tizen-native`, debug build) on the Tizen TV emulator | `drivers/tizen-native.mjs`: debug mirror keys over `sdb forward` | `import -window root` of the emulator display | No 4K, DRM or some Samsung APIs; same emulator as the web package | `tizen-native` (cand `dev`) |
| LG webOS | webOS TV 23 Simulator (Chromium 94) on a headless Xvfb display (no VNC) | Chrome DevTools Protocol key events and page evaluation (`drivers/tizen-webos.mjs`, `DEVICE=webos`) | Screen grab (`xwd`) | Simulator only; no real panel or decoder; see the documented exceptions below | `tizen-webos` (cand `webos`) |
| HarmonyOS TV | DevEco Previewer (`scripts/harmony-wall/preview.sh`, run locally; images are region-locked) | Previewer key input | Previewer screenshot | Previewer renders UI only: no real playback | `harmony` |
| Xbox | UWP app sideloaded on a GitHub-hosted Windows runner (`parity-xbox.yml`, dispatch only, static server, clock pinned by the app under `parity.on`); reproduce with `scripts/parity/xbox/run-hosted.sh <legend dir> [ref]` | Keyboard arrows through `xbox-io` (the app maps them as the D-pad) | Runner screen capture | No real console video path; runner font rasteriser differs from the browser's; on-screen keyboard for text | `xbox` |
| macOS (Apple TV app) | The Apple TV app on a Mac, inside its own simulator folder only | Keyboard arrows | Window capture, never the desktop | Muted; never stream or capture the desktop | `macos` |
| Hisense VIDAA | Real TV: MQTT remote plus the debug mirror build | MQTT remote key messages | Debug mirror build screenshots | Hardware only, no emulator | `vidaa` (pending) |
| Roku Streaming Stick 4K | Real device, developer mode | ECP key presses | `plugin_inspect` screenshots | No emulator; screenshot has no video plane | `roku` (pending) |

### Fire TV (Vega OS): how the run works

- One command reproduces the whole run (15 screens in dark and light, then the 12 non-player D-pad checks) against the static
  parity server with the clock pinned to 2026-10-07T12:00:00Z: `scripts/parity/vega/run.sh <out-dir> [screens|dpad]`. It writes
  `<out-dir>/{dark,light}/<screen>.png`, the layout documents `<out-dir>/layout/<theme>/<screen>.json` (the app's `cmd=layout` export, see LAYOUT.md), `readiness.json`, `dpad.json` and `build.json`.
- The virtual device runs headless on an Xvfb display (no VNC) at 1920x1080 with the emulator window at 0,0 (`xdotool windowmove`),
  so `import -window root -crop 1920x1080+0+0` is a 1:1 grab. Start it with the SDK's own command line plus `-fixed-scale`: the CLI's
  default 0.5 window scale cannot be resized afterwards without losing the GL output.
- The app must be a release build with `PLAYARR_PARITY_CONTROL=1` (the driver talks to it through `vmsgr` and the app's log). Install it
  with `vega device install-app`, open it once and approve its link code as the parity account.
- Screens are reached with `--via route`: the suite's key paths depend on every key arriving, and the virtual device drops one now and
  then. The driver replays only the keys that matter after the route (the Filters tile, the title actions drawer). The D-pad checks reach their start screen by route too and then press the real keys under test.
- `player-controls`: the driver arms a pause at 2 s (`cmd=armPause`), plays the pinned film and raises the controls; the app needs the Shaka build (`clients/fire-tv/scripts/setup-shaka.sh`).
- Platform limits (not chased): the host's font rasteriser anti-aliases text differently from Chromium, which leaves roughly 0.5 to 1% of
  every text-heavy screen differing; the Download pill and the Download action are not in the Vega app (no download storage, owner ruling 2026-10-08).

### HarmonyOS: reproduce command

Hosted runs on the static server (Previewer on a Windows runner, pinned clock `2026-10-07T12:00:00Z`), TV screens and phone,
dark and light, no D-pad (dpadNA): `scripts/parity/harmony/run.sh <branch> <legend-root>`. It dispatches
`parity-harmony.yml`, waits, and pulls the captures into the `harmony` and `harmony-phone` legend dirs.

### Android TV: the one-command run

The layout export reads only the app's own paint and shaped text: the drawer fill is the app's `parityBackground`, the calendar pill is painted by its own Text node, run heights come from the paint `android.text.Layout` draws with (reflection on the internal compose text classes; the export fails when it is unavailable), and each layout request carries a fresh id that the export must echo.

The Android TV emulator (`playarr_vnc_tv`) runs headless (`-no-window`, no X display, no VNC) as a user unit. Sign the app in to
the static parity server once, then run everything (15 screens in both themes plus the 12 non-player D-pad checks, pinned clock
`2026-10-07T12:00:00Z`) with:

    scripts/parity/android-tv/sign-in.sh                       # clears app data, en-GB and UTC, signs in as `parity`
    scripts/parity/android-tv/run.sh <fresh out dir> --only screens,dpad --skip-player

`run.sh` reverses the static server's artwork port into the emulator, and recycles the emulator unit every 8 app launches
(`recycle.sh`: the software-GL emulator leaks about 190 MiB of host memory per launch and wedges `adb` near its cgroup limit).
The run also writes `<out>/layout/<theme>/<screen>.json` through the debug build's `PlayarrLayoutExport`: per laid-out text line (from the app's `TextLayoutResult`, through the node's real window transform), plus every tagged `parityBox` read from its measured bounds. The exporter holds no web coordinates, labels or fixed rectangles; when the app differs from the web, the app is changed. The parity player is paused at once, seeked to exactly 2.000 s and held there until the player reports that position.

Publish with `scripts/parity/android-tv/publish.sh <out dir> <branch> <pr>`; it deletes the previous candidate captures, keeps
every JSON result and writes `build.json`. Player D-pad checks need the web ref's exact Play/Pause state and a playback window,
so they stay out of this run. Fire OS runs the same app and APK.
### Pausing the player at exactly 2.000 s (every device that captures player-controls)

Playing to about 2 s and pressing pause lands anywhere in a window, so the progress fill, the time label and the video frame differ between runs. The deterministic method: load the clip, seek to exactly 2000 ms, hold it paused (no play-then-pause), read the reported position back, and capture only once the device reports `paused` and a position of exactly 2000 ms. Tizen native does it in the app (`/player/<id>?t=2000&hold=2000`) and the driver refuses the capture when the position is not exactly 2.000 s.

Harmony occlusion: no ArkUI, Inspector, `ComponentUtils` or UiTest API returns the topmost component at a screen point (UiTest finds by attribute, runs on a device, and the Previewer has no `hdc`), and `FrameNode.commonAttribute` does not re-render a declarative node. So the capture measures the rendered screen with an app-side hook: `patch_hide.py` (preview build only) gives every component a stable key (`.id('pvhN')`) and binds its visibility to an AppStorage string (`@StorageLink('pvHid')` per struct); `hide:<keys>` sets that string, so the declarative tree hides the nodes (layout kept) and re-renders. The exporter's geometry only flags elements that may be covered; `capture.py` hides each flagged key, checks the app reports the node `Visibility.Hidden`, takes a second screenshot and diffs the element's box exactly, minus the noise between two unchanged shots. Unchanged pixels mean the element is not drawn and it is dropped; any element that could not be measured (global builders have no key, hide not reported, screen unsettled) stays exported and is counted as `unmeasured`. A control text must change when hidden, or the probe is void. Results are saved as `layout-probe/<theme>/<screen>.json` and replayed by `layout_replay.py`. A screenshot is kept only if the screen is unchanged after the tree dump (a mismatch aborts the capture). `player-controls` is probed like every other screen; the preview build stops the buffering spinner (`enableLoading(false)`), the only moving pixels there, so its frame settles. A key is `pvhN.I`: the source call plus the struct instance (`pvNextInst`), repeated instances of one component are separate keys, and non-Text nodes repeat the key in `accessibilityDescription` because a later `.id()` (patch_state's `pcard`) replaces the id. The diff is strict: any R, G or B channel differing at all.

Harmony limit: the Windows Previewer mocks AVPlayer, so the app never reaches a real paused 2.000 s. The preview build routes the player controller to a stand-in (`patch_player.py`, `PreviewPlayer.ets`) that lands on the pinned 2.000 s and stays paused, and replaces the surface XComponent by an empty Column so the app's black stage shows; position and pause state are the stand-in's, and the capture log prints what the page shows. The web ref for this screen is captured with the video picture hidden (`tv-harmony` group in `web-refs.json`), so only the chrome is compared. Player-controls therefore stays below 100% on Harmony until a device or real player is available. The deterministic web ref shows the fully buffered seek bar (grey 120 under the played part); the app does read and draw the platform player's buffered value (`AvPlayerController` `bufferingUpdate`, `Player.ets` `handleBufferingUpdate`, `PlayerChrome` `progressTrack` at alpha .34), but the stand-in raises no buffering event, so the Previewer draws the bare track (grey 51). That gap is a platform limit, not an app defect, and no fill is faked.

### Tizen native: the one-command run

`scripts/parity/tizen-native/run.sh <out dir>` runs the 15 screens in both themes and the 12 D-pad checks against the static
parity server with the pinned clock (`2026-10-07T12:00:00Z`). Prerequisites: the Tizen TV emulator on a headless X display
(Xvfb, never a VNC server), the debug tpk (`clients/tizen-native/scripts/deploy.sh` with `PLAYARR_BUILD_ARGS=-p:PlayarrDebug=true`)
installed and signed in as the static `parity` account (uninstall first for a fresh sign-in), `PARITY_LOCK_DIR` set to a scratch
directory, and `PARITY_EMULATOR_LOCK` pointing at the flock file shared with the tizen-webos lane. Output is `<out>/dark`, `<out>/light`
`<out>/dpad.json` (the screens run includes the ref-only `calendar-link` through `--extra-screens`) and the layout documents `<out>/layout/<theme>/<screen>.json` (docs/parity/LAYOUT.md; the debug mirror's `POST /layout` walks the NUI view tree, the driver writes it with every screenshot; `PARITY_NO_LAYOUT=1` skips it); point `<out>` at the legend's `tizen-native/dev`. Two back-to-back runs give byte-identical screens and layout documents. The layout export reads the live NUI tree only (view bounds with scale and clipping, drawn colours, the labels' own text-layout line runs); it carries no web values. Visibility is decided on the real emulator screen, never from geometry: the debug mirror lists the candidates (`POST /layout?cands=1`), the driver hides batches of non-touching candidates (`/hide`; a container that only paints loses just that paint, shown as opaque magenta; `/unhide` restores), grabs the screen again and keeps a candidate only when pixels inside its own box move by 16 levels or more, ignoring pixels that differ between two grabs of the unchanged screen (`scripts/parity/tizen-native/occlusion.mjs`). A second pass hides whole subtrees for painted containers that failed the first, so a card whose own fill sits under its poster still counts through the poster. Text run boxes add the label's letter spacing to each glyph's laid-out size (`TextGeometry` reports the size without it; the next glyph is placed at x + size + spacing), as the web's run boxes include it.

### Tizen and webOS: how the shared runs work

- Both devices run the same page code, so `drivers/tizen-webos.mjs` is one driver with two transports. Tizen needs a debug
  build (the clean dist plus `scripts/parity/tizen-webos/netlog.js` loaded first) and the host log sink
  `scripts/parity/tizen-webos/logserver.py <dir>/log.txt`; point the driver at `<dir>` with `PARITY_NETLOG`. Restore the
  clean build after a run.
- Tizen key presses are X key events (`xclick.py`). A long press needs X autorepeat off on the display (`xset r off`,
  which the driver does), or the repeats cancel the long-press timer and the press becomes a click.
- Light and dark captures go to `<cand>/dark` (or `<cand>` itself) and `<cand>/light`, with the web references in
  `web` and `web/light`, as the legend expects.
- Search is captured with the on-screen keyboard dismissed (platform UI, not app output). The Samsung emulator draws the AVPlay
  video as a layer above the browser, so its player-controls screenshot shows the paused clip without the controls; nothing in the
  page is hidden or changed to work around that. The layout export treats the AVPlay `<object>` (its real rect, synced by the app to the player shell) as an opaque occluder, so controls under the plane are not exported as visible; the pixel score and the layout of that one screen are an emulator limit (a real TV composites the plane under the page).
- Playback is judged as playing when the playhead advances by `advanceSeconds` within `advanceSeconds + 6` s of wall
  clock; a fixed 3 s window of a stream that is still buffering fails even on web.
- Home rails depend on the shared account's recent activity (other clients play and mark items), so run the web
  reference and the device checks straight after each other; a Home check that differs only in the first card is drift,
  not a D-pad bug.

### Reproduce the webOS run

One command captures the 15 screens in dark and light, then the D-pad checks, against the static parity server with the
pinned clock `2026-10-07T12:00:00Z` (`parity.env`, through `suite-run.mjs`), into the legend folder:

```sh
# once per simulator start: sign in as the parity account (password from ~/.secrets, never printed)
node scripts/parity/tizen-webos/signin-webos.mjs
# after a client change: build, copy into the simulator app folder, restart the simulator unit
WEBOS_STAGE=<simulator app folder> scripts/parity/tizen-webos/deploy-webos.sh
WEBOS_OUT=<legend dir>/webos scripts/parity/tizen-webos/run-webos.sh
```

`WEBOS_DISPLAY` (default `:26`) and `WEBOS_CDP` (default `9226`) name the simulator's display and inspector port.
Extra arguments go to `suite-run.mjs` (`--screens home,movies`, `--themes dark`).

### Tizen 6.5 engine (Chromium 85)

The Tizen web package's oldest supported engine is Tizen 6.5 (Chromium 85), which the Tizen 10 emulator above cannot exercise: it runs
`:has()`, `aspect-ratio`, `:is()` and `inset` natively, so the legacy rewrites (`clients/tv-web/tooling/legacy-tv-css.mjs`,
`legacy-aspect-ratio.mjs`, the `mirror.ts` translate fallback and the Vite target) never run there. The Tizen Studio repository has no TV 6.5
emulator image (only Mobile, Wearable and IoT 6.5, and the TV 10 extension), and no real Tizen 6.5 TV is available, so the stand-in is a pinned
Chromium 85 build (Chromium snapshot r782790, 85.0.4183.0) on its own Xvfb display with the Tizen 6.5 user agent, loading the built
`apps/tv-tizen/dist`. `drivers/tizen-webos.mjs` runs it as `DEVICE=tizen65` (inspector keys and page evaluation like webOS, ImageMagick root grab,
layout read from the real page). Software rasterising (no GPU) with one raster thread keeps twin runs identical.
Run it with `scripts/parity/tizen-webos/run-tizen65.sh` (setup in its header); the legend row is "Samsung Tizen 6.5" (dir `tizen65`, cand `dev`).
Player controls: stock Chromium has no H.264 and no AVPlay, so the driver injects `scripts/parity/tizen-webos/avplay-shim.js` (the AVPlay state
machine over the clip's 60 s, no decoding) and the screen is scored with the video hidden on both sides: the web refs of the dir come from the
group `tv-tizen65` of `web-refs.json` (`hideVideo`, the `tv-webos` platform bundle, `capture-refs.mjs --groups tv-tizen65 --screens player-controls --bak <name>`).
The capture waits for the Downloads item of the nav rail, which the app adds once its capability probe resolves.
Documented exception: Chromium 85 truncates fractional line heights to whole pixels, which the Tizen package counters by rounding them on clamped
text blocks (`legacy-tv-css.mjs`). The detail title (`line-height: 0.9` on a 69 px font) still lays out 0.2 px a line short, which is why film-detail
(72.92), series-detail (76.19) and filters (78.85) stay below the other screens: the engine keeps whole pixels, no CSS value gives 62.2 px.
Chromium 94 (snapshot 94.0.4606.0) keeps the fraction (21.83 px for 21.84), so webOS and Tizen 7 need no rounding.

### Tizen web package: debug build on the emulator

The Tizen web run has its own emulator instance (a qcow2 overlay on the clean TV image, own VM name, own Xvfb display, own
unit) so it never shares an emulator with the native Tizen run. `tizen-deploy-debug.sh` signs the built `apps/tv-tizen/dist`
plus `netlog.js` with the Samsung certificate in `TIZEN_CERT_DIR` (the password is read from the secrets file at run time into
a temporary profiles file, never into the shared `profiles.xml`) and installs it on `TIZEN_SERIAL`. Then:

```sh
python3 scripts/parity/tizen-webos/logserver.py <netlog dir>/log.txt &      # host log sink and eval channel
PARITY_NETLOG=<netlog dir> node scripts/parity/tizen-webos/signin-tizen.mjs   # once per install
TIZEN_OUT=<legend dir>/tizen PARITY_NETLOG=<netlog dir> scripts/parity/tizen-webos/run-tizen.sh
```

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

### Roku: one command for the full run

`ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> scripts/parity/roku/run.sh <legend>/roku/dev` runs the 14 screens in dark and light and the 12 non-player D-pad checks against the static server (`drivers/roku.mjs`, `--via route`). Sideload the channel first (`make package deploy` in `clients/roku`) and pair it once: the pairing screen shows a code, approve it on the static server's `/tv/link` as `parity`. The channel clock is pinned through the `parityNow` launch argument, so the shell clock reads 12:00 on 7 October. The driver has no stable-mode hooks, so `run.sh` sets `PARITY_STABLE=0`. Player controls are part of the run: the driver plays the pinned film, seeks to exactly 2.000 s through the channel (`input?paritySeek=2000`) and holds it paused until the player reports 2000 ms twice.

**Layout export.** With every screenshot the driver also writes `<out>/layout/<theme>/<screen>.json` (docs/parity/LAYOUT.md) and keeps the measured tree beside the PNG as `<screen>.png.appui.xml`. The source is the firmware's own tree of rendered nodes (ECP `query/app-ui`: bounds, colour, text, visibility, translation, scale per axis, opacity), composed through every ancestor by `scripts/parity/roku/layout-export.mjs`. Boxes are the boxes Roku reports for the nodes: a text element is the union of its glyph Labels' own boxes (the app sets neither their width nor their height), and its font is the one actually drawn, written by `TrackedText` in the Label's node name (`f<instance weight>s<integer pixel size>~<w|c>`, effective size = that times the node's scale; `w` marks one Label per word, `c` one per character, and the export joins words with a space and characters by their real gaps). A control names itself in its node id, `a11y|<role>|<radius>[@<rrggbbaa>[~<baked alpha>]]|<accessible name>`: role and the name the app builds from its data, the tint it gives its bitmap, and, for a bitmap, the corner radius of the 9-patch mask it really is. Unpainted hit boxes appear only where they sit on a real control (cards, dock items, player transport). A background is composited from the opaque Rectangles and declared bitmap fills that lie under the element in paint order, within the group that holds it; washes, scrims and frost are bitmaps and never count. Content fully covered by a later opaque fill (the page behind a drawer) is not exported. Symbol glyphs (arrows, play, check, chevron, fullwidth plus) are drawn as text from `fonts/Symbols.ttf` (a DejaVu Sans subset) and `fonts/SymbolsCjk.otf` (one Noto Sans CJK glyph); both licences ship in `clients/roku/fonts/`. Score a screen with `node scripts/parity/layout-score.mjs --client roku --ref <legend>/roku/web/layout/<theme>/<screen>.json --device <out>/layout/<theme>/<screen>.json`.

**Heading box limit (Roku).** Large tracked headings (Movies, series titles) are drawn with the same ink as the web (box-aligned crops of the reference and the device: "Movies" ink 96 px wide on the web and 97 px on the device, "Harbour 30" 308 px on both) but Roku reports each glyph Label's width rounded up to whole pixels, so the union of the Label boxes ends 1 to 5 px right of the web's text rect (`rect.right` failures only, never `left`). The app does not clip or resize Labels to hide this: clipping a Label to the web width makes Roku replace its glyphs with an ellipsis.

**Text.** Roku rounds every glyph advance to whole pixels, so a plain Label is never the web's width. `WebLabel` and `TrackedText` place each word at the web's own advance (`fonts/NunitoSans-<weight>.json`, built by `clients/roku/scripts/make_font_data.py` from `docs/parity/fonts` with HarfBuzz kerning); glyphs come from the nearest 100-step instance, positions from the exact weight, sizes round to whole pixels (inside the scorer's 0.5 px).

**Platform limits (Roku).** No Download row or tile (no offline storage), no "Check for updates" button on the profiles page (the store updates the channel), and the focused media card keeps the ink caption while a drawer is open.

### Roku player chrome: what is native and what is a platform limit

The Roku bar follows the web order: previous, play, next, mute, audio, subtitles, queue, quality, info. Subtitles use the Video node's caption tracks (the server's WebVTT sidecars), the queue lists the episodes or tracks of the title, and info shows the playback facts the Video node reports.

- **Mute.** Built: it toggles the Video node's own mute and names itself Mute or Unmute.
- **Volume.** Real platform limit: a channel cannot change or read the system volume; the remote's own volume keys drive the TV or receiver. No volume slider is drawn.
- **Fullscreen.** Real platform limit: a channel's video plane is always full screen, so there is nothing to enter or leave. No fullscreen button is drawn.
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
| Sailfish OS | Sailfish SDK emulator (VirtualBox on KVM) | `scripts/parity/sailfish/driver.mjs`: app smoke-script hook over ssh, no D-pad (touch phone) | `VBoxManage controlvm screenshotpng` (VM runs `VBoxHeadless --vrde off`, no VNC or RDP listener) | Slow; software GL; touch phone, so the D-pad checks are not passed | `sailfish` |
| Nura (postmarketOS) | `pmbootstrap` qemu-amd64, headless (no VNC) | QEMU QMP tablet taps and the app's route control file; touch phone, so no D-pad checks (`dpadNA`) | QEMU `screendump` over QMP | Slow; software rendering. Reproduce: `scripts/parity/nura/run.sh <outdir>` (see `scripts/parity/nura/README.md`) | `postmarketos` |

## Sailfish emulator: cold boot

A cold-booted emulator on a busy host shows only the lipstick wallpaper or a "Playarr is not responding" dialog. The VM
disk is slow with the VirtualBox host I/O cache off, so lipstick and pulseaudio miss systemd's one minute start timeout
and loop. Once, with the VM powered off: `VBoxManage storagectl <vm> --name SATA --hostiocache on`. After each cold boot:
`PLAYARR_SF_SSH_KEY=<key> scripts/parity/sailfish/vm-coldboot.sh` (raises the guest start timeouts, waits for the lock
screen, unlocks). Boot takes 2 to 4 minutes. If `VBoxHeadless` ignores SIGTERM at the BIOS stage, kill that PID and let
the service restart.

### Sailfish: one-command parity run

The VM runs headless (`VBoxHeadless --startvm <vm> --vrde off`), so nothing listens for VNC or RDP. Use an already signed-in emulator session for the static parity server. The wrapper sets `PLAYARR_SF_SKIP_SIGNIN=1` and rejects any request to sign in during capture; sign in separately after a fresh install or static-server reset. (`VBOX_USER_HOME` must point at the VirtualBox home of the VM.) The VM must already be running. The wrapper prepares it for capture and waits for SSH; it does not boot or restart it.

```sh
PLAYARR_SF_SSH_KEY=<key> \
PLAYARR_SF_SSH_CONFIG=<ssh-config-optional> \
PLAYARR_SF_SCRATCH=<existing-archive-source-scratch> \
PLAYARR_SF_VBOXMANAGE=<VBoxManage> \
PLAYARR_SF_OUT=<legend-root>/sailfish/dev \
PARITY_CLIENT=sailfish \
PARITY_LOCK_DIR=<lane-scratch>/lock \
PARITY_LEGEND_ROOT=<legend-root> \
PLAYARR_PARITY_ARCHIVE_SCRIPT=<archive.py> \
PLAYARR_PARITY_CLEANUP_SCRIPT=<cleanup-captures.py> \
scripts/parity/sailfish/capture-legend.sh
```

Set `PLAYARR_SF_SCRATCH` to an existing canonical directory outside and disjoint from the legend root, within the archive script's configured source roots, and outside any image-cleanup roots. The wrapper prepares the already-running VM, captures all 16 screens in both themes with the pinned clock, validates the committed capture source and guest QML/native executable before and after, then publishes the PNGs, the 32 layout documents and the capture metadata. It validates all 32 PNGs (dimensions, image integrity) and all 32 layout documents (one per screen and theme, no development fields) before changing the legend candidate, and preserves JSON history. `build.json` carries `layout_status: EXPORTER_AUDIT_PENDING`: the layout counts only after a CLEAN independent audit of the exporter. After a capture attempt, the wrapper archives first and runs cleanup only if archive succeeds. It removes only the 32 unchanged raw PNGs after publication and both maintenance steps succeed, retaining the run directory and all JSON. Failures retain raw captures and report whether publication happened. It records the guest native executable SHA separately; the capture-source commit does not identify the native binary build. `PLAYARR_SF_SSH_CONFIG` is passed to SSH-based helpers. Player-controls captures passed in both themes with the exact paused-position gate and completed busy-indicator fade. Calendar-link passed in both themes after its route telemetry fix. The focused NavBar home/movies run passed in both themes; its crop comparisons showed mixed pixel changes and do not establish parity.

The layout exporter (`clients/sailfish/qml/components/LayoutDump.js`) reads only the laid-out app: each item's four transformed corners clipped by the viewport and clip ancestors, drawn colours (a gradient counts as a visible fill; a Rectangle border counts only when its pen differs from the default pen read from a fresh Rectangle), z order, the radius of the mask a masked layer is clipped to, and the content box of every Text item. The app lays out each displayed line as a Text item of its own (`FitText` breaks the text at spaces into the web's lines and puts the real ellipsis into the last line), and every line item is a natural-height label (`lineHeight` 1; the caller's line pitch only spaces the items, so a proportional or fixed line height never stands in for glyph height), so an item's box is Qt's `contentWidth` by `contentHeight` at its alignment: there is no font-metrics reconstruction and no second word wrapper in the exporter, which stops with an error on any Text that Qt wrapped (`lineCount` above 1) or elided (`truncated`) itself. Visibility is read from the rendered screen: the geometry only flags an element that a later painter may cover, then a parity hook (`ParityScreen`, C++, reached only from the layout step) hides that element's item (opacity 0, no binding touched), renders the window again and compares the element's visible box byte for byte; no change means covered (a second pair of renders with the covering painters hidden separates a covered element from one that is the colour of its backdrop, which stays). The count of covered elements is the document's `occluded`. Names and roles are the items' real `Accessible.name` and `Accessible.role` (read through the QML `Accessible` attached object and translated to the web's role words); there are no custom hint properties. Rounded pictures are clipped by a masked layer (the holder in `Artwork`, the card in the episode row), so the picture itself exports without a radius, as on the web. There are no per-screen tables. See [the Sailfish measurement audit](SAILFISH-AUDIT.md). `scripts/parity/sailfish/build-fonts.sh` builds the embedded Nunito Sans weights. There are no D-pad checks on this touch phone. Detail pages are scrolled to the top before capture.

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

## Check for updates: which clients have an in-app updater

The web profile page shows a "Check for updates" button only where the shell can install a new build itself
(`isAndroidTv` in `clients/tv-web/web/src/pages/Profiles.tsx`, bridge in `androidTvUpdate.ts`). The layout score drops it
from the denominator (`scripts/parity/layout-exclusions.json`) for the clients below, whose packages change only through a
store or a sideload. Native packages and their update paths are in `docs/versioning-policy.md`.

| Client | In-app updater | Evidence |
| --- | --- | --- |
| Android TV, Android phone and tablet | Yes | Google Play In-App Updates and the sideload installer bridge |
| iOS and iPadOS | Yes | `PlayarrKit/Update` module |
| Roku | No | Channel Store updates only; Roku has no API to install a channel from inside a channel |
| Fire TV (Vega OS) | No | `.vpkg` is immutable once installed (`docs/versioning-policy.md`) |
| Xbox | No | MSIX: Microsoft Store or sideload (`docs/versioning-policy.md`) |

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

## Android phone and tablet: one command

Boot the emulator headless (`-no-window`), then `scripts/parity/android-mobile/emu-setup.sh <serial> [719x1558 295]` (en-GB, UTC, animations off, art port forwarded) and `signin.sh <serial>` (account `parity` on the static server). Install the sideload debug APK. Then
`PARITY_LEGEND_ROOT=<legend evidence root> PARITY_OUT=<scratch dir> scripts/parity/android-mobile/run.sh phone` (or `tablet`) captures every screen in both themes with the pinned clock, scores against `android-<device>/web`, and replaces `android-<device>/dev` (old PNGs removed, JSON kept). `PARITY_EMU_UNIT` names the emulator's systemd user unit so the run can recycle it when the swiftshader leak grows. D-pad does not apply (touch devices).

Layout export (Android phone and tablet): every capture also writes `<cand>/layout/<theme>/<screen>.json` (docs/parity/LAYOUT.md) from the debug build's own `PlayarrLayoutExport` (`am broadcast -a io.playarr.mobile.PARITY_LAYOUT`): Compose semantics text runs with the resolved text style, plus `parityBox` / `parityTag` records for links, buttons, images, painted containers with their resolved fill, radius and alpha. `run.sh` scores each file with `layout-score.mjs` and prints `layout-scores.txt`. The tablet emulator runs as the user unit `playarr-android-tablet.service` (headless, own cgroup); `emu-recycle.sh` restarts a unit when its memory passes a limit.

## Apple TV and macOS: one-command hosted run

`scripts/parity/apple/run.sh <tvos|macos> [app-ref] [workflow-ref]` dispatches `parity-apple.yml` (static server, pinned
clock `2026-10-07T12:00:00Z`, screens in both themes plus the D-pad checks), waits for it, downloads the artifacts and
writes them into the legend directory named by `LEGEND_ROOT` (`apple/tvos` or `macos/dev`, with `dpad.json` and
`build.json`). The workflow ref defaults to the app ref, so driver changes run before they reach `main`.
## iPhone and iPad: reproduce command

From the clean, pushed task branch with an open PR targeting `integration/parity`:

```sh
PARITY_LEGEND_ROOT="$legend_root" PARITY_RUN_ROOT="$task_scratch" \
PARITY_ARCHIVE_SCRIPT="$archive_script" PARITY_CLEANUP_SCRIPT="$cleanup_script" \
  scripts/parity/ios/run.sh iphone,ipad
```

Set the four paths to the campaign legend root, existing task scratch directory, JSON archive script and capture
cleanup script. The command uses authenticated `gh`, `gh-watcher`, Node and Python. It dispatches the exact pushed
commit on hosted Apple runners, uses the static server and pinned clock `2026-10-07T12:00:00Z`, waits once per run,
validates capture provenance and viewport units, publishes both themes, archives results and removes temporary images.
Touch devices have no D-pad checks. Optional second argument: a comma-separated screen list, for example
`scripts/parity/ios/run.sh iphone home,filters,player-controls`.

Failed runs still publish the captured subset and return a failure status; missing screens remain missing. Each run
keeps `request.json`, `wait.json`, per-screen scores and capture hashes in `publication.json`, plus the previous active
JSON. `build.json` retains the artifact's capture timestamp. Run the full command twice without changing the commit
and compare the two manifests' PNG and layout hashes to check determinism.

To resume an interrupted run, set `PARITY_IOS_RUN_ID` to its numeric ID and pass its single device and original screen
list. The branch, commit and arguments must still match. Inspect at least three screens against the web references
before asking the coordinator to validate a new exporter; automated scoring does not replace that audit.
Set `PARITY_IOS_INSPECT_ONLY=1` for the first capture of a changed exporter to stop before publication, inspect its
downloaded images and layouts, then resume the same run without that setting after the sanity check.

Task 17.484 remains blocked on a reference-export discrepancy: Actions has a 44 px Close circle, but its web
layout reports the CSS percentage `50%` as a radius of 50 px instead of the drawn 22 px. The native exporter must
keep reporting the actual radius. Resolution belongs to the reference coordinator; the iOS lane must not alter
the web or substitute reference values in its export.

iOS layout scores are not validated. Remaining exporter gaps include text after truncation, ancestor clipping
and opacity, and backgrounds composited through translucent or material ancestors. Resolve those gaps, obtain
an independent CLEAN audit and coordinator validation, then run two complete captures at the same commit.
Missing screenshots or layout files fail coverage; rescoring one capture twice does not establish determinism.
